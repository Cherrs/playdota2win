import { json, type RequestHandler } from '@sveltejs/kit';
import type {
	ApiResponse,
	Category,
	CategoryList,
	CategoryFormData,
	DownloadList
} from '$lib/types';
import { requireAdminAuth } from '$lib/admin-auth';

const CATEGORIES_KEY = 'categories_list';

/**
 * GET - 获取所有分类（管理员）
 */
export const GET: RequestHandler = async ({ request, platform }) => {
	const jwtSecret = platform?.env.ADMIN_JWT_SECRET;
	const isAuthed = await requireAdminAuth(request, jwtSecret, platform?.env.APP_KV);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

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

/**
 * POST - 创建分类
 */
export const POST: RequestHandler = async ({ request, platform }) => {
	const jwtSecret = platform?.env.ADMIN_JWT_SECRET;
	const isAuthed = await requireAdminAuth(request, jwtSecret, platform?.env.APP_KV);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			return json({ success: false, error: 'KV 存储不可用' } satisfies ApiResponse, {
				status: 500
			});
		}

		const formData = (await request.json()) as CategoryFormData;
		if (!formData.name?.trim()) {
			return json({ success: false, error: '分类名称不能为空' } satisfies ApiResponse, {
				status: 400
			});
		}

		// 获取现有列表
		const stored = await kv.get<CategoryList>(CATEGORIES_KEY, 'json');
		const items = stored?.items || [];

		// 检查名称是否重复
		const nameExists = items.some((cat) => cat.name === formData.name.trim());
		if (nameExists) {
			return json({ success: false, error: '分类名称已存在' } satisfies ApiResponse, {
				status: 400
			});
		}

		// 创建新分类
		const now = Date.now();
		const newCategory: Category = {
			id: `cat_${now}_${Math.random().toString(36).substring(2, 9)}`,
			name: formData.name.trim(),
			icon: formData.icon?.trim() || undefined,
			color: formData.color?.trim() || undefined,
			description: formData.description?.trim() || undefined,
			order: formData.order ?? items.length,
			createdAt: now,
			updatedAt: now
		};

		// 保存
		const newList: CategoryList = {
			items: [...items, newCategory],
			lastUpdated: now
		};

		await kv.put(CATEGORIES_KEY, JSON.stringify(newList));

		return json({ success: true, data: newCategory } satisfies ApiResponse<Category>);
	} catch (e) {
		console.error('Failed to create category:', e);
		return json({ success: false, error: '创建分类失败' } satisfies ApiResponse, { status: 500 });
	}
};

/**
 * PUT - 更新分类
 */
export const PUT: RequestHandler = async ({ request, platform }) => {
	const jwtSecret = platform?.env.ADMIN_JWT_SECRET;
	const isAuthed = await requireAdminAuth(request, jwtSecret, platform?.env.APP_KV);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			return json({ success: false, error: 'KV 存储不可用' } satisfies ApiResponse, {
				status: 500
			});
		}

		const body = (await request.json()) as { id: string } & Partial<CategoryFormData>;
		if (!body.id) {
			return json({ success: false, error: '缺少分类 ID' } satisfies ApiResponse, { status: 400 });
		}

		// 获取现有列表
		const stored = await kv.get<CategoryList>(CATEGORIES_KEY, 'json');
		const items = stored?.items || [];

		const index = items.findIndex((cat) => cat.id === body.id);
		if (index === -1) {
			return json({ success: false, error: '分类不存在' } satisfies ApiResponse, { status: 404 });
		}

		// 检查名称是否与其他分类重复
		if (body.name) {
			const nameExists = items.some((cat, idx) => idx !== index && cat.name === body.name!.trim());
			if (nameExists) {
				return json({ success: false, error: '分类名称已存在' } satisfies ApiResponse, {
					status: 400
				});
			}
		}

		// 更新分类
		const now = Date.now();
		const updatedCategory: Category = {
			...items[index],
			...(body.name && { name: body.name.trim() }),
			...(body.icon !== undefined && { icon: body.icon.trim() || undefined }),
			...(body.color !== undefined && { color: body.color.trim() || undefined }),
			...(body.description !== undefined && { description: body.description.trim() || undefined }),
			...(body.order !== undefined && { order: body.order }),
			updatedAt: now
		};

		items[index] = updatedCategory;

		// 保存
		const newList: CategoryList = {
			items,
			lastUpdated: now
		};

		await kv.put(CATEGORIES_KEY, JSON.stringify(newList));

		return json({ success: true, data: updatedCategory } satisfies ApiResponse<Category>);
	} catch (e) {
		console.error('Failed to update category:', e);
		return json({ success: false, error: '更新分类失败' } satisfies ApiResponse, { status: 500 });
	}
};

/**
 * DELETE - 删除分类
 */
export const DELETE: RequestHandler = async ({ request, platform }) => {
	const jwtSecret = platform?.env.ADMIN_JWT_SECRET;
	const isAuthed = await requireAdminAuth(request, jwtSecret, platform?.env.APP_KV);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			return json({ success: false, error: 'KV 存储不可用' } satisfies ApiResponse, {
				status: 500
			});
		}

		const body = (await request.json()) as { id: string };
		if (!body.id) {
			return json({ success: false, error: '缺少分类 ID' } satisfies ApiResponse, { status: 400 });
		}

		// 获取现有列表
		const stored = await kv.get<CategoryList>(CATEGORIES_KEY, 'json');
		const items = stored?.items || [];

		const index = items.findIndex((cat) => cat.id === body.id);
		if (index === -1) {
			return json({ success: false, error: '分类不存在' } satisfies ApiResponse, { status: 404 });
		}

		// 删除分类
		items.splice(index, 1);

		const now = Date.now();
		const downloads = await kv.get<DownloadList>('downloads_list', 'json');
		if (downloads?.items?.length) {
			let changed = false;
			const updatedItems = downloads.items.map((item) => {
				if (item.categoryId !== body.id) {
					return item;
				}
				changed = true;
				return {
					...item,
					categoryId: undefined,
					updatedAt: now
				};
			});

			if (changed) {
				await kv.put(
					'downloads_list',
					JSON.stringify({
						...downloads,
						items: updatedItems,
						lastUpdated: now
					})
				);
			}
		}

		// 保存
		const newList: CategoryList = {
			items,
			lastUpdated: now
		};

		await kv.put(CATEGORIES_KEY, JSON.stringify(newList));

		return json({ success: true } satisfies ApiResponse);
	} catch (e) {
		console.error('Failed to delete category:', e);
		return json({ success: false, error: '删除分类失败' } satisfies ApiResponse, { status: 500 });
	}
};
