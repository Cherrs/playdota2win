import { json, type RequestHandler } from '@sveltejs/kit';
import type {
	DownloadList,
	DownloadItem,
	ApiResponse,
	Platform,
	StorageType,
	RustDeskConfig,
	R2BackupState
} from '$lib/types';
import { requireAdminAuth, signDownloadPath } from '$lib/admin-auth';
import { sanitizeFilename } from '$lib/utils/filename';
import { normalizePublicHttpsUrl } from '$lib/utils/public-url';
import {
	createR2DownloadBackupStore,
	deleteDownloadBackup,
	getDownloadBackupState,
	mapWithConcurrency,
	normalizeExternalDownloadUrl,
	queueDownloadBackup,
	syncDownloadBackup
} from '$lib/server/download-backup';
import {
	DownloadListConflictError,
	readDownloadList,
	writeDownloadList
} from '$lib/server/download-list-store';
import { getManagedUploadKey } from '$lib/server/download-object';
import { resolveManagedUpload } from '$lib/server/admin-upload';
import { readBoundedJson, RequestBodyError } from '$lib/server/request-body';

const MAX_BATCH_ITEMS = 100;
const MAX_METADATA_BYTES = 64 * 1024;
const CREATE_FIELDS = new Set([
	'platform',
	'categoryId',
	'title',
	'description',
	'configGuide',
	'filename',
	'version',
	'size',
	'storageType',
	'url',
	'rustdeskConfig'
]);
const SINGLE_UPDATE_FIELDS = new Set([
	'platform',
	'categoryId',
	'title',
	'description',
	'configGuide',
	'filename',
	'version',
	'size',
	'url',
	'rustdeskConfig',
	'enabled'
]);
const OPTIONAL_STRING_LIMITS: Record<string, number> = {
	categoryId: 128,
	title: 200,
	description: 4000,
	configGuide: 20_000,
	filename: 512
};

function storageUnavailable(kv: KVNamespace | undefined, r2: R2Bucket | undefined): boolean {
	return !kv && !r2;
}

function mutationError(error: unknown, fallback: string): Response {
	const conflict = error instanceof DownloadListConflictError;
	return json(
		{
			success: false,
			error: conflict ? '下载列表已被其他操作更新，请刷新后重试' : fallback
		} satisfies ApiResponse,
		{ status: conflict ? 409 : 500 }
	);
}

function parseBatchUpdates(value: unknown): Array<{ id: string; categoryId?: string }> | null {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BATCH_ITEMS) return null;
	const seen = new Set<string>();
	const result: Array<{ id: string; categoryId?: string }> = [];
	for (const raw of value) {
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
		const entry = raw as Record<string, unknown>;
		if (Object.keys(entry).some((key) => key !== 'id' && key !== 'categoryId')) return null;
		if (typeof entry.id !== 'string' || !entry.id || entry.id.length > 128 || seen.has(entry.id)) {
			return null;
		}
		if (
			entry.categoryId !== undefined &&
			entry.categoryId !== null &&
			(typeof entry.categoryId !== 'string' || entry.categoryId.length > 128)
		) {
			return null;
		}
		seen.add(entry.id);
		result.push({
			id: entry.id,
			categoryId:
				typeof entry.categoryId === 'string' && entry.categoryId ? entry.categoryId : undefined
		});
	}
	return result;
}

function parseDeleteIds(value: unknown): string[] | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const body = value as Record<string, unknown>;
	if (Object.keys(body).some((key) => key !== 'id' && key !== 'ids')) return null;
	if (body.id !== undefined && body.ids !== undefined) return null;
	const rawIds = body.ids === undefined ? [body.id] : body.ids;
	if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > MAX_BATCH_ITEMS) return null;
	const ids = rawIds.filter(
		(id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128
	);
	return ids.length === rawIds.length && new Set(ids).size === ids.length ? ids : null;
}

