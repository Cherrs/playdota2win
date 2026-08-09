import { json, type RequestHandler } from '../../http';
import type { ApiResponse, CategoryList } from '$lib/types';
import { readCategoryList } from '$lib/server/category-list-store';

const PUBLIC_CACHE_HEADERS = {
	'Cache-Control': 'public, max-age=30, stale-while-revalidate=120'
};

/**
 * GET - 获取所有分类（公开接口）
 */
export const GET: RequestHandler = async ({ platform }) => {
	try {
		const kv = platform?.env?.APP_KV;
		const { list: stored } = await readCategoryList(kv, platform?.env?.UPLOADS_BUCKET);

		// 按 order 排序
		const sortedItems = [...stored.items].sort((a, b) => a.order - b.order);

		return json(
			{
				success: true,
				data: { items: sortedItems, lastUpdated: stored.lastUpdated }
			} satisfies ApiResponse<CategoryList>,
			{ headers: PUBLIC_CACHE_HEADERS }
		);
	} catch (e) {
		console.error('Failed to get categories:', e);
		return json({ success: false, error: '获取分类列表失败' } satisfies ApiResponse, {
			status: 500
		});
	}
};
