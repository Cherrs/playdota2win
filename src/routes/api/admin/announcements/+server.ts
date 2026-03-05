import { json, type RequestHandler } from '@sveltejs/kit';
import type { Announcement, AnnouncementList, AnnouncementFormData, ApiResponse } from '$lib/types';
import { requireAdminAuth } from '$lib/admin-auth';

const KV_KEY = 'announcements';

function sortAnnouncements(items: Announcement[]): Announcement[] {
	return [...items].sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		return b.createdAt - a.createdAt;
	});
}

export const GET: RequestHandler = async ({ request, platform }) => {
	const isAuthed = await requireAdminAuth(request, platform?.env.ADMIN_JWT_SECRET, platform?.env.APP_KV);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			return json({ success: true, data: { items: [], lastUpdated: Date.now() } } satisfies ApiResponse<AnnouncementList>);
		}

		const stored = await kv.get<AnnouncementList>(KV_KEY, 'json');
		const items = sortAnnouncements(stored?.items || []);

		return json({ success: true, data: { items, lastUpdated: stored?.lastUpdated ?? Date.now() } } satisfies ApiResponse<AnnouncementList>);
	} catch (e) {
		console.error('Failed to get announcements:', e);
		return json({ success: false, error: '获取公告列表失败' } satisfies ApiResponse, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, platform }) => {
	const isAuthed = await requireAdminAuth(request, platform?.env.ADMIN_JWT_SECRET, platform?.env.APP_KV);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			return json({ success: false, error: 'KV 存储不可用' } satisfies ApiResponse, { status: 500 });
		}

		const body = (await request.json()) as AnnouncementFormData;
		if (!body.title?.trim()) {
			return json({ success: false, error: '公告标题不能为空' } satisfies ApiResponse, { status: 400 });
		}
		if (!body.content?.trim()) {
			return json({ success: false, error: '公告内容不能为空' } satisfies ApiResponse, { status: 400 });
		}

		const stored = await kv.get<AnnouncementList>(KV_KEY, 'json');
		const items = stored?.items || [];

		const now = Date.now();
		const newItem: Announcement = {
			id: `ann_${now}_${Math.random().toString(36).substring(2, 9)}`,
			title: body.title.trim(),
			content: body.content.trim(),
			visible: body.visible ?? true,
			pinned: body.pinned ?? false,
			createdAt: now,
			updatedAt: now
		};

		const newList: AnnouncementList = {
			items: [...items, newItem],
			lastUpdated: now
		};
		await kv.put(KV_KEY, JSON.stringify(newList));

		return json({ success: true, data: newItem } satisfies ApiResponse<Announcement>);
	} catch (e) {
		console.error('Failed to create announcement:', e);
		return json({ success: false, error: '创建公告失败' } satisfies ApiResponse, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ request, platform }) => {
	const isAuthed = await requireAdminAuth(request, platform?.env.ADMIN_JWT_SECRET, platform?.env.APP_KV);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			return json({ success: false, error: 'KV 存储不可用' } satisfies ApiResponse, { status: 500 });
		}

		const body = (await request.json()) as { id: string } & Partial<AnnouncementFormData>;
		if (!body.id) {
			return json({ success: false, error: '缺少公告 ID' } satisfies ApiResponse, { status: 400 });
		}
		if (body.title !== undefined && !body.title.trim()) {
			return json({ success: false, error: '公告标题不能为空' } satisfies ApiResponse, { status: 400 });
		}
		if (body.content !== undefined && !body.content.trim()) {
			return json({ success: false, error: '公告内容不能为空' } satisfies ApiResponse, { status: 400 });
		}

		const stored = await kv.get<AnnouncementList>(KV_KEY, 'json');
		const items = stored?.items || [];
		const index = items.findIndex((a) => a.id === body.id);
		if (index === -1) {
			return json({ success: false, error: '公告不存在' } satisfies ApiResponse, { status: 404 });
		}

		const now = Date.now();
		const updated: Announcement = {
			...items[index],
			...(body.title !== undefined && { title: body.title.trim() }),
			...(body.content !== undefined && { content: body.content.trim() }),
			...(body.visible !== undefined && { visible: body.visible }),
			...(body.pinned !== undefined && { pinned: body.pinned }),
			updatedAt: now
		};
		items[index] = updated;

		await kv.put(KV_KEY, JSON.stringify({ items, lastUpdated: now }));

		return json({ success: true, data: updated } satisfies ApiResponse<Announcement>);
	} catch (e) {
		console.error('Failed to update announcement:', e);
		return json({ success: false, error: '更新公告失败' } satisfies ApiResponse, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request, platform }) => {
	const isAuthed = await requireAdminAuth(request, platform?.env.ADMIN_JWT_SECRET, platform?.env.APP_KV);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			return json({ success: false, error: 'KV 存储不可用' } satisfies ApiResponse, { status: 500 });
		}

		const body = (await request.json()) as { id: string };
		if (!body.id) {
			return json({ success: false, error: '缺少公告 ID' } satisfies ApiResponse, { status: 400 });
		}

		const stored = await kv.get<AnnouncementList>(KV_KEY, 'json');
		const items = stored?.items || [];
		const index = items.findIndex((a) => a.id === body.id);
		if (index === -1) {
			return json({ success: false, error: '公告不存在' } satisfies ApiResponse, { status: 404 });
		}

		items.splice(index, 1);
		const now = Date.now();
		await kv.put(KV_KEY, JSON.stringify({ items, lastUpdated: now }));

		return json({ success: true } satisfies ApiResponse);
	} catch (e) {
		console.error('Failed to delete announcement:', e);
		return json({ success: false, error: '删除公告失败' } satisfies ApiResponse, { status: 500 });
	}
};
