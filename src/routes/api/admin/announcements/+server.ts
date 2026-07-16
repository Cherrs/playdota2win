import { json, type RequestHandler } from '@sveltejs/kit';
import type { Announcement, AnnouncementList, AnnouncementFormData, ApiResponse } from '$lib/types';
import { requireAdminAuth } from '$lib/admin-auth';
import { readAnnouncementList, writeAnnouncementList } from '$lib/server/announcement-list-store';
import { MetadataListConflictError } from '$lib/server/metadata-list-store';

const MAX_ANNOUNCEMENTS = 200;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 20_000;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	return Object.keys(value).every((key) => allowed.includes(key));
}

function validOptionalBoolean(value: unknown): value is boolean | undefined {
	return value === undefined || typeof value === 'boolean';
}

function sortAnnouncements(items: Announcement[]): Announcement[] {
	return [...items].sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		return b.createdAt - a.createdAt;
	});
}

export const GET: RequestHandler = async ({ request, platform }) => {
	const isAuthed = await requireAdminAuth(
		request,
		platform?.env?.ADMIN_JWT_SECRET,
		platform?.env?.APP_KV
	);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env?.APP_KV;
		const { list: stored } = await readAnnouncementList(kv, platform?.env?.UPLOADS_BUCKET);
		const items = sortAnnouncements(stored.items);

		return json({
			success: true,
			data: { items, lastUpdated: stored.lastUpdated }
		} satisfies ApiResponse<AnnouncementList>);
	} catch (e) {
		console.error('Failed to get announcements:', e);
		return json({ success: false, error: '获取公告列表失败' } satisfies ApiResponse, {
			status: 500
		});
	}
};

export const POST: RequestHandler = async ({ request, platform }) => {
	const isAuthed = await requireAdminAuth(
		request,
		platform?.env?.ADMIN_JWT_SECRET,
		platform?.env?.APP_KV
	);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env?.APP_KV;
		const r2 = platform?.env?.UPLOADS_BUCKET;

		const rawBody = (await request.json()) as unknown;
		if (
			!isPlainRecord(rawBody) ||
			!hasOnlyKeys(rawBody, ['title', 'content', 'visible', 'pinned'])
		) {
			return json({ success: false, error: '公告请求格式不正确' } satisfies ApiResponse, {
				status: 400
			});
		}
		const body = rawBody as unknown as AnnouncementFormData;
		if (typeof body.title !== 'string' || !body.title.trim()) {
			return json({ success: false, error: '公告标题不能为空' } satisfies ApiResponse, {
				status: 400
			});
		}
		if (typeof body.content !== 'string' || !body.content.trim()) {
			return json({ success: false, error: '公告内容不能为空' } satisfies ApiResponse, {
				status: 400
			});
		}
		if (
			body.title.length > MAX_TITLE_LENGTH ||
			body.content.length > MAX_CONTENT_LENGTH ||
			!validOptionalBoolean(body.visible) ||
			!validOptionalBoolean(body.pinned)
		) {
			return json({ success: false, error: '公告字段格式或长度不正确' } satisfies ApiResponse, {
				status: 400
			});
		}

		const snapshot = await readAnnouncementList(kv, r2);
		const items = snapshot.list.items;
		if (items.length >= MAX_ANNOUNCEMENTS) {
			return json({ success: false, error: '公告数量已达上限' } satisfies ApiResponse, {
				status: 400
			});
		}

		const now = Date.now();
		const newItem: Announcement = {
			id: `ann_${crypto.randomUUID()}`,
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
		await writeAnnouncementList(snapshot, newList, kv, r2);

		return json({ success: true, data: newItem } satisfies ApiResponse<Announcement>);
	} catch (e) {
		console.error('Failed to create announcement:', e);
		return json(
			{
				success: false,
				error:
					e instanceof MetadataListConflictError ? '公告列表已变化，请刷新后重试' : '创建公告失败'
			} satisfies ApiResponse,
			{ status: e instanceof MetadataListConflictError ? 409 : 500 }
		);
	}
};

