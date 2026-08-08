import assert from 'node:assert/strict';
import test from 'node:test';

import {
	METADATA_TARGETS,
	combinedSourceSha256,
	normalizeAndDescribeSnapshot,
	parseStorageMode
} from './metadata-cli.js';
import {
	REMOTE_RESET_CONFIRMATION,
	assertExpectedRemoteTargets,
	parseSeedArguments
} from './seed.js';
import { parseMigrationArguments } from './migrate-metadata.js';

const [downloadTarget, categoryTarget] = METADATA_TARGETS;

test('metadata snapshots combine independently of target order and reject malformed data', () => {
	const downloads = normalizeAndDescribeSnapshot(downloadTarget, {
		items: [],
		downloadCount: 0,
		lastUpdated: 1
	});
	const categories = normalizeAndDescribeSnapshot(categoryTarget, { items: [], lastUpdated: 1 });

	assert.equal(downloads.itemCount, 0);
	assert.equal(
		combinedSourceSha256([
			{ target: downloadTarget, snapshot: downloads },
			{ target: categoryTarget, snapshot: categories }
		]),
		combinedSourceSha256([
			{ target: categoryTarget, snapshot: categories },
			{ target: downloadTarget, snapshot: downloads }
		])
	);
	assert.throws(
		() => normalizeAndDescribeSnapshot(downloadTarget, { items: [], lastUpdated: 1 }),
		/不是有效/
	);
	assert.throws(
		() =>
			normalizeAndDescribeSnapshot(downloadTarget, {
				items: [
					{
						id: 'unsafe',
						platform: 'windows',
						version: '1',
						size: '1 MiB',
						storageType: 'link',
						url: 'javascript:alert(1)',
						createdAt: 1,
						updatedAt: 1,
						enabled: true
					}
				],
				downloadCount: 0,
				lastUpdated: 1
			}),
		/不是有效/
	);
	assert.throws(
		() =>
			normalizeAndDescribeSnapshot(categoryTarget, {
				items: [{ id: 'incomplete-category' }],
				lastUpdated: 1
			}),
		/不是有效/
	);
	assert.throws(
		() =>
			normalizeAndDescribeSnapshot(METADATA_TARGETS[2], {
				items: [
					{
						id: 'announcement-1',
						title: '公告',
						content: '',
						visible: true,
						pinned: false,
						createdAt: 1,
						updatedAt: 1
					}
				],
				lastUpdated: 1
			}),
		/不是有效/
	);
});

test('remote seed is fail-closed and requires the current canonical hashes', () => {
	assert.deepEqual(parseSeedArguments([]), {
		mode: 'local',
		expectedSha256: { downloads: undefined, categories: undefined, announcements: undefined }
	});
	assert.throws(() => parseStorageMode(['--local', '--remote']), /不能同时/);
	assert.throws(() => parseSeedArguments(['--remote']), /默认禁止/);

	const parsed = parseSeedArguments([
		'--remote',
		'--confirm-reset',
		REMOTE_RESET_CONFIRMATION,
		'--expected-downloads-sha256=missing',
		'--expected-categories-sha256',
		'abc',
		'--expected-announcements-sha256=missing'
	]);
	assert.deepEqual(parsed, {
		mode: 'remote',
		expectedSha256: { downloads: 'missing', categories: 'abc', announcements: 'missing' }
	});

	const currentTargets = [
		{ target: downloadTarget, current: { exists: false } },
		{
			target: categoryTarget,
			current: { exists: true, snapshot: { sha256: 'abc', itemCount: 0 } }
		},
		{ target: METADATA_TARGETS[2], current: { exists: false } }
	];
	assert.doesNotThrow(() =>
		assertExpectedRemoteTargets(currentTargets, {
			downloads: 'missing',
			categories: 'abc',
			announcements: 'missing'
		})
	);
	assert.throws(
		() =>
			assertExpectedRemoteTargets(currentTargets, {
				downloads: 'missing',
				announcements: 'missing'
			}),
		/expected-categories-sha256 abc/
	);
	assert.throws(
		() =>
			assertExpectedRemoteTargets(currentTargets, {
				downloads: 'missing',
				categories: 'stale',
				announcements: 'missing'
			}),
		/已变化/
	);
});

test('remote migration defaults to preview and apply requires a maintenance-window acknowledgement', () => {
	assert.deepEqual(parseMigrationArguments(['--remote']), {
		mode: 'remote',
		apply: false,
		confirmedSourceSha256: undefined,
		initializeMissingEmpty: []
	});
	assert.throws(() => parseMigrationArguments(['--remote', '--apply']), /单操作者维护窗口/);
	assert.deepEqual(
		parseMigrationArguments([
			'--remote',
			'--apply',
			'--confirm-single-operator-window',
			'--confirm-source-sha256',
			'hash'
		]),
		{
			mode: 'remote',
			apply: true,
			confirmedSourceSha256: 'hash',
			initializeMissingEmpty: []
		}
	);
	assert.deepEqual(parseMigrationArguments(['--initialize-missing-empty=announcements']), {
		mode: 'local',
		apply: false,
		confirmedSourceSha256: undefined,
		initializeMissingEmpty: ['announcements']
	});
	assert.throws(
		() => parseMigrationArguments(['--initialize-missing-empty=downloads']),
		/下载列表不能初始化为空/
	);
});
