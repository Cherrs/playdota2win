import { json, type RequestHandler } from '@sveltejs/kit';
import type { AnnouncementList, ApiResponse } from '$lib/types';
import { readAnnouncementList } from '$lib/server/announcement-list-store';

const PUBLIC_CACHE_HEADERS = {
	'Cache-Control': 'public, max-age=30, stale-while-revalidate=120'
};

export const GET: RequestHandler = async ({ platform }) => {
	try {
		const kv = platform?.env?.APP_KV;
		const { list: stored } = await readAnnouncementList(kv, platform?.env?.UPLOADS_BUCKET);
		const allItems = stored.items;

		// 只返回 visible 公告，置顶优先，其次按 createdAt 降序
		const visibleItems = allItems
			.filter((a) => a.visible)
			.sort((a, b) => {
				if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
				return b.createdAt - a.createdAt;
			});

		return json(
			{
				success: true,
				data: { items: visibleItems, lastUpdated: stored.lastUpdated }
			} satisfies ApiResponse<AnnouncementList>,
			{ headers: PUBLIC_CACHE_HEADERS }
		);
	} catch (error) {
		console.error('Error fetching announcements:', error);
		return json({ success: false, error: '获取公告失败' } satisfies ApiResponse, { status: 500 });
	}
};
