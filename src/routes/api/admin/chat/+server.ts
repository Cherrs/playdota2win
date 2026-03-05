import { json, type RequestHandler } from '@sveltejs/kit';
import { requireAdminAuth } from '$lib/admin-auth';

const CHAT_ROOM_NAME = 'global-chat-room';

function getChatRoom(platform: App.Platform | undefined) {
	const ns = platform?.env.CHAT_ROOM;
	if (!ns) return null;
	const id = ns.idFromName(CHAT_ROOM_NAME);
	return ns.get(id);
}

export const GET: RequestHandler = async ({ request, platform }) => {
	const authed = await requireAdminAuth(request, platform?.env.ADMIN_JWT_SECRET);
	if (!authed) return json({ success: false, error: '未授权' }, { status: 401 });

	const room = getChatRoom(platform);
	if (!room) return json({ success: false, error: '聊天服务不可用' }, { status: 500 });

	const url = new URL(request.url);
	const limit = url.searchParams.get('limit') || '100';
	const before = url.searchParams.get('before') || '';

	const doUrl = new URL('http://do/admin/messages');
	doUrl.searchParams.set('limit', limit);
	if (before) doUrl.searchParams.set('before', before);

	const res = await room.fetch(doUrl.toString());
	const data = await res.json();
	return json({ success: true, data });
};

export const DELETE: RequestHandler = async ({ request, platform }) => {
	const authed = await requireAdminAuth(request, platform?.env.ADMIN_JWT_SECRET);
	if (!authed) return json({ success: false, error: '未授权' }, { status: 401 });

	const room = getChatRoom(platform);
	if (!room) return json({ success: false, error: '聊天服务不可用' }, { status: 500 });

	const body = await request.json();
	const res = await room.fetch('http://do/admin/messages', {
		method: 'DELETE',
		body: JSON.stringify(body),
		headers: { 'Content-Type': 'application/json' }
	});
	const data = await res.json();
	return json({ success: true, data });
};

export const POST: RequestHandler = async ({ request, platform }) => {
	const authed = await requireAdminAuth(request, platform?.env.ADMIN_JWT_SECRET);
	if (!authed) return json({ success: false, error: '未授权' }, { status: 401 });

	const room = getChatRoom(platform);
	if (!room) return json({ success: false, error: '聊天服务不可用' }, { status: 500 });

	const res = await room.fetch('http://do/admin/messages/clear', { method: 'POST' });
	const data = await res.json();
	return json({ success: true, data });
};
