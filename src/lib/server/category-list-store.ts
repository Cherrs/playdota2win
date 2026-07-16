import type { Category, CategoryList } from '../types.ts';
import {
	readMetadataList,
	writeMetadataList,
	type MetadataListSnapshot,
	type MetadataListStoreOptions
} from './metadata-list-store.ts';

export const CATEGORY_LIST_KV_KEY = 'categories_list';
export const CATEGORY_LIST_R2_KEY = '.metadata/categories-list.json';

function isNonNegativeSafeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === 'string';
}

function isCategory(value: unknown): value is Category {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const item = value as Record<string, unknown>;
	return (
		typeof item.id === 'string' &&
		item.id.length > 0 &&
		item.id.length <= 128 &&
		typeof item.name === 'string' &&
		item.name.length > 0 &&
		item.name.length <= 64 &&
		isOptionalString(item.icon) &&
		(item.icon === undefined || item.icon.length <= 32) &&
		isOptionalString(item.color) &&
		(item.color === undefined ||
			/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu.test(item.color)) &&
		isOptionalString(item.description) &&
		(item.description === undefined || item.description.length <= 500) &&
		isNonNegativeSafeInteger(item.order) &&
		isNonNegativeSafeInteger(item.createdAt) &&
		isNonNegativeSafeInteger(item.updatedAt)
	);
}

export function isCategoryList(value: unknown): value is CategoryList {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const list = value as Record<string, unknown>;
	if (
		!Array.isArray(list.items) ||
		list.items.length > 200 ||
		!isNonNegativeSafeInteger(list.lastUpdated)
	)
		return false;
	const ids = new Set<string>();
	for (const item of list.items) {
		if (!isCategory(item) || ids.has(item.id)) return false;
		ids.add(item.id);
	}
	return true;
}

const CATEGORY_LIST_STORE = {
	name: 'category list',
	kvKey: CATEGORY_LIST_KV_KEY,
	r2Key: CATEGORY_LIST_R2_KEY,
	isValid: isCategoryList
} as const;

export function readCategoryList(
	kv: KVNamespace | undefined,
	r2: R2Bucket | undefined,
	options?: MetadataListStoreOptions
): Promise<MetadataListSnapshot<CategoryList>> {
	return readMetadataList(kv, r2, CATEGORY_LIST_STORE, options);
}

export function writeCategoryList(
	snapshot: MetadataListSnapshot<CategoryList>,
	nextList: CategoryList,
	kv: KVNamespace | undefined,
	r2: R2Bucket | undefined,
	options?: MetadataListStoreOptions
): Promise<MetadataListSnapshot<CategoryList>> {
	return writeMetadataList(snapshot, nextList, kv, r2, CATEGORY_LIST_STORE, options);
}
