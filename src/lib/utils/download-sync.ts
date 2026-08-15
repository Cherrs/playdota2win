import type { DownloadItem } from '../types.ts';
import { compareNumericVersions, extractComparableVersion } from './download-version.ts';

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

function getCurrentItemVersion(item: DownloadItem): string | undefined {
	return (
		extractComparableVersion(item.filename || '') ||
		extractComparableVersion(item.version) ||
		extractComparableVersion(item.url)
	);
}

function getBackupVersion(item: DownloadItem): string | undefined {
	const state = item.r2Backup;
	return (
		state?.version ||
		extractComparableVersion(state?.filename || '') ||
		extractComparableVersion(state?.sourceUrl || '')
	);
}

/** 仅在能够确认 R2 缺失、失败或版本不一致时允许手动同步。 */
export function needsR2VersionSync(item: DownloadItem): boolean {
	if (item.storageType !== 'link') return false;
	const state = item.r2Backup;
	if (!state) return true;
	if (state.status === 'pending' || state.status === 'syncing') return false;
	if (state.status === 'failed') return true;

	const currentVersion = getCurrentItemVersion(item);
	const backupVersion = getBackupVersion(item);
	if (!currentVersion || !backupVersion) return false;
	return compareNumericVersions(currentVersion, backupVersion) !== 0;
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
