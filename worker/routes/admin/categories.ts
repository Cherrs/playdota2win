import { json, type RequestHandler } from '../../http';
import type { ApiResponse, Category, CategoryList, CategoryFormData } from '$lib/types';
import { requireAdminAuth } from '$lib/admin-auth';
import { readCategoryList, writeCategoryList } from '$lib/server/category-list-store';
import { MetadataListConflictError } from '$lib/server/metadata-list-store';

const MAX_CATEGORIES = 200;

interface CategoryOrderUpdate {
	id: string;
	order: number;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	return Object.keys(value).every((key) => allowed.includes(key));
}

function isValidOrder(value: unknown): value is number {
	return (
		typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_CATEGORIES
	);
}

function normalizeOptionalText(value: unknown, maxLength: number): string | undefined | null {
	if (value === undefined) return undefined;
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	return normalized.length <= maxLength ? normalized || undefined : null;
}

function normalizeColor(value: unknown): string | undefined | null {
	const normalized = normalizeOptionalText(value, 9);
	if (normalized === undefined) return undefined;
	if (
		normalized === null ||
		!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(normalized)
	) {
		return null;
	}
	return normalized;
}

/**
 * GET - 获取所有分类（管理员）
 */
export const GET: RequestHandler = async ({ request, platform }) => {
	const jwtSecret = platform?.env?.ADMIN_JWT_SECRET;
	const isAuthed = await requireAdminAuth(request, jwtSecret, platform?.env?.APP_KV);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env?.APP_KV;
		const { list: stored } = await readCategoryList(kv, platform?.env?.UPLOADS_BUCKET);

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
	const jwtSecret = platform?.env?.ADMIN_JWT_SECRET;
	const isAuthed = await requireAdminAuth(request, jwtSecret, platform?.env?.APP_KV);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env?.APP_KV;
		const r2 = platform?.env?.UPLOADS_BUCKET;

		const rawBody = (await request.json()) as unknown;
		if (
			!isPlainRecord(rawBody) ||
			!hasOnlyKeys(rawBody, ['name', 'icon', 'color', 'description', 'order'])
		) {
			return json({ success: false, error: '分类请求格式不正确' } satisfies ApiResponse, {
				status: 400
			});
		}
		const formData = rawBody as unknown as CategoryFormData;
		if (typeof formData.name !== 'string' || !formData.name.trim()) {
			return json({ success: false, error: '分类名称不能为空' } satisfies ApiResponse, {
				status: 400
			});
		}
		const name = formData.name.trim();
		const icon = normalizeOptionalText(formData.icon, 32);
		const color = normalizeColor(formData.color);
		const description = normalizeOptionalText(formData.description, 500);
		if (
			name.length > 64 ||
			icon === null ||
			color === null ||
			description === null ||
			(formData.order !== undefined && !isValidOrder(formData.order))
		) {
			return json({ success: false, error: '分类字段格式或长度不正确' } satisfies ApiResponse, {
				status: 400
			});
		}

		// 获取现有列表
		const snapshot = await readCategoryList(kv, r2);
		const items = snapshot.list.items;
		if (items.length >= MAX_CATEGORIES) {
			return json({ success: false, error: '分类数量已达上限' } satisfies ApiResponse, {
				status: 400
			});
		}

		// 检查名称是否重复
		const nameExists = items.some((cat) => cat.name === name);
		if (nameExists) {
			return json({ success: false, error: '分类名称已存在' } satisfies ApiResponse, {
				status: 400
			});
		}

		// 创建新分类
		const now = Date.now();
		const newCategory: Category = {
			id: `cat_${crypto.randomUUID()}`,
			name,
			icon,
			color,
			description,
			order: formData.order ?? items.length,
			createdAt: now,
			updatedAt: now
		};

		// 保存
		const newList: CategoryList = {
			items: [...items, newCategory],
			lastUpdated: now
		};

		await writeCategoryList(snapshot, newList, kv, r2);

		return json({ success: true, data: newCategory } satisfies ApiResponse<Category>);
	} catch (e) {
		console.error('Failed to create category:', e);
		return json(
			{
				success: false,
				error:
					e instanceof MetadataListConflictError ? '分类列表已变化，请刷新后重试' : '创建分类失败'
			} satisfies ApiResponse,
			{ status: e instanceof MetadataListConflictError ? 409 : 500 }
		);
	}
};

/**
 * PUT - 更新分类
 */
