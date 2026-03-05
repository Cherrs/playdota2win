import { json, type RequestHandler } from '@sveltejs/kit';
import type { AnnouncementList, ApiResponse } from '$lib/types';

const KV_KEY = 'announcements';

export const GET: RequestHandler = async ({ platform }) => {
	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			// 开发环境返回示例数据
			return json({
				success: true,
				data: {
					items: [
						{
							id: 'demo-1',
							title: '欢迎使用下载站',
							content: '这里是**示例公告**，支持 Markdown 格式。',
							visible: true,
							pinned: true,
							createdAt: Date.now(),
							updatedAt: Date.now()
						}
					],
					lastUpdated: Date.now()
				}
			} satisfies ApiResponse<AnnouncementList>);
		}

		const stored = await kv.get<AnnouncementList>(KV_KEY, 'json');
		const allItems = stored?.items || [];

		// 只返回 visible 公告，置顶优先，其次按 createdAt 降序
		const visibleItems = allItems
			.filter((a) => a.visible)
			.sort((a, b) => {
				if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
				return b.createdAt - a.createdAt;
			});

		return json({
			success: true,
			data: { items: visibleItems, lastUpdated: stored?.lastUpdated ?? Date.now() }
		} satisfies ApiResponse<AnnouncementList>);
	} catch (error) {
		console.error('Error fetching announcements:', error);
		return json({ success: false, error: '获取公告失败' } satisfies ApiResponse, { status: 500 });
	}
};
