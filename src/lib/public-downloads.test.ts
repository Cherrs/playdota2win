import assert from 'node:assert/strict';
import test from 'node:test';

import type { DownloadItem } from './types.ts';
import { toPublicDownloadList } from './public-downloads.ts';

const sensitiveItem: DownloadItem = {
	id: 'item-1',
	platform: 'windows',
	categoryId: 'tools',
	title: 'Tool',
	description: 'Description',
	configGuide: 'secret guide',
	filename: 'tool.exe',
	version: '1.0.0',
	size: '1 MB',
	storageType: 's3',
	url: 'https://secret.example.com/tool.exe',
	s3Config: { presignedUrl: 'https://secret.example.com/upload', publicUrl: 'secret' },
	rustdeskConfig: { enabled: true, idServer: 'secret', key: 'secret' },
	signedUrl: '/api/admin/download/secret?sig=secret',
	createdAt: 1,
	updatedAt: 2,
	enabled: true,
	downloadCount: 100
};

test('public download DTO uses independent counts and keeps an explicit field allowlist', () => {
	const result = toPublicDownloadList(
		{
			items: [sensitiveItem, { ...sensitiveItem, id: 'disabled', enabled: false }],
			downloadCount: 42,
			lastUpdated: 10
		},
		new Map([['item-1', 7]])
	);

	assert.deepEqual(result, {
		items: [
			{
				id: 'item-1',
				platform: 'windows',
				categoryId: 'tools',
				title: 'Tool',
				description: 'Description',
				filename: 'tool.exe',
				version: '1.0.0',
				size: '1 MB',
				storageType: 's3',
				enabled: true,
				downloadCount: 7
			}
		],
		downloadCount: 7,
		lastUpdated: 10
	});
});

test('public download total stays within the safe integer range', () => {
	const result = toPublicDownloadList(
		{
			items: [sensitiveItem, { ...sensitiveItem, id: 'item-2' }],
			downloadCount: 0,
			lastUpdated: 10
		},
		new Map([
			['item-1', Number.MAX_SAFE_INTEGER],
			['item-2', Number.MAX_SAFE_INTEGER]
		])
	);

	assert.equal(result.downloadCount, Number.MAX_SAFE_INTEGER);
});
