import type { DownloadItem, R2BackupSourceType, R2BackupState } from '../types.ts';
import { MAX_EXTERNAL_BACKUP_BYTES } from '../upload-limits.ts';
import { compareVersionedFilenames, extractComparableVersion } from '../utils/download-version.ts';
import { buildContentDisposition, sanitizeFilename } from '../utils/filename.ts';
import { isPrivateNetworkHostname } from '../utils/public-url.ts';

const BACKUP_STATE_PREFIX = '_metadata/download-backups/';
const R2_MIRROR_PREFIX = 'mirrors/';
const MAX_URL_LENGTH = 4096;
const MAX_ERROR_LENGTH = 300;
const MAX_ERROR_STACK_LENGTH = 1200;
const MAX_RESPONSE_PREVIEW_BYTES = 1024;
const MAX_RESPONSE_PREVIEW_LENGTH = 512;
const SYNC_TIMEOUT_MS = 5 * 60_000;
const MULTIPART_PART_BYTES = 10 * 1024 * 1024;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface DownloadBackupStore {
	get<T = unknown>(key: string, type: 'json'): Promise<DownloadBackupStateSnapshot<T> | null>;
	put(key: string, value: string, expectedEtag: string | null): Promise<string | null>;
	delete(key: string): Promise<void>;
}

export interface DownloadBackupStateSnapshot<T = unknown> {
	value: T;
	/** Raw R2 ETag. It must be passed unchanged to the next conditional write. */
	etag: string;
}

export class DownloadBackupStateConflictError extends Error {
	constructor() {
		super('Download backup state changed while this operation was in progress');
		this.name = 'DownloadBackupStateConflictError';
	}
}

export interface DownloadBackupStateBucket {
	get(key: string): Promise<{ etag: string; text(): Promise<string> } | null>;
	put(
		key: string,
		value: string,
		options: Pick<R2PutOptions, 'onlyIf' | 'httpMetadata' | 'customMetadata'>
	): Promise<{ etag: string } | null>;
	delete(key: string): Promise<void>;
}

export interface DownloadBackupBucket {
	put(
		key: string,
		value: ReadableStream,
		options: Pick<R2PutOptions, 'httpMetadata' | 'customMetadata'>
	): Promise<{ key: string; size: number }>;
	createMultipartUpload?(
		key: string,
		options: Pick<R2MultipartOptions, 'httpMetadata' | 'customMetadata'>
	): Promise<DownloadBackupMultipartUpload>;
	delete(key: string): Promise<void>;
}

export interface DownloadBackupMultipartUpload {
	uploadPart(
		partNumber: number,
		value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob
	): Promise<{ partNumber: number; etag: string }>;
	abort(): Promise<void>;
	complete(
		parts: Array<{ partNumber: number; etag: string }>
	): Promise<{ key: string; size: number }>;
}

/**
 * Backup state is a small JSON object stored in R2. Unlike Workers KV, R2 reads
 * are immediately consistent after writes, so rapid state transitions cannot
 * observe a stale pending/syncing value or hit KV's per-key write throttle.
 */
export function createR2DownloadBackupStore(
	bucket: DownloadBackupStateBucket
): DownloadBackupStore {
	return {
		async get<T = unknown>(
			key: string,
			type: 'json'
		): Promise<DownloadBackupStateSnapshot<T> | null> {
			if (type !== 'json') throw new Error('Download backup state must be read as JSON');
			const object = await bucket.get(key);
			if (!object) return null;
			return {
				value: JSON.parse(await object.text()) as T,
				etag: object.etag
			};
		},
		async put(key: string, value: string, expectedEtag: string | null): Promise<string | null> {
			const object = await bucket.put(key, value, {
				onlyIf: expectedEtag === null ? { etagDoesNotMatch: '*' } : { etagMatches: expectedEtag },
				httpMetadata: {
					contentType: 'application/json; charset=utf-8',
					cacheControl: 'no-store'
				},
				customMetadata: { recordType: 'download-backup-state' }
			});
			return object?.etag ?? null;
		},
		async delete(key: string): Promise<void> {
			await bucket.delete(key);
		}
	};
}

interface SyncDownloadBackupOptions {
	fetchImpl?: FetchLike;
	logger?: DownloadBackupLogger;
	operationId?: string;
	sourceType?: R2BackupSourceType;
	trigger?: DownloadBackupTrigger;
	/** Test/operational override; production defaults to MAX_EXTERNAL_BACKUP_BYTES. */
	maxBytes?: number;
}

interface QueueDownloadBackupOptions {
	logger?: DownloadBackupLogger;
	sourceType?: R2BackupSourceType;
	trigger?: DownloadBackupTrigger;
}

export type DownloadBackupTrigger =
	'create' | 'url_update' | 'manual_single' | 'manual_bulk' | 'release_update' | 'unspecified';

export type DownloadBackupLogLevel = 'info' | 'warn' | 'error';

export interface DownloadBackupLogEntry {
	component: 'download_backup';
	event_name: string;
	message: string;
	schema_version: 1;
	timestamp: string;
	[key: string]: unknown;
}

export interface DownloadBackupLogger {
	write(level: DownloadBackupLogLevel, entry: DownloadBackupLogEntry): void;
}

const consoleLogger: DownloadBackupLogger = {
	write(level, entry) {
		// Workers Logs extracts fields from plain objects for Query Builder filters.
		if (level === 'error') console.error(entry);
		else if (level === 'warn') console.warn(entry);
		else console.info(entry);
	}
};

