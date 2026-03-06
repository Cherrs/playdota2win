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

	const res = await room.fetch('http://do/admin/online');
	if (!res.ok) return json({ success: false, error: '获取在线用户失败' }, { status: 502 });

	const data = await res.json();
	return json({ success: true, data });
};
