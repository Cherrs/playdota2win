import type { DownloadItem, DownloadList, RustDeskConfig, S3Config } from '../types.ts';
import { normalizePublicHttpsUrl } from '../utils/public-url.ts';
import { normalizeExternalDownloadUrl } from './download-backup.ts';
import { getManagedUploadKey } from './download-object.ts';

export const DOWNLOAD_LIST_KV_KEY = 'downloads_list';
export const DOWNLOAD_LIST_R2_KEY = '.metadata/downloads-list.json';

export interface DownloadListStoreOptions {
	/**
	 * Explicit escape hatch for local tests/development that intentionally provide KV without R2.
	 * Deployed Workers must leave this disabled so a missing R2 binding fails closed.
	 */
	allowKvOnlyForLocalDevelopment?: boolean;
}

export interface DownloadListSnapshot {
	list: DownloadList;
	/** Raw R2 ETag used for a conditional write; null is the KV-only development fallback. */
	version: string | null;
}

export class DownloadListConflictError extends Error {
	constructor() {
		super('Download list changed while this request was in progress');
		this.name = 'DownloadListConflictError';
	}
}

export class DownloadListStorageUnavailableError extends Error {
	constructor(message = 'Canonical R2 download list storage is unavailable') {
		super(message);
		this.name = 'DownloadListStorageUnavailableError';
	}
}

function isDownloadList(value: unknown): value is DownloadList {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	if (
		!Array.isArray(candidate.items) ||
		candidate.items.length > 1000 ||
		typeof candidate.downloadCount !== 'number' ||
		!Number.isSafeInteger(candidate.downloadCount) ||
		candidate.downloadCount < 0 ||
		typeof candidate.lastUpdated !== 'number' ||
		!Number.isSafeInteger(candidate.lastUpdated) ||
		candidate.lastUpdated < 0
	) {
		return false;
	}
	const ids = new Set<string>();
	for (const item of candidate.items) {
		if (!isDownloadItem(item) || ids.has(item.id)) return false;
		ids.add(item.id);
	}
	return true;
}

function validOptionalString(value: unknown, maxLength: number): value is string | undefined {
	return value === undefined || (typeof value === 'string' && value.length <= maxLength);
}

function validRustDeskConfig(value: unknown): value is RustDeskConfig | undefined {
	if (value === undefined) return true;
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const config = value as Record<string, unknown>;
	return (
		config.enabled === true &&
		typeof config.idServer === 'string' &&
		config.idServer.length > 0 &&
		config.idServer.length <= 255 &&
		typeof config.key === 'string' &&
		config.key.length > 0 &&
		config.key.length <= 4096
	);
}

function validS3Config(value: unknown): value is S3Config | undefined {
	if (value === undefined) return true;
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const config = value as Record<string, unknown>;
	return ['endpoint', 'bucket', 'region', 'presignedUrl', 'publicUrl'].every((field) =>
		validOptionalString(config[field], 4096)
	);
}

function isDownloadItem(value: unknown): value is DownloadItem {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const item = value as Record<string, unknown>;
	if (
		typeof item.id !== 'string' ||
		item.id.length === 0 ||
		item.id.length > 128 ||
		!/^[a-z0-9_-]+$/iu.test(item.id) ||
		(item.platform !== 'windows' && item.platform !== 'macos' && item.platform !== 'linux') ||
		(item.storageType !== 'link' && item.storageType !== 'r2' && item.storageType !== 's3') ||
		typeof item.version !== 'string' ||
		item.version.length === 0 ||
		item.version.length > 128 ||
		typeof item.size !== 'string' ||
		item.size.length === 0 ||
		item.size.length > 128 ||
		typeof item.url !== 'string' ||
		item.url.length === 0 ||
		item.url.length > 4096 ||
		typeof item.enabled !== 'boolean' ||
		!Number.isSafeInteger(item.createdAt) ||
		(item.createdAt as number) < 0 ||
		!Number.isSafeInteger(item.updatedAt) ||
		(item.updatedAt as number) < 0
	) {
		return false;
	}
	if (item.storageType === 'r2' && !getManagedUploadKey(item.url, item.platform)) return false;
	try {
		if (item.storageType === 'link') normalizeExternalDownloadUrl(item.url);
		if (item.storageType === 's3') normalizePublicHttpsUrl(item.url);
	} catch {
		return false;
	}
	return (
		validOptionalString(item.categoryId, 128) &&
		validOptionalString(item.title, 200) &&
		validOptionalString(item.description, 4000) &&
		validOptionalString(item.configGuide, 20_000) &&
		validOptionalString(item.filename, 512) &&
		validRustDeskConfig(item.rustdeskConfig) &&
		validS3Config(item.s3Config) &&
		(item.downloadCount === undefined ||
			(Number.isSafeInteger(item.downloadCount) && (item.downloadCount as number) >= 0))
	);
}