function writeBackupLog(
	logger: DownloadBackupLogger,
	level: DownloadBackupLogLevel,
	eventName: string,
	message: string,
	fields: Record<string, unknown> = {}
): void {
	try {
		logger.write(level, {
			component: 'download_backup',
			event_name: eventName,
			message,
			schema_version: 1,
			timestamp: new Date().toISOString(),
			...fields
		});
	} catch {
		// Diagnostics must never break a backup job.
	}
}

function sensitiveUrlValues(value: string): string[] {
	try {
		return Array.from(
			new Set(Array.from(new URL(value).searchParams.values()).filter(Boolean))
		).sort((a, b) => b.length - a.length);
	} catch {
		return [];
	}
}

function redactDiagnosticText(value: string, sourceUrl?: string): string {
	let redacted = value;
	for (const secret of sourceUrl ? sensitiveUrlValues(sourceUrl) : []) {
		if (secret.length >= 3) redacted = redacted.split(secret).join('[REDACTED]');
	}
	return redacted
		.replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
		.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
		.replace(
			/\b(token|access[_-]?token|api[_-]?key|password|secret|signature|sig|credential)(\s*[:=]\s*)[^\s,;&]+/gi,
			'$1$2[REDACTED]'
		)
		.replace(/([?&][^=\s&]+)=([^&#\s]*)/g, '$1=[REDACTED]')
		.replace(/\b(cookie|set-cookie)(\s*:\s*)[^\r\n]+/gi, '$1$2[REDACTED]');
}

function errorMessage(error: unknown, sourceUrl?: string): string {
	const message = error instanceof Error ? error.message : 'Unknown backup error';
	return (
		redactDiagnosticText(message, sourceUrl)
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, MAX_ERROR_LENGTH) || 'Unknown backup error'
	);
}

function errorStack(error: unknown, sourceUrl: string): string | undefined {
	if (!(error instanceof Error) || !error.stack) return undefined;
	return redactDiagnosticText(error.stack, sourceUrl)
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_ERROR_STACK_LENGTH);
}

function urlLogFields(value: string, prefix: 'source' | 'final'): Record<string, unknown> {
	try {
		const parsed = new URL(value);
		const queryKeys = Array.from(new Set(parsed.searchParams.keys())).slice(0, 20);
		return {
			[`${prefix}_protocol`]: parsed.protocol,
			[`${prefix}_hostname`]: parsed.hostname,
			[`${prefix}_port`]: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
			[`${prefix}_has_query`]: Boolean(parsed.search),
			[`${prefix}_query_keys`]: queryKeys
		};
	} catch {
		return { [`${prefix}_url_valid`]: false };
	}
}

function responseLogFields(response: Response): Record<string, unknown> {
	const fields: Record<string, unknown> = {
		origin_status: response.status,
		origin_status_text: response.statusText,
		response_redirected: response.redirected,
		response_type: response.type
	};
	const headerFields = {
		server: 'origin_server',
		'content-type': 'origin_content_type',
		'content-length': 'origin_content_length',
		'content-range': 'origin_content_range',
		'accept-ranges': 'origin_accept_ranges',
		'cf-ray': 'origin_cf_ray',
		'cf-cache-status': 'origin_cf_cache_status',
		via: 'origin_via'
	} as const;
	for (const [header, field] of Object.entries(headerFields)) {
		const value = response.headers.get(header);
		if (value) fields[field] = value.slice(0, 512);
	}
	if (response.url) Object.assign(fields, urlLogFields(response.url, 'final'));
	return fields;
}

function shouldPreviewResponse(contentType: string | null): boolean {
	if (!contentType) return true;
	const normalized = contentType.toLowerCase();
	return (
		normalized.startsWith('text/') ||
		normalized.includes('json') ||
		normalized.includes('xml') ||
		normalized.includes('javascript') ||
		normalized.includes('x-www-form-urlencoded')
	);
}

async function readErrorResponsePreview(
	response: Response,
	sourceUrl: string
): Promise<Record<string, unknown>> {
	if (!response.body || !shouldPreviewResponse(response.headers.get('content-type'))) {
		return { error_body_preview_skipped: Boolean(response.body) };
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	let truncated = false;
	try {
		while (totalBytes < MAX_RESPONSE_PREVIEW_BYTES) {
			const result = await reader.read();
			if (result.done) break;
			const remaining = MAX_RESPONSE_PREVIEW_BYTES - totalBytes;
			if (result.value.byteLength > remaining) {
				chunks.push(result.value.subarray(0, remaining));
				totalBytes += remaining;
				truncated = true;
				break;
			}
			chunks.push(result.value);
			totalBytes += result.value.byteLength;
			if (totalBytes === MAX_RESPONSE_PREVIEW_BYTES) truncated = true;
		}
	} finally {
		try {
			await reader.cancel();
		} catch {
			// The origin may have already closed the error response.
		}
		reader.releaseLock();
	}

	const bytes = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	const decoded = new TextDecoder().decode(bytes);
	const printable = Array.from(redactDiagnosticText(decoded, sourceUrl), (character) => {
		const code = character.charCodeAt(0);
		return (code >= 0 && code <= 8) ||
			code === 11 ||
			code === 12 ||
			(code >= 14 && code <= 31) ||
			code === 127
			? ' '
			: character;
	}).join('');
	const preview = printable.replace(/\s+/g, ' ').trim().slice(0, MAX_RESPONSE_PREVIEW_LENGTH);
	return {
		error_body_preview: preview || undefined,
		error_body_bytes_read: totalBytes,
		error_body_truncated: truncated || decoded.length > MAX_RESPONSE_PREVIEW_LENGTH
	};
}

class SourceHttpError extends Error {
	constructor(status: number) {
		super(`Source returned HTTP ${status}`);
		this.name = 'SourceHttpError';
	}
}

class SourcePayloadTooLargeError extends Error {
	constructor(maxBytes: number) {
		super(`Source exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB backup limit`);
		this.name = 'SourcePayloadTooLargeError';
	}
}

class SourceEmptyError extends Error {
	constructor() {
		super('Source returned an empty file');
		this.name = 'SourceEmptyError';
	}
}

function classifySyncError(error: unknown, stage: string): string {
	if (error instanceof SourceHttpError) return 'origin_http';
	if (error instanceof SourcePayloadTooLargeError) return 'origin_too_large';
	if (error instanceof SourceEmptyError) return 'origin_empty';
	if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
		return 'origin_timeout';
	}
	if (stage === 'source_fetch') return 'origin_network';
	if (stage === 'source_response') return 'origin_invalid_response';
	if (stage === 'stream_to_r2') return 'r2_put';
	if (stage === 'state_read') return 'r2_state_read';
	if (stage === 'state_commit') return 'r2_state_write';
	return 'unknown';
}

function parseSourceContentLength(response: Response, maxBytes: number): number | undefined {
	const raw = response.headers.get('content-length');
	if (raw === null) return undefined;
	if (!/^(?:0|[1-9]\d*)$/u.test(raw)) {
		throw new Error('Source returned an invalid Content-Length');
	}
	const length = Number(raw);
	if (!Number.isSafeInteger(length)) throw new Error('Source returned an invalid Content-Length');
	if (length === 0) throw new SourceEmptyError();
	if (length > maxBytes) throw new SourcePayloadTooLargeError(maxBytes);
	return length;
}

async function deletePartialBackup(r2: DownloadBackupBucket, objectKey: string): Promise<void> {
	try {
		await r2.delete(objectKey);
	} catch {
		// The original upload failure remains more useful than a best-effort cleanup error.
	}
}

async function uploadUnknownLengthBackup(
	r2: DownloadBackupBucket,
	objectKey: string,
	body: ReadableStream<Uint8Array>,
	options: Pick<R2MultipartOptions, 'httpMetadata' | 'customMetadata'>,
	maxBytes: number
): Promise<{ key: string; size: number }> {
	if (!r2.createMultipartUpload) {
		throw new Error('R2 multipart upload is unavailable for an unknown-length source');
	}
	const upload = await r2.createMultipartUpload(objectKey, options);
	const reader = body.getReader();
	const parts: Array<{ partNumber: number; etag: string }> = [];
	let buffer = new Uint8Array(MULTIPART_PART_BYTES);
	let bufferedBytes = 0;
	let totalBytes = 0;
	let completed = false;

	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;
			totalBytes += result.value.byteLength;
			if (totalBytes > maxBytes) throw new SourcePayloadTooLargeError(maxBytes);

			let chunkOffset = 0;
			while (chunkOffset < result.value.byteLength) {
				const copyBytes = Math.min(
					MULTIPART_PART_BYTES - bufferedBytes,
					result.value.byteLength - chunkOffset
				);
				buffer.set(result.value.subarray(chunkOffset, chunkOffset + copyBytes), bufferedBytes);
				bufferedBytes += copyBytes;
				chunkOffset += copyBytes;

				if (bufferedBytes === MULTIPART_PART_BYTES) {
					parts.push(await upload.uploadPart(parts.length + 1, buffer));
					buffer = new Uint8Array(MULTIPART_PART_BYTES);
					bufferedBytes = 0;
				}
			}
		}

		if (totalBytes === 0) throw new SourceEmptyError();
		if (bufferedBytes > 0) {
			parts.push(await upload.uploadPart(parts.length + 1, buffer.slice(0, bufferedBytes)));
		}
		const object = await upload.complete(parts);
		completed = true;
		if (object.size !== totalBytes || object.size > maxBytes) {
			await deletePartialBackup(r2, objectKey);
			throw new SourcePayloadTooLargeError(maxBytes);
		}
		return object;
	} catch (error) {
		try {
			await reader.cancel();
		} catch {
			// The origin may already have closed the stream.
		}
		if (!completed) {
			try {
				await upload.abort();
			} catch {
				// R2 also cleans incomplete multipart uploads through bucket lifecycle rules.
			}
		}
		await deletePartialBackup(r2, objectKey);
		throw error;
	} finally {
		reader.releaseLock();
	}
}

