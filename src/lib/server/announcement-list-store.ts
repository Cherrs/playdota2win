import type { Announcement, AnnouncementList } from '../types.ts';
import {
	readMetadataList,
	writeMetadataList,
	type MetadataListSnapshot,
	type MetadataListStoreOptions
} from './metadata-list-store.ts';

export const ANNOUNCEMENT_LIST_KV_KEY = 'announcements';
export const ANNOUNCEMENT_LIST_R2_KEY = '.metadata/announcements-list.json';

function isNonNegativeSafeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isAnnouncement(value: unknown): value is Announcement {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const item = value as Record<string, unknown>;
	return (
		typeof item.id === 'string' &&
		item.id.length > 0 &&
		item.id.length <= 128 &&
		typeof item.title === 'string' &&
		item.title.length > 0 &&
		item.title.length <= 200 &&
		typeof item.content === 'string' &&
		item.content.length > 0 &&
		item.content.length <= 20_000 &&
		typeof item.visible === 'boolean' &&
		typeof item.pinned === 'boolean' &&
		isNonNegativeSafeInteger(item.createdAt) &&
		isNonNegativeSafeInteger(item.updatedAt)
	);
}

export function isAnnouncementList(value: unknown): value is AnnouncementList {
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
		if (!isAnnouncement(item) || ids.has(item.id)) return false;
		ids.add(item.id);
	}
	return true;
}

const ANNOUNCEMENT_LIST_STORE = {
	name: 'announcement list',
	kvKey: ANNOUNCEMENT_LIST_KV_KEY,
	r2Key: ANNOUNCEMENT_LIST_R2_KEY,
	isValid: isAnnouncementList
} as const;

export function readAnnouncementList(
	kv: KVNamespace | undefined,
	r2: R2Bucket | undefined,
	options?: MetadataListStoreOptions
): Promise<MetadataListSnapshot<AnnouncementList>> {
	return readMetadataList(kv, r2, ANNOUNCEMENT_LIST_STORE, options);
}

export function writeAnnouncementList(
	snapshot: MetadataListSnapshot<AnnouncementList>,
	nextList: AnnouncementList,
	kv: KVNamespace | undefined,
	r2: R2Bucket | undefined,
	options?: MetadataListStoreOptions
): Promise<MetadataListSnapshot<AnnouncementList>> {
	return writeMetadataList(snapshot, nextList, kv, r2, ANNOUNCEMENT_LIST_STORE, options);
}