export const PUT: RequestHandler = async ({ request, platform }) => {
	const isAuthed = await requireAdminAuth(
		request,
		platform?.env?.ADMIN_JWT_SECRET,
		platform?.env?.APP_KV
	);
	if (!isAuthed) {
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });
	}

	try {
		const kv = platform?.env?.APP_KV;
		const r2 = platform?.env?.UPLOADS_BUCKET;

		const rawBody = (await request.json()) as unknown;
		if (
			!isPlainRecord(rawBody) ||
			!hasOnlyKeys(rawBody, ['id', 'title', 'content', 'visible', 'pinned'])
		) {
			return json({ success: false, error: '公告请求格式不正确' } satisfies ApiResponse, {
				status: 400
			});
		}
		const body = rawBody as unknown as { id: string } & Partial<AnnouncementFormData>;
		if (typeof body.id !== 'string' || !body.id || body.id.length > 128) {
			return json({ success: false, error: '缺少公告 ID' } satisfies ApiResponse, { status: 400 });
		}
		if (Object.keys(rawBody).length < 2) {
			return json({ success: false, error: '没有可更新的公告字段' } satisfies ApiResponse, {
				status: 400
			});
		}
		if (body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim())) {
			return json({ success: false, error: '公告标题不能为空' } satisfies ApiResponse, {
				status: 400
			});
		}
		if (body.content !== undefined && (typeof body.content !== 'string' || !body.content.trim())) {
			return json({ success: false, error: '公告内容不能为空' } satisfies ApiResponse, {
				status: 400
			});
		}
		if (
			(body.title !== undefined && body.title.length > MAX_TITLE_LENGTH) ||
			(body.content !== undefined && body.content.length > MAX_CONTENT_LENGTH) ||
			!validOptionalBoolean(body.visible) ||
			!validOptionalBoolean(body.pinned)
		) {
			return json({ success: false, error: '公告字段格式或长度不正确' } satisfies ApiResponse, {
				status: 400
			});
		}

		const snapshot = await readAnnouncementList(kv, r2);
		const items = [...snapshot.list.items];
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

		await writeAnnouncementList(snapshot, { items, lastUpdated: now }, kv, r2);

		return json({ success: true, data: updated } satisfies ApiResponse<Announcement>);
	} catch (e) {
		console.error('Failed to update announcement:', e);
		return json(
			{
				success: false,
				error:
					e instanceof MetadataListConflictError ? '公告列表已变化，请刷新后重试' : '更新公告失败'
			} satisfies ApiResponse,
			{ status: e instanceof MetadataListConflictError ? 409 : 500 }
		);
	}
};

export const DELETE: RequestHandler = async ({ request, platform }) => {
	const isAuthed = await requireAdminAuth(
		request,
		platform?.env?.ADMIN_JWT_SECRET,
		platform?.env?.APP_KV
	);
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
			return json({ success: false, error: '缺少公告 ID' } satisfies ApiResponse, { status: 400 });
		}
		const body = rawBody as { id: string };

		const snapshot = await readAnnouncementList(kv, r2);
		const items = [...snapshot.list.items];
		const index = items.findIndex((a) => a.id === body.id);
		if (index === -1) {
			return json({ success: false, error: '公告不存在' } satisfies ApiResponse, { status: 404 });
		}

		items.splice(index, 1);
		const now = Date.now();
		await writeAnnouncementList(snapshot, { items, lastUpdated: now }, kv, r2);

		return json({ success: true } satisfies ApiResponse);
	} catch (e) {
		console.error('Failed to delete announcement:', e);
		return json(
			{
				success: false,
				error:
					e instanceof MetadataListConflictError ? '公告列表已变化，请刷新后重试' : '删除公告失败'
			} satisfies ApiResponse,
			{ status: e instanceof MetadataListConflictError ? 409 : 500 }
		);
	}
};
