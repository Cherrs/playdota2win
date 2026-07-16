import assert from 'node:assert/strict';
import test from 'node:test';

import type { AnnouncementList, CategoryList } from '../types.ts';
import {
	ANNOUNCEMENT_LIST_KV_KEY,
	ANNOUNCEMENT_LIST_R2_KEY,
	readAnnouncementList,
	writeAnnouncementList
} from './announcement-list-store.ts';
import {
	CATEGORY_LIST_KV_KEY,
	CATEGORY_LIST_R2_KEY,
	readCategoryList,
	writeCategoryList
} from './category-list-store.ts';
import {
	MetadataListConflictError,
	MetadataListStorageUnavailableError
} from './metadata-list-store.ts';

function categoryList(name = '客户端'): CategoryList {
	return {
		items: [
			{
				id: 'cat-1',
				name,
				order: 0,
				createdAt: 1,
				updatedAt: 1
			}
		],
		lastUpdated: 1
	};
}

function announcementList(title = '公告'): AnnouncementList {
	return {
		items: [
			{
				id: 'announcement-1',
				title,
				content: '内容',
				visible: true,
				pinned: false,
				createdAt: 1,
				updatedAt: 1
			}
		],
		lastUpdated: 1
	};
}

function createKv(initial: Record<string, unknown> = {}): KVNamespace {
	const values = new Map(
		Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)])
	);
	return {
		async get(key: string, type?: string) {
			const value = values.get(key);
			if (value === undefined) return null;
			return type === 'json' ? JSON.parse(value) : value;
		},
		async put(key: string, value: string) {
			values.set(key, value);
		}
	} as unknown as KVNamespace;
}

function createR2(onPut?: (key: string, options: R2PutOptions | undefined) => void): R2Bucket {
	const values = new Map<string, { value: string; etag: string }>();
	let version = 0;
	return {
		async get(key: string) {
			const stored = values.get(key);
			if (!stored) return null;
			return {
				etag: stored.etag,
				async json() {
					return JSON.parse(stored.value);
				}
			} as unknown as R2ObjectBody;
		},
		async put(key: string, value: string, options?: R2PutOptions) {
			onPut?.(key, options);
			const existing = values.get(key);
			const onlyIf = options?.onlyIf;
			if (!(onlyIf instanceof Headers) && onlyIf?.etagDoesNotMatch === '*' && existing) {
				return null;
			}
			if (
				!(onlyIf instanceof Headers) &&
				onlyIf?.etagMatches !== undefined &&
				onlyIf.etagMatches !== existing?.etag
			) {
				return null;
			}
			const stored = { value, etag: `etag-${++version}` };
			values.set(key, stored);
			return { etag: stored.etag } as R2Object;
		}
	} as unknown as R2Bucket;
}

test('reads categories and announcements from isolated canonical R2 metadata objects', async () => {
	const r2 = createR2();
	await r2.put(CATEGORY_LIST_R2_KEY, JSON.stringify(categoryList()));
	await r2.put(ANNOUNCEMENT_LIST_R2_KEY, JSON.stringify(announcementList()));

	assert.equal((await readCategoryList(undefined, r2)).list.items[0].name, '客户端');
	assert.equal((await readAnnouncementList(undefined, r2)).list.items[0].title, '公告');
	assert.notEqual(CATEGORY_LIST_R2_KEY, ANNOUNCEMENT_LIST_R2_KEY);
});

test('rejects stale category and announcement updates instead of losing the winning write', async () => {
	const kv = createKv({
		[CATEGORY_LIST_KV_KEY]: categoryList(),
		[ANNOUNCEMENT_LIST_KV_KEY]: announcementList()
	});
	const r2 = createR2();
	await r2.put(CATEGORY_LIST_R2_KEY, JSON.stringify(categoryList()));
	await r2.put(ANNOUNCEMENT_LIST_R2_KEY, JSON.stringify(announcementList()));

	const categoryWinner = await readCategoryList(kv, r2);
	const staleCategory = await readCategoryList(kv, r2);
	await writeCategoryList(categoryWinner, categoryList('游戏客户端'), kv, r2);
	await assert.rejects(
		() => writeCategoryList(staleCategory, categoryList('丢失的修改'), kv, r2),
		MetadataListConflictError
	);
	assert.equal((await readCategoryList(undefined, r2)).list.items[0].name, '游戏客户端');

	const announcementWinner = await readAnnouncementList(kv, r2);
	const staleAnnouncement = await readAnnouncementList(kv, r2);
	await writeAnnouncementList(announcementWinner, announcementList('最新公告'), kv, r2);
	await assert.rejects(
		() => writeAnnouncementList(staleAnnouncement, announcementList('丢失的公告'), kv, r2),
		MetadataListConflictError
	);
	assert.equal((await readAnnouncementList(undefined, r2)).list.items[0].title, '最新公告');
});

test('never performs a runtime KV-to-R2 migration when canonical metadata is missing', async () => {
	const puts: string[] = [];
	const r2 = createR2((key) => puts.push(key));
	const kv = createKv({
		[CATEGORY_LIST_KV_KEY]: categoryList(),
		[ANNOUNCEMENT_LIST_KV_KEY]: announcementList()
	});

	await assert.rejects(
		() => readCategoryList(kv, r2),
		/explicit metadata migration before serving requests/i
	);
	await assert.rejects(
		() => readAnnouncementList(kv, r2),
		/explicit metadata migration before serving requests/i
	);
	assert.deepEqual(puts, []);
});

test('rejects invalid canonical R2 metadata instead of falling back to KV', async () => {
	const r2 = createR2();
	await r2.put(CATEGORY_LIST_R2_KEY, JSON.stringify({ items: [{ id: 'broken' }], lastUpdated: 1 }));
	await r2.put(
		ANNOUNCEMENT_LIST_R2_KEY,
		JSON.stringify({
			items: [
				{ ...announcementList().items[0], id: 'duplicate' },
				{ ...announcementList().items[0], id: 'duplicate' }
			],
			lastUpdated: 1
		})
	);
	const kv = createKv({
		[CATEGORY_LIST_KV_KEY]: categoryList(),
		[ANNOUNCEMENT_LIST_KV_KEY]: announcementList()
	});

	await assert.rejects(
		() => readCategoryList(kv, r2),
		/Canonical R2 category list snapshot is invalid/
	);
	await assert.rejects(
		() => readAnnouncementList(kv, r2),
		/Canonical R2 announcement list snapshot is invalid/
	);
});

test('fails closed without R2 unless KV-only local development is explicitly enabled', async () => {
	const kv = createKv({ [CATEGORY_LIST_KV_KEY]: categoryList() });
	await assert.rejects(() => readCategoryList(kv, undefined), MetadataListStorageUnavailableError);

	const options = { allowKvOnlyForLocalDevelopment: true };
	const snapshot = await readCategoryList(kv, undefined, options);
	await writeCategoryList(snapshot, categoryList('本地分类'), kv, undefined, options);
	assert.equal((await readCategoryList(kv, undefined, options)).list.items[0].name, '本地分类');
});

test('does not fall back to stale KV when canonical R2 reads fail', async () => {
	const kv = createKv({ [ANNOUNCEMENT_LIST_KV_KEY]: announcementList('旧公告') });
	const unavailableR2 = {
		async get() {
			throw new Error('R2 unavailable');
		}
	} as unknown as R2Bucket;

	await assert.rejects(() => readAnnouncementList(kv, unavailableR2), /R2 unavailable/);
});
