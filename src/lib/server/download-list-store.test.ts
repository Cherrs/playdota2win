import assert from 'node:assert/strict';
import test from 'node:test';

import type { DownloadList } from '../types.ts';
import {
	DOWNLOAD_LIST_KV_KEY,
	DownloadListConflictError,
	DownloadListStorageUnavailableError,
	readDownloadList,
	writeDownloadList
} from './download-list-store.ts';

function createKv(initial?: DownloadList): KVNamespace {
	let value = initial ? JSON.stringify(initial) : null;
	return {
		async get(_key: string, type?: string) {
			if (type === 'json') return value ? JSON.parse(value) : null;
			return value;
		},
		async put(key: string, next: string) {
			assert.equal(key, DOWNLOAD_LIST_KV_KEY);
			value = next;
		}
	} as unknown as KVNamespace;
}

function createR2(
	onPut?: (options: R2PutOptions | undefined, value: string) => void | Promise<void>,
	initial?: DownloadList
): R2Bucket {
	let value: string | null = initial ? JSON.stringify(initial) : null;
	let etag: string | null = initial ? 'etag-1' : null;
	let version = initial ? 1 : 0;
	const object = () =>
		value === null || etag === null
			? null
			: ({
					etag,
					async json() {
						return JSON.parse(value!);
					}
				} as unknown as R2ObjectBody);

	return {
		async get() {
			return object();
		},
		async put(_key: string, next: string, options?: R2PutOptions) {
			await onPut?.(options, next);
			const onlyIf = options?.onlyIf;
			if (!(onlyIf instanceof Headers) && onlyIf?.etagDoesNotMatch === '*' && value !== null) {
				return null;
			}
			if (
				!(onlyIf instanceof Headers) &&
				onlyIf?.etagMatches !== undefined &&
				onlyIf.etagMatches !== etag
			) {
				return null;
			}
			value = next;
			etag = `etag-${++version}`;
			return { etag } as R2Object;
		}
	} as unknown as R2Bucket;
}

test('requires an explicit migration when the canonical object is missing', async () => {
	const initial = { items: [], downloadCount: 42, lastUpdated: 100 } satisfies DownloadList;
	const kv = createKv(initial);
	await assert.rejects(() => readDownloadList(kv, createR2()), /explicit metadata migration/i);
});

test('rejects a stale concurrent write instead of losing the winning update', async () => {
	const kv = createKv({ items: [], downloadCount: 0, lastUpdated: 1 });
	const r2 = createR2(undefined, { items: [], downloadCount: 0, lastUpdated: 1 });
	const first = await readDownloadList(kv, r2);
	const stale = await readDownloadList(kv, r2);

	const committed = await writeDownloadList(first, { ...first.list, downloadCount: 1 }, kv, r2);
	assert.equal(committed.list.downloadCount, 1);
	await assert.rejects(
		() => writeDownloadList(stale, { ...stale.list, downloadCount: 2 }, kv, r2),
		DownloadListConflictError
	);
	assert.equal((await readDownloadList(kv, r2)).list.downloadCount, 1);
});

test('fails closed when the canonical R2 binding is missing', async () => {
	const initial = { items: [], downloadCount: 7, lastUpdated: 1 } satisfies DownloadList;
	const kv = createKv(initial);

	await assert.rejects(() => readDownloadList(kv, undefined), DownloadListStorageUnavailableError);
	await assert.rejects(
		() => writeDownloadList({ list: initial, version: null }, initial, kv, undefined),
		DownloadListStorageUnavailableError
	);
});

test('allows an explicit KV-only mode for local development', async () => {
	const kv = createKv({ items: [], downloadCount: 7, lastUpdated: 1 });
	const localOptions = { allowKvOnlyForLocalDevelopment: true };
	const snapshot = await readDownloadList(kv, undefined, localOptions);
	const saved = await writeDownloadList(
		snapshot,
		{ ...snapshot.list, downloadCount: 8 },
		kv,
		undefined,
		localOptions
	);
	assert.equal(saved.list.downloadCount, 8);
	assert.equal((await readDownloadList(kv, undefined, localOptions)).list.downloadCount, 8);
});