export const PUT: RequestHandler = async ({ request, platform }) => {
	const jwtSecret = platform?.env?.ADMIN_JWT_SECRET;
	const isAuthed = await requireAdminAuth(request, jwtSecret, platform?.env?.APP_KV);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env?.APP_KV;
		const r2 = platform?.env?.UPLOADS_BUCKET;

		const rawBody = (await request.json()) as unknown;
		if (!isPlainRecord(rawBody)) {
			return json({ success: false, error: '分类请求格式不正确' } satisfies ApiResponse, {
				status: 400
			});
		}
		const body = rawBody as {
			id?: string;
			orders?: CategoryOrderUpdate[];
		} & Partial<CategoryFormData>;

		if (body.orders !== undefined) {
			if (!hasOnlyKeys(rawBody, ['orders'])) {
				return json({ success: false, error: '排序请求包含未知字段' } satisfies ApiResponse, {
					status: 400
				});
			}
			const snapshot = await readCategoryList(kv, r2);
			const items = [...snapshot.list.items];
			if (
				!Array.isArray(body.orders) ||
				body.orders.length !== items.length ||
				body.orders.length > MAX_CATEGORIES
			) {
				return json({ success: false, error: '排序数据不完整' } satisfies ApiResponse, {
					status: 400
				});
			}

			const orders = new Map<string, number>();
			const orderValues = new Set<number>();
			for (const entry of body.orders) {
				if (
					!isPlainRecord(entry) ||
					!hasOnlyKeys(entry, ['id', 'order']) ||
					typeof entry.id !== 'string' ||
					!isValidOrder(entry.order) ||
					entry.order >= items.length ||
					orders.has(entry.id) ||
					orderValues.has(entry.order)
				) {
					return json({ success: false, error: '排序数据无效' } satisfies ApiResponse, {
						status: 400
					});
				}
				orders.set(entry.id, entry.order);
				orderValues.add(entry.order);
			}

			if (items.some((item) => !orders.has(item.id))) {
				return json({ success: false, error: '排序数据包含未知分类' } satisfies ApiResponse, {
					status: 400
				});
			}

			const now = Date.now();
			const reordered = items
				.map((item) => ({ ...item, order: orders.get(item.id)!, updatedAt: now }))
				.sort((left, right) => left.order - right.order);
			const newList: CategoryList = { items: reordered, lastUpdated: now };
			const committed = await writeCategoryList(snapshot, newList, kv, r2);
			return json({ success: true, data: committed.list } satisfies ApiResponse<CategoryList>);
		}

		if (
			!hasOnlyKeys(rawBody, ['id', 'name', 'icon', 'color', 'description', 'order']) ||
			typeof body.id !== 'string' ||
			!body.id ||
			body.id.length > 128 ||
			Object.keys(rawBody).length < 2
		) {
			return json({ success: false, error: '缺少分类 ID' } satisfies ApiResponse, { status: 400 });
		}
		const snapshot = await readCategoryList(kv, r2);
		const items = [...snapshot.list.items];

		const index = items.findIndex((cat) => cat.id === body.id);
		if (index === -1) {
			return json({ success: false, error: '分类不存在' } satisfies ApiResponse, { status: 404 });
		}

		// 检查名称是否与其他分类重复
		if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
			return json({ success: false, error: '分类名称不能为空' } satisfies ApiResponse, {
				status: 400
			});
		}
		const name = typeof body.name === 'string' ? body.name.trim() : undefined;
		const icon = normalizeOptionalText(body.icon, 32);
		const color = normalizeColor(body.color);
		const description = normalizeOptionalText(body.description, 500);
		if (
			(name !== undefined && name.length > 64) ||
			icon === null ||
			color === null ||
			description === null ||
			(body.order !== undefined && !isValidOrder(body.order))
		) {
			return json({ success: false, error: '分类字段格式或长度不正确' } satisfies ApiResponse, {
				status: 400
			});
		}

		if (name) {
			const nameExists = items.some((cat, idx) => idx !== index && cat.name === name);
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
			...(name !== undefined && { name }),
			...(body.icon !== undefined && { icon }),
			...(body.color !== undefined && { color }),
			...(body.description !== undefined && { description }),
			...(body.order !== undefined && { order: body.order }),
			updatedAt: now
		};

		items[index] = updatedCategory;

		// 保存
		const newList: CategoryList = {
			items,
			lastUpdated: now
		};

		await writeCategoryList(snapshot, newList, kv, r2);

		return json({ success: true, data: updatedCategory } satisfies ApiResponse<Category>);
	} catch (e) {
		console.error('Failed to update category:', e);
		return json(
			{
				success: false,
				error:
					e instanceof MetadataListConflictError ? '分类列表已变化，请刷新后重试' : '更新分类失败'
			} satisfies ApiResponse,
			{ status: e instanceof MetadataListConflictError ? 409 : 500 }
		);
	}
};

/**
 * DELETE - 删除分类
 */
export const DELETE: RequestHandler = async ({ request, platform }) => {
	const jwtSecret = platform?.env?.ADMIN_JWT_SECRET;
	const isAuthed = await requireAdminAuth(request, jwtSecret, platform?.env?.APP_KV);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env?.APP_KV;
		const r2 = platform?.env?.UPLOADS_BUCKET;

		const rawBody = (await request.json()) as unknown;
		if (
			!isPlainRecord(rawBody) ||
			!hasOnlyKeys(rawBody, ['id']) ||
			typeof rawBody.id !== 'string' ||
			!rawBody.id ||
			rawBody.id.length > 128
		) {
			return json({ success: false, error: '缺少分类 ID' } satisfies ApiResponse, { status: 400 });
		}
		const body = rawBody as { id: string };

		// 获取现有列表
		const categorySnapshot = await readCategoryList(kv, r2);
		const items = [...categorySnapshot.list.items];

		const index = items.findIndex((cat) => cat.id === body.id);
		if (index === -1) {
			return json({ success: false, error: '分类不存在' } satisfies ApiResponse, { status: 404 });
		}

		// 删除分类
		items.splice(index, 1);

		const now = Date.now();
		// 下载项中的旧 categoryId 会自然按“未分类”处理；不跨两个 R2 对象伪造事务。
		const newList: CategoryList = {
			items,
			lastUpdated: now
		};

		await writeCategoryList(categorySnapshot, newList, kv, r2);

		return json({ success: true } satisfies ApiResponse);
	} catch (e) {
		console.error('Failed to delete category:', e);
		const isCategoryConflict = e instanceof MetadataListConflictError;
		return json(
			{
				success: false,
				error: isCategoryConflict ? '分类列表已变化，请刷新后重试' : '删除分类失败'
			} satisfies ApiResponse,
			{ status: isCategoryConflict ? 409 : 500 }
		);
	}
};
