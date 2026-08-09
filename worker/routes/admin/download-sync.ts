import { json, type RequestHandler } from '../../http';
import { requireAdminAuth } from '$lib/admin-auth';
import {
	createR2DownloadBackupStore,
	mapWithConcurrency,
	queueDownloadBackup,
	syncDownloadBackup
} from '$lib/server/download-backup';
import { readDownloadList } from '$lib/server/download-list-store';
import { readBoundedJson, RequestBodyError } from '$lib/server/request-body';
import type { ApiResponse, DownloadItem, R2BackupState } from '$lib/types';

interface SyncRequestBody {
	itemId?: string;
}

interface SyncResult {
	completed: number;
	ready: number;
	failed: number;
	skipped: number;
	total: number;
}

async function readBody(request: Request): Promise<SyncRequestBody> {
	const body = await readBoundedJson(request, 8 * 1024);
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw new RequestBodyError('Invalid JSON body', 400);
	}
	const record = body as Record<string, unknown>;
	if (Object.keys(record).some((key) => key !== 'itemId')) {
		throw new RequestBodyError('Invalid sync request fields', 400);
	}
	const itemId = record.itemId;
	if (
		itemId !== undefined &&
		(typeof itemId !== 'string' || !itemId.trim() || itemId.trim().length > 128)
	) {
		throw new RequestBodyError('Invalid item ID', 400);
	}
	return { itemId: typeof itemId === 'string' && itemId.trim() ? itemId.trim() : undefined };
}

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const kv = platform?.env?.APP_KV;
		const r2 = platform?.env?.UPLOADS_BUCKET;
		if (!r2) {
			return json(
				{ success: false, error: 'R2 backup sync is not available' } satisfies ApiResponse,
				{ status: 500 }
			);
		}

		const authed = await requireAdminAuth(request, platform?.env?.ADMIN_JWT_SECRET, kv);
		if (!authed) {
			return json({ success: false, error: 'Unauthorized' } satisfies ApiResponse, { status: 401 });
		}

		let body: SyncRequestBody;
		try {
			body = await readBody(request);
		} catch (error) {
			return json(
				{
					success: false,
					error: error instanceof RequestBodyError ? error.message : 'Invalid JSON body'
				} satisfies ApiResponse,
				{
					status: error instanceof RequestBodyError ? error.status : 400
				}
			);
		}

		const { list } = await readDownloadList(kv, r2);
		let candidates = list.items.filter((item) => item.storageType === 'link');
		if (body.itemId) {
			const requested = list.items.find((item) => item.id === body.itemId);
			if (!requested) {
				return json({ success: false, error: 'Download item not found' } satisfies ApiResponse, {
					status: 404
				});
			}
			if (requested.storageType !== 'link') {
				return json(
					{ success: false, error: 'Only external link items can be synced' } satisfies ApiResponse,
					{ status: 400 }
				);
			}
			candidates = [requested];
		}
		const trigger = body.itemId ? 'manual_single' : 'manual_bulk';
		const backupStore = createR2DownloadBackupStore(r2);

		const prepared = await mapWithConcurrency(candidates, 2, async (item) => {
			try {
				const state = await queueDownloadBackup(backupStore, item, { trigger });
				const finalState = await syncDownloadBackup(item, backupStore, r2, {
					operationId: state.operationId,
					trigger
				});
				return { item, finalState };
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Invalid download URL';
				console.error({
					component: 'download_backup',
					event_name: 'download_backup_queue_failed',
					message: 'Failed to queue download R2 backup',
					schema_version: 1,
					stage: 'queued',
					outcome: 'failure',
					trigger,
					item_id: item.id,
					operation_id: undefined,
					error_name: error instanceof Error ? error.name : 'UnknownError',
					error_message: errorMessage
				});
				return { item, error: errorMessage };
			}
		});
		const jobs = prepared.filter(
			(value): value is { item: DownloadItem; finalState: R2BackupState } => 'finalState' in value
		);

		console.info({
			component: 'download_backup',
			event_name: 'download_backup_batch_completed',
			message: 'Download R2 backup batch completed',
			schema_version: 1,
			stage: 'completed',
			outcome: 'completed',
			trigger,
			queued_count: jobs.length,
			ready_count: jobs.filter(({ finalState }) => finalState.status === 'ready').length,
			failed_count: jobs.filter(({ finalState }) => finalState.status === 'failed').length,
			skipped_count: candidates.length - jobs.length,
			total_count: candidates.length
		});

		return json(
			{
				success: true,
				data: {
					completed: jobs.length,
					ready: jobs.filter(({ finalState }) => finalState.status === 'ready').length,
					failed:
						candidates.length -
						jobs.filter(({ finalState }) => finalState.status === 'ready').length,
					skipped: candidates.length - jobs.length,
					total: candidates.length
				}
			} satisfies ApiResponse<SyncResult>,
			{ status: 200 }
		);
	} catch (error) {
		console.error({
			component: 'download_backup',
			event_name: 'download_backup_batch_failed',
			message: 'Download R2 sync failed',
			schema_version: 1,
			stage: 'queued',
			outcome: 'failure',
			error_name: error instanceof Error ? error.name : 'UnknownError',
			error_message: error instanceof Error ? error.message : String(error)
		});
		return json({ success: false, error: 'Failed to complete R2 sync' } satisfies ApiResponse, {
			status: 500
		});
	}
};