async function uploadBoundedBackup(
	r2: DownloadBackupBucket,
	objectKey: string,
	response: Response,
	declaredLength: number | undefined,
	options: Pick<R2PutOptions, 'httpMetadata' | 'customMetadata'>,
	maxBytes: number
): Promise<{ key: string; size: number }> {
	if (!response.body) throw new Error('Source returned an empty response body');
	if (declaredLength === undefined) {
		return uploadUnknownLengthBackup(r2, objectKey, response.body, options, maxBytes);
	}

	try {
		const object = await r2.put(objectKey, response.body, options);
		if (object.size === 0) {
			await deletePartialBackup(r2, objectKey);
			throw new SourceEmptyError();
		}
		if (object.size > maxBytes) {
			await deletePartialBackup(r2, objectKey);
			throw new SourcePayloadTooLargeError(maxBytes);
		}
		return object;
	} catch (error) {
		await deletePartialBackup(r2, objectKey);
		throw error;
	}
}

async function cancelResponseBody(response: Response): Promise<void> {
	if (!response.body || response.bodyUsed) return;
	try {
		await response.body.cancel();
	} catch {
		// The body may already have been closed by the origin.
	}
}

function filenameFromUrl(value: string): string {
	try {
		const segment = new URL(value).pathname.split('/').pop();
		return segment ? decodeURIComponent(segment) : 'download';
	} catch {
		return 'download';
	}
}