function parseSingleUpdates(value: Record<string, unknown>): Record<string, unknown> | null {
	const entries = Object.entries(value);
	if (entries.length === 0 || entries.some(([key]) => !SINGLE_UPDATE_FIELDS.has(key))) return null;

	const result: Record<string, unknown> = {};
	for (const [key, raw] of entries) {
		if (key in OPTIONAL_STRING_LIMITS) {
			if (raw === null || raw === '') {
				result[key] = undefined;
				continue;
			}
			if (typeof raw !== 'string' || raw.length > OPTIONAL_STRING_LIMITS[key]) return null;
			result[key] = raw.trim() || undefined;
			continue;
		}
		switch (key) {
			case 'platform':
				if (raw !== 'windows' && raw !== 'macos' && raw !== 'linux') return null;
				result[key] = raw;
				break;
			case 'version':
			case 'size':
				if (typeof raw !== 'string' || !raw.trim() || raw.length > 128) return null;
				result[key] = raw.trim();
				break;
			case 'url':
				if (typeof raw !== 'string' || !raw.trim() || raw.length > 4096) return null;
				result[key] = raw.trim();
				break;
			case 'enabled':
				if (typeof raw !== 'boolean') return null;
				result[key] = raw;
				break;
			case 'rustdeskConfig':
				result[key] = raw;
				break;
		}
	}
	return result;
}

function optionalCreateString(
	body: Record<string, unknown>,
	key: string,
	maxLength: number
): string | undefined {
	const value = body[key];
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value !== 'string' || value.length > maxLength) {
		throw new RequestBodyError(`Invalid ${key}`, 400);
	}
	return value.trim() || undefined;
}

function getFilenameFromUrl(url: string): string {
	try {
		const parsed = new URL(url, 'http://local');
		const name = parsed.pathname.split('/').pop();
		return name || 'download';
	} catch {
		return 'download';
	}
}

function normalizeRustDeskConfig(value: unknown): RustDeskConfig | undefined {
	let raw = value;
	if (typeof raw === 'string') {
		if (!raw.trim()) return undefined;
		try {
			raw = JSON.parse(raw) as unknown;
		} catch {
			throw new Error('Invalid RustDesk config');
		}
	}

	if (raw === undefined || raw === null || raw === '') {
		return undefined;
	}
	if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid RustDesk config');

	const config = raw as Record<string, unknown>;
	if (Object.keys(config).some((field) => !['enabled', 'idServer', 'key'].includes(field))) {
		throw new Error('Invalid RustDesk config');
	}
	if (config.enabled !== true && config.enabled !== false && config.enabled !== 'true') {
		throw new Error('Invalid RustDesk config');
	}
	const enabled = config.enabled === true || config.enabled === 'true';
	const idServer = typeof config.idServer === 'string' ? config.idServer.trim() : '';
	const key = typeof config.key === 'string' ? config.key.trim() : '';

	if (!enabled) {
		return undefined;
	}
	if (!idServer || !key || idServer.length > 255 || key.length > 4096) {
		throw new Error('RustDesk ID server and key are required');
	}

	return { enabled: true, idServer, key };
}

// GET: 获取下载列表
export const GET: RequestHandler = async ({ request, platform }) => {
	try {
		const kv = platform?.env?.APP_KV;
		const r2 = platform?.env?.UPLOADS_BUCKET;
		if (storageUnavailable(kv, r2)) {
			return json({ success: false, error: 'Storage not available' } satisfies ApiResponse, {
				status: 500
			});
		}

		const jwtSecret = platform?.env?.ADMIN_JWT_SECRET;
		const authed = await requireAdminAuth(request, jwtSecret, kv);
		if (!authed) {
			return json({ success: false, error: 'Unauthorized' } satisfies ApiResponse, { status: 401 });
		}

		const { list } = await readDownloadList(kv, r2);
		const backupStore = r2 ? createR2DownloadBackupStore(r2) : undefined;
		const signingSecret = platform?.env?.ADMIN_SIGNING_SECRET;
		if (!signingSecret) {
			return json(
				{ success: false, error: 'Signing secret not configured' } satisfies ApiResponse,
				{ status: 500 }
			);
		}
		const items = await mapWithConcurrency(list.items, 4, async (item) => {
			let hydratedItem = item;
			if (item.storageType === 'link' && backupStore) {
				const r2Backup = await getDownloadBackupState(backupStore, item.id);
				if (r2Backup) hydratedItem = { ...hydratedItem, r2Backup };
			}
			if (item.storageType === 'r2' && getManagedUploadKey(item.url, item.platform)) {
				const signedUrl = await signDownloadPath(item.url, signingSecret);
				return { ...hydratedItem, signedUrl };
			}
			return hydratedItem;
		});
		return json({ success: true, data: { ...list, items } } satisfies ApiResponse<DownloadList>);
	} catch (error) {
		console.error('Error fetching downloads:', error);
		return json({ success: false, error: 'Failed to fetch downloads' } satisfies ApiResponse, {
			status: 500
		});
	}
};