test('refuses to initialize a missing canonical object regardless of KV state', async () => {
	await assert.rejects(
		() => readDownloadList(undefined, createR2()),
		/explicit metadata migration/i
	);
	await assert.rejects(
		() => readDownloadList(createKv(), createR2()),
		/explicit metadata migration/i
	);

	const invalidKv = {
		async get() {
			return { items: [], downloadCount: -1, lastUpdated: 1 };
		}
	} as unknown as KVNamespace;
	await assert.rejects(
		() => readDownloadList(invalidKv, createR2()),
		/explicit metadata migration/i
	);
});

test('reads an existing canonical R2 list without requiring the legacy KV binding', async () => {
	const initial = { items: [], downloadCount: 15, lastUpdated: 1 } satisfies DownloadList;
	const r2 = createR2(undefined, initial);

	const canonical = await readDownloadList(undefined, r2);
	assert.deepEqual(canonical.list, initial);
	assert.equal(canonical.version, 'etag-1');
});

test('does not fall back to KV when an R2 operation fails', async () => {
	const initial = { items: [], downloadCount: 21, lastUpdated: 1 } satisfies DownloadList;
	const kv = createKv(initial);
	const unavailableR2 = {
		async get() {
			throw new Error('R2 unavailable');
		}
	} as unknown as R2Bucket;

	await assert.rejects(() => readDownloadList(kv, unavailableR2), /R2 unavailable/);

	let failWrites = false;
	const r2 = createR2(() => {
		if (failWrites) throw new Error('R2 write unavailable');
	}, initial);
	const snapshot = await readDownloadList(kv, r2);
	failWrites = true;
	await assert.rejects(
		() => writeDownloadList(snapshot, { ...initial, downloadCount: 22 }, kv, r2),
		/R2 write unavailable/
	);
	const kvAfterFailure = await kv.get<DownloadList>(DOWNLOAD_LIST_KV_KEY, 'json');
	assert.equal(kvAfterFailure?.downloadCount, 21);
});

test('reads only the explicit canonical object, never a newer-looking KV mirror', async () => {
	const canonical = { items: [], downloadCount: 1, lastUpdated: 1 } satisfies DownloadList;
	const staleOrUncommittedKv = {
		items: [],
		downloadCount: 99,
		lastUpdated: 999
	} satisfies DownloadList;
	const snapshot = await readDownloadList(
		createKv(staleOrUncommittedKv),
		createR2(undefined, canonical)
	);
	assert.deepEqual(snapshot.list, canonical);
	assert.equal(snapshot.version, 'etag-1');
});

test('rejects unsafe managed R2 paths in the canonical list', async () => {
	const unsafe = {
		items: [
			{
				id: 'download-1',
				platform: 'windows',
				version: '1.0.0',
				size: '1 MiB',
				storageType: 'r2',
				url: '/api/admin/download/.metadata/downloads-list.json',
				createdAt: 1,
				updatedAt: 1,
				enabled: true
			}
		],
		downloadCount: 0,
		lastUpdated: 1
	} as unknown as DownloadList;

	await assert.rejects(
		() => readDownloadList(undefined, createR2(undefined, unsafe)),
		/Canonical R2 download list is invalid/
	);
});

test('rejects executable external URLs in the canonical list', async () => {
	const unsafe = {
		items: [
			{
				id: 'download-1',
				platform: 'windows',
				version: '1.0.0',
				size: '1 MiB',
				storageType: 'link',
				url: 'javascript:alert(document.domain)',
				createdAt: 1,
				updatedAt: 1,
				enabled: true
			}
		],
		downloadCount: 0,
		lastUpdated: 1
	} as unknown as DownloadList;

	await assert.rejects(
		() => readDownloadList(undefined, createR2(undefined, unsafe)),
		/Canonical R2 download list is invalid/
	);
});
