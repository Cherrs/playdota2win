import { json, type RequestHandler } from '@sveltejs/kit';
import type { DownloadList, PublicDownloadList, ApiResponse } from '$lib/types';
import { toPublicDownloadList } from '$lib/public-downloads';
import { createInitialDownloadCounts, readDownloadCounts } from '$lib/server/download-count-store';
import { readDownloadList } from '$lib/server/download-list-store';

const PUBLIC_CACHE_HEADERS = {
	'Cache-Control': 'no-store'
};

// GET: 公开的下载列表 API
export const GET: RequestHandler = async ({ platform }) => {
	try {
		const kv = platform?.env?.APP_KV;
		const r2 = platform?.env?.UPLOADS_BUCKET;
		if (!kv && !r2) {
			// 开发环境返回默认数据
			const defaultList: DownloadList = {
				items: [
					{
						id: 'default-windows',
						platform: 'windows',
						version: 'v1.2.0',
						size: '45MB',
						storageType: 'link',
						url: '#',
						createdAt: Date.now(),
						updatedAt: Date.now(),
						enabled: true
					},
					{
						id: 'default-macos',
						platform: 'macos',
						version: 'v1.2.0',
						size: '52MB',
						storageType: 'link',
						url: '#',
						createdAt: Date.now(),
						updatedAt: Date.now(),
						enabled: true
					}
				],
				downloadCount: 0,
				lastUpdated: Date.now()
			};
			return json(
				{
					success: true,
					data: toPublicDownloadList(defaultList)
				} satisfies ApiResponse<PublicDownloadList>,
				{ headers: PUBLIC_CACHE_HEADERS }
			);
		}

		const { list } = await readDownloadList(kv, r2);
		const enabledItems = list.items.filter((item) => item.enabled);
		let downloadCounts = createInitialDownloadCounts(enabledItems);
		if (kv) {
			try {
				downloadCounts = await readDownloadCounts(kv, enabledItems);
			} catch (error) {
				console.error({
					component: 'download_counts',
					event_name: 'download_count_read_failed',
					message: 'Failed to read independent download counters; using item bootstrap values',
					error_message: error instanceof Error ? error.message : String(error)
				});
			}
		}
		const publicList = toPublicDownloadList(list, downloadCounts);

		return json({ success: true, data: publicList } satisfies ApiResponse<PublicDownloadList>, {
			headers: PUBLIC_CACHE_HEADERS
		});
	} catch (error) {
		console.error('Error fetching downloads:', error);
		return json({ success: false, error: 'Failed to fetch downloads' } satisfies ApiResponse, {
			status: 500
		});
	}
};
