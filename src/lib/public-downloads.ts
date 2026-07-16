import type {
	DownloadItem,
	DownloadList,
	PublicDownloadItem,
	PublicDownloadList
} from './types.ts';

function normalizePublicDownloadCount(value: number | undefined): number {
	return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0;
}

export function toPublicDownloadItem(item: DownloadItem, downloadCount = 0): PublicDownloadItem {
	return {
		id: item.id,
		platform: item.platform,
		...(item.categoryId ? { categoryId: item.categoryId } : {}),
		...(item.title ? { title: item.title } : {}),
		...(item.description ? { description: item.description } : {}),
		...(item.filename ? { filename: item.filename } : {}),
		version: item.version,
		size: item.size,
		storageType: item.storageType,
		enabled: true,
		downloadCount: normalizePublicDownloadCount(downloadCount)
	};
}

export function toPublicDownloadList(
	list: DownloadList,
	downloadCounts: ReadonlyMap<string, number> = new Map()
): PublicDownloadList {
	const items = list.items
		.filter((item) => item.enabled)
		.map((item) => toPublicDownloadItem(item, downloadCounts.get(item.id)));

	return {
		items,
		downloadCount: items.reduce(
			(total, item) => Math.min(total + item.downloadCount, Number.MAX_SAFE_INTEGER),
			0
		),
		lastUpdated: Number.isFinite(list.lastUpdated) ? list.lastUpdated : Date.now()
	};
}