async function parseR2List(object: R2ObjectBody): Promise<DownloadList> {
	const value = await object.json<unknown>();
	if (!isDownloadList(value)) {
		throw new Error('Canonical R2 download list is invalid');
	}
	return value;
}

async function readRequiredKvList(
	kv: KVNamespace | undefined,
	purpose: 'local development'
): Promise<DownloadList> {
	if (!kv) {
		throw new DownloadListStorageUnavailableError(
			`KV download list binding is unavailable for ${purpose}`
		);
	}

	const value = await kv.get<unknown>(DOWNLOAD_LIST_KV_KEY, 'json');
	if (value === null || value === undefined) {
		throw new DownloadListStorageUnavailableError(
			`KV download list is missing; refusing unsafe ${purpose}`
		);
	}
	if (!isDownloadList(value)) {
		throw new DownloadListStorageUnavailableError(
			`KV download list is invalid; refusing unsafe ${purpose}`
		);
	}
	return value;
}

/**
 * R2 is the production source of truth because reads and conditional writes are strongly
 * consistent. KV remains a migration/development fallback only.
 */
export async function readDownloadList(
	kv: KVNamespace | undefined,
	r2: R2Bucket | undefined,
	options: DownloadListStoreOptions = {}
): Promise<DownloadListSnapshot> {
	if (!r2) {
		if (!options.allowKvOnlyForLocalDevelopment) {
			throw new DownloadListStorageUnavailableError();
		}
		return { list: await readRequiredKvList(kv, 'local development'), version: null };
	}

	const existing = await r2.get(DOWNLOAD_LIST_R2_KEY);
	if (existing) {
		return { list: await parseR2List(existing), version: existing.etag };
	}

	throw new DownloadListStorageUnavailableError(
		'Canonical R2 download list is missing; run the explicit metadata migration before serving traffic'
	);
}

export async function writeDownloadList(
	snapshot: DownloadListSnapshot,
	nextList: DownloadList,
	kv: KVNamespace | undefined,
	r2: R2Bucket | undefined,
	options: DownloadListStoreOptions = {}
): Promise<DownloadListSnapshot> {
	const list: DownloadList = { ...nextList, lastUpdated: Date.now() };

	if (!r2) {
		if (!options.allowKvOnlyForLocalDevelopment) {
			throw new DownloadListStorageUnavailableError();
		}
		if (!kv) {
			throw new DownloadListStorageUnavailableError(
				'KV download list binding is unavailable for local development'
			);
		}
		await kv.put(DOWNLOAD_LIST_KV_KEY, JSON.stringify(list));
		return { list, version: null };
	}

	if (!snapshot.version) {
		throw new DownloadListConflictError();
	}
	const stored = await r2.put(DOWNLOAD_LIST_R2_KEY, JSON.stringify(list), {
		onlyIf: { etagMatches: snapshot.version },
		httpMetadata: { contentType: 'application/json; charset=utf-8' }
	});
	if (!stored) throw new DownloadListConflictError();

	if (kv) {
		try {
			await kv.put(DOWNLOAD_LIST_KV_KEY, JSON.stringify(list));
		} catch (error) {
			// The canonical write already committed. KV is only a migration mirror and must not
			// turn a successful R2 transaction into a misleading failure response.
			console.warn({
				component: 'download_list_store',
				event_name: 'kv_mirror_write_failed',
				error_message: error instanceof Error ? error.message : String(error)
			});
		}
	}

	return { list, version: stored.etag };
}
