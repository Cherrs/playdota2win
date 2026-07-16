import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DOWNLOAD_COUNT_KEY_PREFIX,
	createInitialDownloadCounts,
	getDownloadCountKey,
	incrementDownloadCount,
	readDownloadCounts
} from './download-count-store.ts';

function createKv(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const bulkReadSizes: number[] = [];
	const kv = {
		async get(key: string | string[]) {
			if (Array.isArray(key)) {
				bulkReadSizes.push(key.length);
				return new Map(key.map((name) => [name, values.get(name) ?? null]));
			}
			return values.get(key) ?? null;
		},
		async put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream) {
			values.set(key, String(value));
		}
	} as unknown as KVNamespace;

	return { kv, values, bulkReadSizes };
}

test('each download item uses an independent KV counter key', async () => {
	const { kv, values } = createKv({
		[`${DOWNLOAD_COUNT_KEY_PREFIX}windows`]: '9',
		[`${DOWNLOAD_COUNT_KEY_PREFIX}macos`]: '3'
	});

	assert.equal(await incrementDownloadCount(kv, { id: 'windows' }), 10);
	assert.equal(values.get(getDownloadCountKey('windows')), '10');
	assert.equal(values.get(getDownloadCountKey('macos')), '3');
});

test('missing independent counters bootstrap from the legacy per-item value', async () => {
	const { kv, values } = createKv();

	assert.equal(await incrementDownloadCount(kv, { id: 'existing', downloadCount: 41 }), 42);
	assert.equal(values.get(getDownloadCountKey('existing')), '42');
});

test('bulk reads return per-item counts and use batches of at most 100 keys', async () => {
	const items = Array.from({ length: 205 }, (_, index) => ({
		id: `item-${index}`,
		downloadCount: index
	}));
	const { kv, bulkReadSizes } = createKv({
		[getDownloadCountKey('item-0')]: '12',
		[getDownloadCountKey('item-204')]: '34'
	});

	const counts = await readDownloadCounts(kv, items);

	assert.deepEqual(bulkReadSizes, [100, 100, 5]);
	assert.equal(counts.get('item-0'), 12);
	assert.equal(counts.get('item-1'), 1);
	assert.equal(counts.get('item-204'), 34);
});

test('invalid stored values do not replace a valid bootstrap count', async () => {
	const { kv } = createKv({ [getDownloadCountKey('tool')]: 'not-a-count' });
	const counts = await readDownloadCounts(kv, [{ id: 'tool', downloadCount: 8 }]);

	assert.equal(counts.get('tool'), 8);
	assert.deepEqual(createInitialDownloadCounts([{ id: 'new-item' }]), new Map([['new-item', 0]]));
});

test('counter keys reject IDs outside the download-list schema', () => {
	assert.throws(() => getDownloadCountKey('../downloads_list'), /Invalid download item ID/);
});