// POST: 添加新下载项
export const POST: RequestHandler = async ({ request, platform }) => {
	const r2 = platform?.env?.UPLOADS_BUCKET;
	const kv = platform?.env?.APP_KV;
	let pendingR2ObjectKey: string | undefined;
	let pendingComparedWithDownloadList = false;
	try {
		if (storageUnavailable(kv, r2)) {
			return json({ success: false, error: 'Storage not available' } satisfies ApiResponse, {
				status: 500
			});
		}

		const jwtSecret = platform?.env?.ADMIN_JWT_SECRET;
		const authed = await requireAdminAuth(request, jwtSecret, kv);
		if (!authed) {
			return json({ success: false, error: 'Unauthorized' } satisfies ApiResponse, { status: 401 });
		}

		let rawBody: unknown;
		try {
			rawBody = await readBoundedJson(request, MAX_METADATA_BYTES);
		} catch (error) {
			const requestError = error instanceof RequestBodyError ? error : undefined;
			return json(
				{
					success: false,
					error: requestError?.message || 'Invalid request body'
				} satisfies ApiResponse,
				{ status: requestError?.status || 400 }
			);
		}
		if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
			return json({ success: false, error: 'Invalid request body' } satisfies ApiResponse, {
				status: 400
			});
		}
		const body = rawBody as Record<string, unknown>;
		if (Object.keys(body).some((key) => !CREATE_FIELDS.has(key))) {
			return json({ success: false, error: 'Invalid create fields' } satisfies ApiResponse, {
				status: 400
			});
		}

		const allowedPlatforms = ['windows', 'macos', 'linux'] as const;
		const allowedStorageTypes = ['link', 'r2', 's3'] as const;
		if (!allowedPlatforms.includes(body.platform as (typeof allowedPlatforms)[number])) {
			return json({ success: false, error: 'Invalid platform' } satisfies ApiResponse, {
				status: 400
			});
		}
		if (!allowedStorageTypes.includes(body.storageType as StorageType)) {
			return json({ success: false, error: 'Invalid storage type' } satisfies ApiResponse, {
				status: 400
			});
		}
		const platformType = body.platform as Platform;
		const storageType = body.storageType as StorageType;
		if (typeof body.url !== 'string' || !body.url.trim() || body.url.length > 4096) {
			return json({ success: false, error: 'Invalid required fields' } satisfies ApiResponse, {
				status: 400
			});
		}

		if (storageType === 'link' && !r2) {
			return json(
				{ success: false, error: 'R2 backup sync is not available' } satisfies ApiResponse,
				{ status: 500 }
			);
		}

		let url = '';
		let uploadFilename: string | undefined;

		if (storageType === 'link') {
			try {
				url = normalizeExternalDownloadUrl(body.url);
			} catch (error) {
				return json(
					{
						success: false,
						error: error instanceof Error ? error.message : 'Invalid download URL'
					} satisfies ApiResponse,
					{ status: 400 }
				);
			}
		} else if (storageType === 'r2') {
			if (!r2) {
				return json({ success: false, error: 'R2 not available' } satisfies ApiResponse, {
					status: 500
				});
			}
			const managedUpload = await resolveManagedUpload(r2, body.url, platformType);
			if (!managedUpload) {
				return json(
					{
						success: false,
						error: 'R2 URL must reference an existing managed upload for this platform'
					} satisfies ApiResponse,
					{ status: 400 }
				);
			}
			url = body.url;
			uploadFilename = managedUpload.customMetadata?.filename;
			pendingR2ObjectKey = managedUpload.key;
		} else if (storageType === 's3') {
			try {
				url = normalizePublicHttpsUrl(body.url);
			} catch (error) {
				return json(
					{
						success: false,
						error: error instanceof Error ? error.message : 'Invalid public S3 URL'
					} satisfies ApiResponse,
					{ status: 400 }
				);
			}
		}

		if (
			typeof body.version !== 'string' ||
			!body.version.trim() ||
			body.version.length > 128 ||
			typeof body.size !== 'string' ||
			!body.size.trim() ||
			body.size.length > 128
		) {
			throw new RequestBodyError('Invalid required fields', 400);
		}
		const title = optionalCreateString(body, 'title', 200);
		const description = optionalCreateString(body, 'description', 4000);
		const configGuide = optionalCreateString(body, 'configGuide', 20_000);
		const filename = optionalCreateString(body, 'filename', 512);
		const categoryId = optionalCreateString(body, 'categoryId', 128);
		const version = body.version.trim();
		const size = body.size.trim();
		let rustdeskConfig: RustDeskConfig | undefined;
		try {
			rustdeskConfig = normalizeRustDeskConfig(body.rustdeskConfig);
		} catch (error) {
			throw new RequestBodyError(
				error instanceof Error ? error.message : 'Invalid RustDesk config',
				400
			);
		}

		const resolvedFilename =
			filename ||
			(uploadFilename ? sanitizeFilename(uploadFilename).slice(0, 512) : undefined) ||
			(storageType === 'link' ? getFilenameFromUrl(url) : undefined) ||
			undefined;

		const item: DownloadItem = {
			id: crypto.randomUUID(),
			platform: platformType,
			categoryId,
			title: title || undefined,
			description: description || undefined,
			configGuide: configGuide || undefined,
			rustdeskConfig,
			filename: resolvedFilename,
			version,
			size,
			storageType,
			url,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			enabled: true,
			downloadCount: 0
		};

		const snapshot = await readDownloadList(kv, r2);
		pendingComparedWithDownloadList = true;
		const list = snapshot.list;
		if (storageType === 'r2' && list.items.some((existing) => existing.url === url)) {
			pendingR2ObjectKey = undefined;
			return json(
				{ success: false, error: 'This managed upload is already in use' } satisfies ApiResponse,
				{ status: 409 }
			);
		}
		list.items.push(item);
		await writeDownloadList(snapshot, list, kv, r2);
		pendingR2ObjectKey = undefined;

		let r2Backup: R2BackupState | undefined;
		if (storageType === 'link' && r2) {
			try {
				const backupStore = createR2DownloadBackupStore(r2);
				const queuedState = await queueDownloadBackup(backupStore, item, { trigger: 'create' });
				r2Backup = await syncDownloadBackup(item, backupStore, r2, {
					operationId: queuedState.operationId,
					trigger: 'create'
				});
			} catch (backupError) {
				console.error({
					component: 'download_backup',
					event_name: 'download_backup_after_create_failed',
					message: 'Download item was saved but its initial backup failed',
					item_id: item.id,
					error_name: backupError instanceof Error ? backupError.name : 'UnknownError'
				});
				r2Backup = {
					status: 'failed',
					sourceUrl: item.url,
					operationId: crypto.randomUUID(),
					updatedAt: Date.now(),
					error: 'Initial R2 backup failed; retry it from the admin page'
				};
			}
		}

		return json({ success: true, data: { ...item, r2Backup } } satisfies ApiResponse<DownloadItem>);
	} catch (error) {
		if (pendingR2ObjectKey && r2) {
			try {
				let shouldDelete = !pendingComparedWithDownloadList;
				if (pendingComparedWithDownloadList) {
					const latest = await readDownloadList(kv, r2);
					shouldDelete = !latest.list.items.some(
						(item) => getManagedUploadKey(item.url, item.platform) === pendingR2ObjectKey
					);
				}
				if (shouldDelete) await r2.delete(pendingR2ObjectKey);
			} catch (cleanupError) {
				console.error('Failed to clean up an uncommitted R2 upload:', cleanupError);
			}
		}
		if (error instanceof RequestBodyError) {
			return json({ success: false, error: error.message } satisfies ApiResponse, {
				status: error.status
			});
		}
		console.error('Error adding download:', error);
		return mutationError(error, 'Failed to add download');
	}
};

