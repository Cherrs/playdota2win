import assert from 'node:assert/strict';
import test from 'node:test';

import type { DownloadItem, R2BackupState } from '../types.ts';
import { getBackupSyncProgress, needsR2VersionSync, type BackupSyncJob } from './download-sync.ts';

function itemWithState(state: R2BackupState): DownloadItem {
	return {
		id: 'item-1',
		platform: 'windows',
		version: '1.0.0',
		size: '1MB',
		storageType: 'link',
		url: state.sourceUrl,
		createdAt: 1,
		updatedAt: 1,
		enabled: true,
		r2Backup: state
	};
}

const job: BackupSyncJob = { itemId: 'item-1', operationId: 'job-current', queuedAt: 100 };

test('reports a matching ready backup as completed', () => {
	const progress = getBackupSyncProgress(
		[
			itemWithState({
				status: 'ready',
				sourceUrl: 'https://example.com/file',
				operationId: job.operationId,
				updatedAt: 101
			})
		],
		[job]
	);

	assert.equal(progress.ready.length, 1);
	assert.equal(progress.pending.length, 0);
	assert.equal(progress.failed.length, 0);
});

test('reports failed and preserved-refresh states as failures', () => {
	for (const status of ['failed', 'ready'] as const) {
		const progress = getBackupSyncProgress(
			[
				itemWithState({
					status,
					sourceUrl: 'https://example.com/file',
					operationId: job.operationId,
					updatedAt: 101,
					error: 'Source returned HTTP 500'
				})
			],
			[job]
		);

		assert.equal(progress.failed.length, 1);
		assert.match(progress.failed[0].error, /HTTP 500/);
	}
});

test('waits through stale KV reads but detects a newer superseding operation', () => {
	const stale = getBackupSyncProgress(
		[
			itemWithState({
				status: 'ready',
				sourceUrl: 'https://example.com/file',
				operationId: 'job-old',
				updatedAt: 99
			})
		],
		[job]
	);
	assert.equal(stale.pending.length, 1);
	assert.equal(stale.ready.length, 0);

	const superseded = getBackupSyncProgress(
		[
			itemWithState({
				status: 'syncing',
				sourceUrl: 'https://example.com/file',
				operationId: 'job-new',
				updatedAt: 102
			})
		],
		[job]
	);
	assert.equal(superseded.pending.length, 0);
	assert.equal(superseded.failed.length, 1);
	assert.match(superseded.failed[0].error, /新的任务替代/);
});

test('enables manual sync only for missing, failed or different R2 versions', () => {
	const base = itemWithState({
		status: 'ready',
		sourceUrl: 'https://example.com/client-1.5.915.exe',
		filename: 'client-1.5.915.exe',
		version: '1.5.915',
		operationId: 'ready',
		updatedAt: 1
	});
	base.filename = 'client-1.5.915.exe';
	base.version = '1.5.915';

	assert.equal(needsR2VersionSync(base), false);
	assert.equal(
		needsR2VersionSync({
			...base,
			version: '1.5.916',
			filename: 'client-1.5.916.exe'
		}),
		true
	);
	assert.equal(needsR2VersionSync({ ...base, r2Backup: undefined }), true);
	assert.equal(
		needsR2VersionSync({
			...base,
			r2Backup: { ...base.r2Backup!, status: 'failed', error: 'failed' }
		}),
		true
	);
	assert.equal(
		needsR2VersionSync({
			...base,
			r2Backup: { ...base.r2Backup!, status: 'syncing' }
		}),
		false
	);
	assert.equal(needsR2VersionSync({ ...base, storageType: 'r2' }), false);
});