function selectSourceFilename(item: DownloadItem, sourceUrl: string): string {
	const urlFilename = filenameFromUrl(sourceUrl);
	const preferred = extractComparableVersion(urlFilename)
		? urlFilename
		: item.filename || urlFilename;
	return sanitizeFilename(preferred).slice(0, 512);
}

/** The original link's URL filename wins when it exposes a version. */
export function getOriginDownloadFilename(item: DownloadItem): string {
	return selectSourceFilename(item, item.url);
}

export function getDownloadBackupFilename(state: R2BackupState | undefined): string | undefined {
	if (!state) return undefined;
	if (state.filename) return state.filename;
	const sourceFilename = filenameFromUrl(state.sourceUrl);
	return sourceFilename === 'download' ? undefined : sourceFilename;
}

/** 仅允许服务器可以直接获取的绝对 HTTP(S) 下载地址。 */
export function normalizeExternalDownloadUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > MAX_URL_LENGTH) {
		throw new Error('Invalid download URL');
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error('Download URL must be an absolute HTTP(S) URL');
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('Download URL must use HTTP or HTTPS');
	}
	if (parsed.username || parsed.password) {
		throw new Error('Download URL must not contain credentials');
	}
	if (isPrivateNetworkHostname(parsed.hostname)) {
		throw new Error('Download URL must use a public host');
	}

	return parsed.toString();
}

export function getDownloadBackupStateKey(itemId: string): string {
	const safeId = itemId.replace(/[^a-zA-Z0-9_-]/g, '_');
	if (!safeId) throw new Error('Invalid download item ID');
	return `${BACKUP_STATE_PREFIX}${safeId}.json`;
}

/**
 * 下载项使用稳定前缀，每次同步使用独立后缀，避免旧任务覆盖新内容。
 * 文件名通过下载响应设置，因此改名不会产生额外对象。
 */
export function getDownloadBackupObjectKey(itemId: string, operationId?: string): string {
	const safeId = itemId.replace(/[^a-zA-Z0-9_-]/g, '_');
	if (!safeId) throw new Error('Invalid download item ID');
	if (!operationId) return `${R2_MIRROR_PREFIX}${safeId}`;
	const safeOperationId = operationId.replace(/[^a-zA-Z0-9_-]/g, '_');
	if (!safeOperationId) throw new Error('Invalid backup operation ID');
	return `${R2_MIRROR_PREFIX}${safeId}/${safeOperationId}`;
}

export async function getDownloadBackupState(
	store: DownloadBackupStore,
	itemId: string
): Promise<R2BackupState | undefined> {
	return (await getDownloadBackupStateSnapshot(store, itemId))?.value;
}

async function getDownloadBackupStateSnapshot(
	store: DownloadBackupStore,
	itemId: string
): Promise<DownloadBackupStateSnapshot<R2BackupState> | undefined> {
	return (await store.get<R2BackupState>(getDownloadBackupStateKey(itemId), 'json')) || undefined;
}

export async function saveDownloadBackupState(
	store: DownloadBackupStore,
	itemId: string,
	state: R2BackupState,
	expectedEtag?: string | null
): Promise<string> {
	let writeEtag = expectedEtag;
	if (writeEtag === undefined) {
		const current = await getDownloadBackupStateSnapshot(store, itemId);
		if (current && current.value.operationId !== state.operationId) {
			throw new DownloadBackupStateConflictError();
		}
		writeEtag = current?.etag ?? null;
	}

	const storedEtag = await store.put(
		getDownloadBackupStateKey(itemId),
		JSON.stringify(state),
		writeEtag
	);
	if (!storedEtag) throw new DownloadBackupStateConflictError();
	return storedEtag;
}

