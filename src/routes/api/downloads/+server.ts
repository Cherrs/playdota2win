import { json, type RequestHandler } from '@sveltejs/kit';
import type { DownloadList, ApiResponse } from '$lib/types';

const KV_KEY = 'downloads_list';

// GET: 公开的下载列表 API
export const GET: RequestHandler = async ({ platform }) => {
	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
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
				downloadCount: 12580,
				lastUpdated: Date.now()
			};
			return json({ success: true, data: defaultList } satisfies ApiResponse<DownloadList>);
		}
		
		const data = await kv.get<DownloadList>(KV_KEY, 'json');
		const list = data || { items: [], downloadCount: 12580, lastUpdated: Date.now() };
		
		// 只返回启用的下载项
		const publicList: DownloadList = {
			...list,
			items: list.items.filter(item => item.enabled)
		};
		
		return json({ success: true, data: publicList } satisfies ApiResponse<DownloadList>);
	} catch (error) {
		console.error('Error fetching downloads:', error);
		return json({ success: false, error: 'Failed to fetch downloads' } satisfies ApiResponse, { status: 500 });
	}
};

// POST: 记录下载次数
export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			return json({ success: true, data: { count: 12580 } } satisfies ApiResponse);
		}
		
		const { itemId } = await request.json() as { itemId?: string };
		
		const data = await kv.get<DownloadList>(KV_KEY, 'json');
		if (data) {
			data.downloadCount = (data.downloadCount || 0) + 1;
			await kv.put(KV_KEY, JSON.stringify(data));
			return json({ success: true, data: { count: data.downloadCount } } satisfies ApiResponse);
		}
		
		return json({ success: true, data: { count: 12580 } } satisfies ApiResponse);
	} catch (error) {
		console.error('Error recording download:', error);
		return json({ success: false, error: 'Failed to record download' } satisfies ApiResponse, { status: 500 });
	}
};