// PUT: 更新下载项
export const PUT: RequestHandler = async ({ request, platform }) => {
	try {
		const kv = platform?.env?.APP_KV;
		const r2 = platform?.env?.UPLOADS_BUCKET;
		if (storageUnavailable(kv, r2)) {
			console.error('PUT /api/admin: storage not available');
			return json({ success: false, error: 'Storage not available' } satisfies ApiResponse, {
				status: 500
			});
		}

		const jwtSecret = platform?.env?.ADMIN_JWT_SECRET;
		const authed = await requireAdminAuth(request, jwtSecret, kv);
		if (!authed) {
			console.error('PUT /api/admin: Unauthorized');
			return json({ success: false, error: 'Unauthorized' } satisfies ApiResponse, { status: 401 });
		}

		const rawBody = (await request.json()) as unknown;
		if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
			return json({ success: false, error: 'Invalid request body' } satisfies ApiResponse, {
				status: 400
			});
		}
		const body = rawBody as { id?: string; updates?: unknown; [key: string]: unknown };

		if (body.updates !== undefined) {
			if (Object.keys(body).some((key) => key !== 'updates')) {
				return json({ success: false, error: 'Invalid batch request' } satisfies ApiResponse, {
					status: 400
				});
			}
			const updates = parseBatchUpdates(body.updates);
			if (!updates) {
				return json({ success: false, error: 'Invalid batch updates' } satisfies ApiResponse, {
					status: 400
				});
			}

			const snapshot = await readDownloadList(kv, r2);
			const indexes = new Map(snapshot.list.items.map((item, index) => [item.id, index]));
			if (updates.some((update) => !indexes.has(update.id))) {
				return json(
					{ success: false, error: 'One or more items were not found' } satisfies ApiResponse,
					{
						status: 404
					}
				);
			}

			const now = Date.now();
			const updatedItems: DownloadItem[] = [];
			for (const update of updates) {
				const index = indexes.get(update.id)!;
				const updated = {
					...snapshot.list.items[index],
					categoryId: update.categoryId,
					updatedAt: now
				};
				snapshot.list.items[index] = updated;
				updatedItems.push(updated);
			}
			await writeDownloadList(snapshot, snapshot.list, kv, r2);
			return json({
				success: true,
				data: { updated: updatedItems }
			} satisfies ApiResponse<{ updated: DownloadItem[] }>);
		}

		const { id, updates: _batchUpdates, ...rawUpdates } = body;
		void _batchUpdates;
		if (typeof id !== 'string' || !id || id.length > 128) {
			console.error('PUT /api/admin: ID is required');
			return json({ success: false, error: 'ID is required' } satisfies ApiResponse, {
				status: 400
			});
		}
		const normalizedUpdates = parseSingleUpdates(rawUpdates);
		if (!normalizedUpdates) {
			return json({ success: false, error: 'Invalid update fields' } satisfies ApiResponse, {
				status: 400
			});
		}
		if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'rustdeskConfig')) {
			try {
				normalizedUpdates.rustdeskConfig = normalizeRustDeskConfig(
					normalizedUpdates.rustdeskConfig
				);
			} catch (error) {
				return json(
					{
						success: false,
						error: error instanceof Error ? error.message : 'Invalid RustDesk config'
					} satisfies ApiResponse,
					{ status: 400 }
				);
			}
		}

		const snapshot = await readDownloadList(kv, r2);
		const list = snapshot.list;
		const index = list.items.findIndex((item) => item.id === id);

		if (index === -1) {
			console.error('PUT /api/admin: Item not found, id:', id);
			return json({ success: false, error: 'Item not found' } satisfies ApiResponse, {
				status: 404
			});
		}

		const previousItem = list.items[index];
		let shouldResyncBackup = false;
		if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'url')) {
			if (previousItem.storageType === 'r2') {
				if (normalizedUpdates.url !== previousItem.url) {
					return json(
						{ success: false, error: 'R2 object paths cannot be edited' } satisfies ApiResponse,
						{ status: 400 }
					);
				}
			} else {
				try {
					const normalizedUrl =
						previousItem.storageType === 's3'
							? normalizePublicHttpsUrl(normalizedUpdates.url as string)
							: normalizeExternalDownloadUrl(normalizedUpdates.url as string);
					normalizedUpdates.url = normalizedUrl;
					let previousUrl = previousItem.url;
					try {
						previousUrl = normalizeExternalDownloadUrl(previousUrl);
					} catch {
						// Allow an administrator to replace a legacy invalid URL.
					}
					shouldResyncBackup = previousItem.storageType === 'link' && normalizedUrl !== previousUrl;
				} catch (error) {
					return json(
						{
							success: false,
							error: error instanceof Error ? error.message : 'Invalid download URL'
						} satisfies ApiResponse,
						{ status: 400 }
					);
				}
			}
		}
		if (
			previousItem.storageType === 'r2' &&
			Object.prototype.hasOwnProperty.call(normalizedUpdates, 'platform') &&
			normalizedUpdates.platform !== previousItem.platform
		) {
			return json(
				{ success: false, error: 'R2 upload platform cannot be edited' } satisfies ApiResponse,
				{ status: 400 }
			);
		}

		if (shouldResyncBackup && !r2) {
			return json(
				{ success: false, error: 'R2 backup sync is not available' } satisfies ApiResponse,
				{ status: 500 }
			);
		}

		list.items[index] = {
			...previousItem,
			...normalizedUpdates,
			updatedAt: Date.now()
		};
		const updatedItem = list.items[index];
		await writeDownloadList(snapshot, list, kv, r2);

		let r2Backup: R2BackupState | undefined;
		if (r2) {
			const backupStore = createR2DownloadBackupStore(r2);
			if (shouldResyncBackup) {
				const queuedState = await queueDownloadBackup(backupStore, updatedItem, {
					trigger: 'url_update'
				});
				r2Backup = await syncDownloadBackup(updatedItem, backupStore, r2, {
					operationId: queuedState.operationId,
					trigger: 'url_update'
				});
			} else if (previousItem.storageType === 'link') {
				r2Backup = await getDownloadBackupState(backupStore, previousItem.id);
			}
		}

		return json({
			success: true,
			data: { ...updatedItem, r2Backup }
		} satisfies ApiResponse<DownloadItem>);
	} catch (error) {
		console.error('PUT /api/admin: Error updating download:', error);
		return mutationError(error, 'Failed to update download');
	}
};