export async function queueDownloadBackup(
	store: DownloadBackupStore,
	item: DownloadItem,
	options: QueueDownloadBackupOptions = {}
): Promise<R2BackupState> {
	const logger = options.logger ?? consoleLogger;
	const trigger = options.trigger ?? 'unspecified';
	const sourceType = options.sourceType ?? 'origin';
	const operationId = crypto.randomUUID();
	let sourceUrl: string;
	try {
		sourceUrl = normalizeExternalDownloadUrl(item.url);
	} catch (error) {
		writeBackupLog(logger, 'error', 'download_backup_queue_failed', 'Invalid backup source URL', {
			stage: 'queued',
			outcome: 'failure',
			trigger,
			item_id: item.id,
			operation_id: operationId,
			error_kind: 'invalid_url',
			error_name: error instanceof Error ? error.name : 'UnknownError',
			error_message: errorMessage(error, item.url)
		});
		throw error;
	}
	const filename = selectSourceFilename(item, sourceUrl);
	const version = extractComparableVersion(filename);
	let previousSnapshot: DownloadBackupStateSnapshot<R2BackupState> | undefined;
	try {
		previousSnapshot = await getDownloadBackupStateSnapshot(store, item.id);
	} catch (error) {
		writeBackupLog(
			logger,
			'error',
			'download_backup_queue_failed',
			'Failed to read previous backup state',
			{
				stage: 'state_read',
				outcome: 'failure',
				trigger,
				item_id: item.id,
				operation_id: operationId,
				error_kind: 'r2_state_read',
				error_name: error instanceof Error ? error.name : 'UnknownError',
				error_message: errorMessage(error, sourceUrl),
				...urlLogFields(sourceUrl, 'source')
			}
		);
		throw error;
	}
	const previousState = previousSnapshot?.value;
	if (sourceType === 'origin' && previousState?.status === 'ready') {
		const previousFilename = getDownloadBackupFilename(previousState);
		const comparison = previousFilename
			? compareVersionedFilenames(filename, previousFilename)
			: null;
		if (previousState.sourceType === 'official-release' && comparison !== null && comparison <= 0) {
			writeBackupLog(
				logger,
				'info',
				'download_backup_preserved',
				'Kept an equal or newer official release backup',
				{
					stage: 'queued',
					outcome: 'skipped',
					trigger,
					item_id: item.id,
					operation_id: previousState.operationId,
					candidate_filename: filename,
					backup_filename: previousFilename
				}
			);
			return previousState;
		}
	}
	const state: R2BackupState = {
		status: 'pending',
		sourceUrl,
		filename,
		...(version ? { version } : {}),
		sourceType,
		operationId,
		objectKey: getDownloadBackupObjectKey(item.id, operationId),
		previousBackup:
			previousSnapshot?.value.status === 'ready'
				? {
						objectKey: previousSnapshot.value.objectKey || getDownloadBackupObjectKey(item.id),
						sourceUrl: previousSnapshot.value.sourceUrl,
						filename: previousSnapshot.value.filename,
						version: previousSnapshot.value.version,
						sourceType: previousSnapshot.value.sourceType,
						syncedAt: previousSnapshot.value.syncedAt,
						size: previousSnapshot.value.size
					}
				: previousSnapshot?.value.previousBackup,
		updatedAt: Date.now()
	};
	try {
		await saveDownloadBackupState(store, item.id, state, previousSnapshot?.etag ?? null);
	} catch (error) {
		writeBackupLog(logger, 'error', 'download_backup_queue_failed', 'Failed to save queued state', {
			stage: 'state_commit',
			outcome: 'failure',
			trigger,
			item_id: item.id,
			operation_id: operationId,
			error_kind: 'r2_state_write',
			error_name: error instanceof Error ? error.name : 'UnknownError',
			error_message: errorMessage(error, sourceUrl),
			...urlLogFields(sourceUrl, 'source')
		});
		throw error;
	}
	writeBackupLog(logger, 'info', 'download_backup_queued', 'Download R2 backup queued', {
		stage: 'queued',
		outcome: 'queued',
		trigger,
		item_id: item.id,
		operation_id: operationId,
		object_key: state.objectKey,
		previous_backup_available: Boolean(state.previousBackup),
		...urlLogFields(sourceUrl, 'source')
	});
	return state;
}

export function isDownloadBackupReady(
	item: DownloadItem,
	state: R2BackupState | undefined
): state is R2BackupState & { status: 'ready' } {
	if (state?.status !== 'ready') return false;
	if (state.sourceType === 'official-release') {
		return Boolean(getDownloadBackupFilename(state) && state.version);
	}
	try {
		return state.sourceUrl === normalizeExternalDownloadUrl(item.url);
	} catch {
		return false;
	}
}

/** Auto download uses R2 only when its filename contains a strictly newer version. */
export function shouldPreferDownloadBackup(
	item: DownloadItem,
	state: R2BackupState | undefined
): boolean {
	if (!isDownloadBackupReady(item, state)) return false;
	const backupFilename = getDownloadBackupFilename(state);
	if (!backupFilename) return false;
	return compareVersionedFilenames(backupFilename, getOriginDownloadFilename(item)) === 1;
}

/** 返回当前原始链接镜像或受管官方发布更新对应的已就绪 R2 对象键。 */
export function getReadyDownloadBackupObjectKey(
	item: DownloadItem,
	state: R2BackupState | undefined
): string | undefined {
	return isDownloadBackupReady(item, state)
		? state.objectKey || getDownloadBackupObjectKey(item.id)
		: undefined;
}

/** 在 Workers 的连接限制内执行批量 I/O。 */
export async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	if (items.length === 0) return [];
	const results = new Array<R>(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await mapper(items[index], index);
		}
	}

	const workerCount = Math.min(Math.max(1, Math.floor(limit)), items.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return results;
}

/**
 * 将一个外部链接流式写入 R2。调用者必须 await；长任务不得依赖 HTTP waitUntil。
 */
