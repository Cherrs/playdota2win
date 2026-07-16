import type { DownloadItem } from '../types.ts';

export interface BackupSyncJob {
	itemId: string;
	operationId: string;
	queuedAt: number;
}

export interface BackupSyncFailure {
	itemId: string;
	error: string;
}

export interface BackupSyncProgress {
	ready: BackupSyncJob[];
	pending: BackupSyncJob[];
	failed: BackupSyncFailure[];
}

/** 按 operationId 判断本次同步结果，避免把 KV 中旧任务的 ready 状态误报为成功。 */
export function getBackupSyncProgress(
	downloads: DownloadItem[],
	jobs: BackupSyncJob[]
): BackupSyncProgress {
	const ready: BackupSyncJob[] = [];
	const pending: BackupSyncJob[] = [];
	const failed: BackupSyncFailure[] = [];

	for (const job of jobs) {
		const item = downloads.find((candidate) => candidate.id === job.itemId);
		const state = item?.r2Backup;
		if (!state || state.operationId !== job.operationId) {
			if (state && state.operationId !== job.operationId && state.updatedAt > job.queuedAt) {
				failed.push({ itemId: job.itemId, error: '同步任务已被新的任务替代' });
			} else {
				// Cloudflare KV 可能短暂返回旧值，先继续等待本次 operationId。
				pending.push(job);
			}
			continue;
		}

		if (state.status === 'ready' && !state.error) {
			ready.push(job);
		} else if (state.status === 'failed' || (state.status === 'ready' && state.error)) {
			failed.push({ itemId: job.itemId, error: state.error || 'R2 同步失败' });
		} else {
			pending.push(job);
		}
	}

	return { ready, pending, failed };
}