// DELETE: 删除下载项
export const DELETE: RequestHandler = async ({ request, platform }) => {
	try {
		const kv = platform?.env?.APP_KV;
		const r2 = platform?.env?.UPLOADS_BUCKET;

		if (storageUnavailable(kv, r2)) {
			return json({ success: false, error: 'Storage not available' } satisfies ApiResponse, {
				status: 500
			});
		}

		const jwtSecret = platform?.env?.ADMIN_JWT_SECRET;
		const authed = await requireAdminAuth(request, jwtSecret, kv);
		if (!authed) {
			return json({ success: false, error: 'Unauthorized' } satisfies ApiResponse, { status: 401 });
		}

		const ids = parseDeleteIds((await request.json()) as unknown);
		if (!ids) {
			return json({ success: false, error: 'Valid id or ids are required' } satisfies ApiResponse, {
				status: 400
			});
		}

		const snapshot = await readDownloadList(kv, r2);
		const list = snapshot.list;
		const idSet = new Set(ids);
		const items = list.items.filter((item) => idSet.has(item.id));

		if (items.length !== ids.length) {
			return json(
				{ success: false, error: 'One or more items were not found' } satisfies ApiResponse,
				{
					status: 404
				}
			);
		}

		// 先提交元数据删除；对象清理失败只会留下不可达对象，不会留下失效下载项。
		list.items = list.items.filter((item) => !idSet.has(item.id));
		await writeDownloadList(snapshot, list, kv, r2);
		if (r2) {
			const backupStore = createR2DownloadBackupStore(r2);
			await mapWithConcurrency(items, 4, async (item) => {
				try {
					const key = getManagedUploadKey(item.url, item.platform);
					if (item.storageType === 'r2' && key) {
						await r2.delete(key);
					} else if (item.storageType === 'link') {
						await deleteDownloadBackup(item.id, backupStore, r2);
					}
				} catch (cleanupError) {
					console.error('Failed to clean up deleted download objects:', cleanupError);
				}
			});
		}

		return json({ success: true, data: { deletedIds: ids } } satisfies ApiResponse<{
			deletedIds: string[];
		}>);
	} catch (error) {
		console.error('Error deleting download:', error);
		return mutationError(error, 'Failed to delete download');
	}
};