export async function syncDownloadBackup(
	item: DownloadItem,
	store: DownloadBackupStore,
	r2: DownloadBackupBucket,
	options: SyncDownloadBackupOptions = {}
): Promise<R2BackupState> {
	const operationId = options.operationId ?? crypto.randomUUID();
	const fetchImpl = options.fetchImpl ?? fetch;
	const logger = options.logger ?? consoleLogger;
	const trigger = options.trigger ?? 'unspecified';
	const requestedSourceType = options.sourceType ?? 'origin';
	const maxBytes = options.maxBytes ?? MAX_EXTERNAL_BACKUP_BYTES;
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
		throw new Error('Invalid backup size limit');
	const syncStartedAt = Date.now();
	let sourceUrl: string;
	try {
		sourceUrl = normalizeExternalDownloadUrl(item.url);
	} catch (error) {
		writeBackupLog(logger, 'error', 'download_backup_failed', 'Invalid backup source URL', {
			trigger,
			item_id: item.id,
			operation_id: operationId,
			stage: 'source_validation',
			outcome: 'failure',
			error_kind: 'invalid_url',
			error_name: error instanceof Error ? error.name : 'UnknownError',
			error_message: errorMessage(error, item.url),
			elapsed_ms: Date.now() - syncStartedAt
		});
		throw error;
	}
	const requestedFilename = selectSourceFilename(item, sourceUrl);
	const requestedVersion = extractComparableVersion(requestedFilename);
	const baseLogFields = {
		trigger,
		item_id: item.id,
		operation_id: operationId,
		...urlLogFields(sourceUrl, 'source')
	};
	let queuedSnapshot: DownloadBackupStateSnapshot<R2BackupState> | undefined;
	try {
		queuedSnapshot = await getDownloadBackupStateSnapshot(store, item.id);
	} catch (error) {
		writeBackupLog(logger, 'error', 'download_backup_failed', 'Failed to read queued state', {
			...baseLogFields,
			stage: 'state_read',
			outcome: 'failure',
			error_kind: 'r2_state_read',
			error_name: error instanceof Error ? error.name : 'UnknownError',
			error_message: errorMessage(error, sourceUrl),
			elapsed_ms: Date.now() - syncStartedAt
		});
		throw error;
	}
	const queuedState = queuedSnapshot?.value;
	if (
		options.operationId &&
		(!queuedState || queuedState.operationId !== operationId || queuedState.status !== 'pending')
	) {
		writeBackupLog(
			logger,
			'warn',
			'download_backup_superseded',
			'Download R2 backup job was superseded before fetch',
			{
				...baseLogFields,
				stage: 'queued',
				outcome: 'superseded',
				active_operation_id: queuedState?.operationId
			}
		);
		return (
			queuedState || {
				status: 'failed',
				sourceUrl,
				filename: requestedFilename,
				version: requestedVersion,
				sourceType: requestedSourceType,
				operationId,
				updatedAt: Date.now(),
				error: 'Backup job was superseded'
			}
		);
	}
	const directPreviousBackup =
		!options.operationId && queuedState?.status === 'ready'
			? {
					objectKey: queuedState.objectKey || getDownloadBackupObjectKey(item.id),
					sourceUrl: queuedState.sourceUrl,
					filename: queuedState.filename,
					version: queuedState.version,
					sourceType: queuedState.sourceType,
					syncedAt: queuedState.syncedAt,
					size: queuedState.size
				}
			: undefined;
	const syncingState: R2BackupState = {
		status: 'syncing',
		sourceUrl,
		filename: options.operationId ? queuedState?.filename || requestedFilename : requestedFilename,
		version: options.operationId ? queuedState?.version || requestedVersion : requestedVersion,
		sourceType: options.operationId
			? queuedState?.sourceType || requestedSourceType
			: requestedSourceType,
		operationId,
		objectKey:
			(options.operationId ? queuedState?.objectKey : undefined) ||
			getDownloadBackupObjectKey(item.id, operationId),
		previousBackup: directPreviousBackup || queuedState?.previousBackup,
		updatedAt: Date.now()
	};
	let syncingEtag: string;
	try {
		syncingEtag = await saveDownloadBackupState(
			store,
			item.id,
			syncingState,
			queuedSnapshot?.etag ?? null
		);
	} catch (error) {
		if (error instanceof DownloadBackupStateConflictError) {
			const activeState = await getDownloadBackupState(store, item.id);
			writeBackupLog(
				logger,
				'warn',
				'download_backup_superseded',
				'Download R2 backup job was superseded before fetch',
				{
					...baseLogFields,
					stage: 'state_commit',
					outcome: 'superseded',
					active_operation_id: activeState?.operationId
				}
			);
			return (
				activeState || {
					status: 'failed',
					sourceUrl,
					filename: requestedFilename,
					version: requestedVersion,
					sourceType: requestedSourceType,
					operationId,
					updatedAt: Date.now(),
					error: 'Backup job was superseded'
				}
			);
		}
		writeBackupLog(logger, 'error', 'download_backup_failed', 'Failed to save syncing state', {
			...baseLogFields,
			stage: 'state_commit',
			outcome: 'failure',
			error_kind: 'r2_state_write',
			error_name: error instanceof Error ? error.name : 'UnknownError',
			error_message: errorMessage(error, sourceUrl),
			elapsed_ms: Date.now() - syncStartedAt
		});
		throw error;
	}
	writeBackupLog(logger, 'info', 'download_backup_started', 'Download R2 backup started', {
		...baseLogFields,
		stage: 'source_fetch',
		outcome: 'started',
		object_key: syncingState.objectKey,
		previous_backup_available: Boolean(syncingState.previousBackup),
		timeout_ms: SYNC_TIMEOUT_MS
	});

	let response: Response | undefined;
	let stage = 'source_fetch';
	let responseFields: Record<string, unknown> = {};
	try {
		const fetchStartedAt = Date.now();
		response = await fetchImpl(sourceUrl, {
			method: 'GET',
			redirect: 'follow',
			signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
			headers: {
				Accept: 'application/octet-stream,*/*'
			}
		});
		responseFields = {
			...responseLogFields(response),
			source_fetch_duration_ms: Date.now() - fetchStartedAt
		};
		writeBackupLog(logger, 'info', 'download_backup_source_response', 'Source responded', {
			...baseLogFields,
			stage: 'source_response',
			outcome: response.ok ? 'success' : 'failure',
			...responseFields
		});

		if (!response.ok) {
			stage = 'source_response';
			const previewFields = await readErrorResponsePreview(response, sourceUrl);
			responseFields = { ...responseFields, ...previewFields };
			writeBackupLog(
				logger,
				'warn',
				'download_backup_source_rejected',
				'Source rejected the backup download request',
				{
					...baseLogFields,
					stage,
					outcome: 'failure',
					error_kind: 'origin_http',
					...responseFields
				}
			);
			throw new SourceHttpError(response.status);
		}
		if (!response.body) {
			stage = 'source_response';
			throw new Error('Source returned an empty response body');
		}
		stage = 'source_response';
		const declaredLength = parseSourceContentLength(response, maxBytes);
		stage = 'state_read';
		const activeSnapshot = await getDownloadBackupStateSnapshot(store, item.id);
		const activeState = activeSnapshot?.value;
		if (
			!activeState ||
			activeState.operationId !== operationId ||
			activeSnapshot.etag !== syncingEtag
		) {
			await cancelResponseBody(response);
			writeBackupLog(
				logger,
				'warn',
				'download_backup_superseded',
				'Download R2 backup job was superseded after source fetch',
				{
					...baseLogFields,
					stage: 'source_response',
					outcome: 'superseded',
					active_operation_id: activeState?.operationId,
					elapsed_ms: Date.now() - syncStartedAt,
					...responseFields
				}
			);
			return activeState || syncingState;
		}

		const filename = syncingState.filename || requestedFilename;
		const objectKey = syncingState.objectKey;
		if (!objectKey) throw new Error('R2 backup object key is missing');
		stage = 'stream_to_r2';
		const r2StartedAt = Date.now();
		writeBackupLog(logger, 'info', 'download_backup_r2_put_started', 'Streaming source to R2', {
			...baseLogFields,
			stage,
			outcome: 'started',
			object_key: objectKey,
			upload_mode: declaredLength === undefined ? 'multipart_counted' : 'single_known_length',
			max_object_size: maxBytes,
			...responseFields
		});
		const object = await uploadBoundedBackup(
			r2,
			objectKey,
			response,
			declaredLength,
			{
				httpMetadata: {
					contentType: response.headers.get('content-type') || 'application/octet-stream',
					contentDisposition: buildContentDisposition(filename)
				},
				customMetadata: {
					downloadItemId: item.id,
					filename,
					...(syncingState.version ? { version: syncingState.version } : {}),
					...(syncingState.sourceType ? { sourceType: syncingState.sourceType } : {})
				}
			},
			maxBytes
		);
		const r2DurationMs = Date.now() - r2StartedAt;
		writeBackupLog(logger, 'info', 'download_backup_r2_put_completed', 'R2 write completed', {
			...baseLogFields,
			stage,
			outcome: 'success',
			object_key: object.key,
			object_size: object.size,
			r2_duration_ms: r2DurationMs
		});

		const now = Date.now();
		const readyVersion = syncingState.version || extractComparableVersion(filename);
		const readyState: R2BackupState = {
			status: 'ready',
			sourceUrl,
			filename,
			...(readyVersion ? { version: readyVersion } : {}),
			sourceType: syncingState.sourceType,
			operationId,
			objectKey: syncingState.objectKey,
			updatedAt: now,
			syncedAt: now,
			size: object.size
		};
		stage = 'state_commit';
		try {
			await saveDownloadBackupState(store, item.id, readyState, syncingEtag);
		} catch (error) {
			if (!(error instanceof DownloadBackupStateConflictError)) throw error;
			let orphanObjectDeleted = false;
			try {
				await r2.delete(object.key);
				orphanObjectDeleted = true;
			} catch (error) {
				writeBackupLog(
					logger,
					'error',
					'download_backup_cleanup_failed',
					'Failed to delete superseded R2 object',
					{
						...baseLogFields,
						stage: 'previous_object_cleanup',
						outcome: 'failure',
						error_kind: 'cleanup',
						error_name: error instanceof Error ? error.name : 'UnknownError',
						error_message: errorMessage(error, sourceUrl),
						object_key: object.key
					}
				);
			}
			const currentState = await getDownloadBackupState(store, item.id);
			writeBackupLog(
				logger,
				'warn',
				'download_backup_superseded',
				'Download R2 backup job was superseded after R2 write',
				{
					...baseLogFields,
					stage: 'state_commit',
					outcome: 'superseded',
					active_operation_id: currentState?.operationId,
					object_key: object.key,
					orphan_object_deleted: orphanObjectDeleted,
					elapsed_ms: Date.now() - syncStartedAt
				}
			);
			return (
				currentState || {
					status: 'failed',
					sourceUrl,
					filename,
					version: syncingState.version,
					sourceType: syncingState.sourceType,
					operationId,
					updatedAt: Date.now(),
					error: 'Backup job was superseded'
				}
			);
		}
		if (syncingState.previousBackup && syncingState.previousBackup.objectKey !== object.key) {
			stage = 'previous_object_cleanup';
			try {
				await r2.delete(syncingState.previousBackup.objectKey);
			} catch (error) {
				writeBackupLog(
					logger,
					'error',
					'download_backup_cleanup_failed',
					'Failed to delete previous download R2 backup',
					{
						...baseLogFields,
						stage,
						outcome: 'failure',
						error_kind: 'cleanup',
						error_name: error instanceof Error ? error.name : 'UnknownError',
						error_message: errorMessage(error, sourceUrl),
						previous_object_key: syncingState.previousBackup.objectKey
					}
				);
			}
		}
		writeBackupLog(logger, 'info', 'download_backup_completed', 'Download R2 backup completed', {
			...baseLogFields,
			stage: 'completed',
			outcome: 'success',
			object_key: object.key,
			object_size: object.size,
			elapsed_ms: Date.now() - syncStartedAt
		});
		return readyState;
	} catch (error) {
		if (response) await cancelResponseBody(response);
		const failure = errorMessage(error, sourceUrl);
		const previousBackup = syncingState.previousBackup;
		const preservePreviousBackup =
			previousBackup &&
			(previousBackup.sourceUrl === sourceUrl || syncingState.sourceType === 'official-release');
		const failedState: R2BackupState = preservePreviousBackup
			? {
					status: 'ready',
					sourceUrl: previousBackup.sourceUrl,
					filename: previousBackup.filename,
					version: previousBackup.version,
					sourceType: previousBackup.sourceType,
					operationId,
					objectKey: previousBackup.objectKey,
					updatedAt: Date.now(),
					syncedAt: previousBackup.syncedAt,
					size: previousBackup.size,
					error: `Latest sync failed: ${failure}`.slice(0, MAX_ERROR_LENGTH)
				}
			: {
					status: 'failed',
					sourceUrl,
					filename: syncingState.filename,
					version: syncingState.version,
					sourceType: syncingState.sourceType,
					operationId,
					previousBackup,
					updatedAt: Date.now(),
					error: failure
				};
		const failureLogFields = {
			...baseLogFields,
			stage,
			outcome: 'failure',
			error_kind: classifySyncError(error, stage),
			error_name: error instanceof Error ? error.name : 'UnknownError',
			error_message: failedState.error,
			error_stack: errorStack(error, sourceUrl),
			backup_preserved: failedState.status === 'ready',
			elapsed_ms: Date.now() - syncStartedAt,
			...responseFields
		};
		writeBackupLog(
			logger,
			'error',
			'download_backup_failed',
			'Download R2 backup failed',
			failureLogFields
		);
		try {
			await saveDownloadBackupState(store, item.id, failedState, syncingEtag);
		} catch (stateError) {
			if (stateError instanceof DownloadBackupStateConflictError) {
				let currentState: R2BackupState | undefined;
				try {
					currentState = await getDownloadBackupState(store, item.id);
				} catch (readError) {
					writeBackupLog(
						logger,
						'error',
						'download_backup_state_update_failed',
						'Failed to read state after a conditional failure update conflict',
						{
							...baseLogFields,
							stage: 'state_read',
							outcome: 'failure',
							error_kind: 'r2_state_read',
							error_name: readError instanceof Error ? readError.name : 'UnknownError',
							error_message: errorMessage(readError, sourceUrl),
							original_error_kind: classifySyncError(error, stage)
						}
					);
					throw readError;
				}
				writeBackupLog(
					logger,
					'warn',
					'download_backup_superseded',
					'Failed backup job was superseded before state update',
					{
						...baseLogFields,
						stage: 'state_commit',
						outcome: 'superseded',
						active_operation_id: currentState?.operationId,
						original_error_kind: classifySyncError(error, stage)
					}
				);
				return currentState || failedState;
			}
			writeBackupLog(
				logger,
				'error',
				'download_backup_state_update_failed',
				'Failed to persist backup failure state',
				{
					...baseLogFields,
					stage: 'state_commit',
					outcome: 'failure',
					error_kind: 'r2_state_write',
					error_name: stateError instanceof Error ? stateError.name : 'UnknownError',
					error_message: errorMessage(stateError, sourceUrl),
					original_error_kind: classifySyncError(error, stage)
				}
			);
			throw stateError;
		}
		return failedState;
	}
}

