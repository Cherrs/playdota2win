import { json, type RequestHandler } from '@sveltejs/kit';
import type { ApiResponse, CategoryList } from '$lib/types';

const CATEGORIES_KEY = 'categories_list';

/**
 * GET - 获取所有分类（公开接口）
 */
export const GET: RequestHandler = async ({ platform }) => {
	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			return json({
				success: true,
				data: { items: [], lastUpdated: Date.now() }
			} satisfies ApiResponse<CategoryList>);
		}

		const stored = await kv.get<CategoryList>(CATEGORIES_KEY, 'json');
		if (!stored) {
			return json({
				success: true,
				data: { items: [], lastUpdated: Date.now() }
			} satisfies ApiResponse<CategoryList>);
		}

		// 按 order 排序
		const sortedItems = [...stored.items].sort((a, b) => a.order - b.order);

		return json({
			success: true,
			data: { items: sortedItems, lastUpdated: stored.lastUpdated }
		} satisfies ApiResponse<CategoryList>);
	} catch (e) {
		console.error('Failed to get categories:', e);
		return json({ success: false, error: '获取分类列表失败' } satisfies ApiResponse, {
			status: 500
		});
	}
};
