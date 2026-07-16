import type { DownloadItem } from '$lib/types';

export const DOWNLOAD_COUNT_KEY_PREFIX = 'download_count:';

const MAX_BULK_READ_KEYS = 100;
const DOWNLOAD_ITEM_ID_PATTERN = /^[a-z0-9_-]+$/i;
const MAX_DOWNLOAD_ITEM_ID_LENGTH = 128;

type DownloadCountItem = Pick<DownloadItem, 'id' | 'downloadCount'>;

function normalizeDownloadCount(value: unknown, fallback = 0): number {
	if (Number.isSafeInteger(value) && (value as number) >= 0) return value as number;
	return fallback;
}

function parseStoredDownloadCount(value: string | null, fallback: number): number {
	if (value === null) return fallback;
	if (!/^(0|[1-9]\d*)$/.test(value)) return fallback;

	const count = Number(value);
	return normalizeDownloadCount(count, fallback);
}

export function getDownloadCountKey(itemId: string): string {
	if (
		itemId.length === 0 ||
		itemId.length > MAX_DOWNLOAD_ITEM_ID_LENGTH ||
		!DOWNLOAD_ITEM_ID_PATTERN.test(itemId)
	) {
		throw new Error('Invalid download item ID for counter key');
	}

	return `${DOWNLOAD_COUNT_KEY_PREFIX}${itemId}`;
}

export function createInitialDownloadCounts(
	items: readonly DownloadCountItem[]
): Map<string, number> {
	return new Map(
		items.map((item) => [item.id, normalizeDownloadCount(item.downloadCount)] as const)
	);
}

export async function readDownloadCounts(
	kv: KVNamespace,
	items: readonly DownloadCountItem[]
): Promise<Map<string, number>> {
	const uniqueItems = [...new Map(items.map((item) => [item.id, item])).values()];
	const counts = createInitialDownloadCounts(uniqueItems);

	for (let offset = 0; offset < uniqueItems.length; offset += MAX_BULK_READ_KEYS) {
		const batch = uniqueItems.slice(offset, offset + MAX_BULK_READ_KEYS);
		const keys = batch.map((item) => getDownloadCountKey(item.id));
		const storedCounts = await kv.get(keys, 'text');

		for (const item of batch) {
			const key = getDownloadCountKey(item.id);
			const fallback = counts.get(item.id) ?? 0;
			counts.set(item.id, parseStoredDownloadCount(storedCounts.get(key) ?? null, fallback));
		}
	}

	return counts;
}

export async function incrementDownloadCount(
	kv: KVNamespace,
	item: DownloadCountItem
): Promise<number> {
	const key = getDownloadCountKey(item.id);
	const fallback = normalizeDownloadCount(item.downloadCount);
	const current = parseStoredDownloadCount(await kv.get(key, 'text'), fallback);
	const next = Math.min(current + 1, Number.MAX_SAFE_INTEGER);

	if (next !== current) {
		await kv.put(key, String(next));
	}

	return next;
}