async function probe(
	url: string,
	method: 'HEAD' | 'GET',
	timeoutMs: number,
	fetchImpl: FetchLike
): Promise<{ available: boolean; retryWithGet: boolean }> {
	let response: Response | undefined;
	try {
		response = await fetchImpl(url, {
			method,
			redirect: 'follow',
			signal: AbortSignal.timeout(timeoutMs),
			headers: method === 'GET' ? { Range: 'bytes=0-0' } : undefined
		});
		const available = response.ok;
		const retryWithGet = method === 'HEAD' && !available;
		await cancelResponseBody(response);
		return { available, retryWithGet };
	} catch {
		if (response) await cancelResponseBody(response);
		return { available: false, retryWithGet: method === 'HEAD' };
	}
}

/**
 * 服务端探测源链接，避免浏览器 CORS 影响。HEAD 失败时用单字节 GET 兼容禁用 HEAD 的源站。
 */
export async function isExternalDownloadAvailable(
	value: string,
	options: { timeoutMs?: number; fetchImpl?: FetchLike } = {}
): Promise<boolean> {
	let url: string;
	try {
		url = normalizeExternalDownloadUrl(value);
	} catch {
		return false;
	}

	const timeoutMs = options.timeoutMs ?? 3_000;
	const fetchImpl = options.fetchImpl ?? fetch;
	const head = await probe(url, 'HEAD', timeoutMs, fetchImpl);
	if (head.available) return true;
	if (!head.retryWithGet) return false;

	const rangedGet = await probe(url, 'GET', timeoutMs, fetchImpl);
	return rangedGet.available;
}

/** 强制 R2 时不得向源站发出探测请求。 */
export async function shouldUseDownloadBackup(
	requestedSource: 'auto' | 'r2',
	sourceUrl: string,
	options: { timeoutMs?: number; fetchImpl?: FetchLike } = {}
): Promise<boolean> {
	if (requestedSource === 'r2') return true;
	return !(await isExternalDownloadAvailable(sourceUrl, options));
}

export async function deleteDownloadBackup(
	itemId: string,
	store: DownloadBackupStore,
	r2: DownloadBackupBucket
): Promise<void> {
	const state = await getDownloadBackupState(store, itemId);
	const keys = new Set(
		[state?.objectKey, state?.previousBackup?.objectKey, getDownloadBackupObjectKey(itemId)].filter(
			(key): key is string => Boolean(key)
		)
	);
	await Promise.all([
		store.delete(getDownloadBackupStateKey(itemId)),
		...Array.from(keys, (key) => r2.delete(key))
	]);
}
