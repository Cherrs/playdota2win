import type { RequestHandler } from '@sveltejs/kit';

const CHAT_ROOM_NAME = 'global-chat-room';

function isAllowedOrigin(request: Request): boolean {
	const origin = request.headers.get('Origin');
	if (!origin) {
		return false;
	}

	try {
		const originUrl = new URL(origin);
		const requestUrl = new URL(request.url);
		return originUrl.host === requestUrl.host;
	} catch (error) {
		console.error('Failed to parse websocket origin:', error);
		return false;
	}
}

export const GET: RequestHandler = async ({ request, platform }) => {
	if (request.headers.get('Upgrade') !== 'websocket') {
		return new Response('Expected websocket', { status: 426 });
	}
	if (!isAllowedOrigin(request)) {
		return new Response('Forbidden', { status: 403 });
	}

	const chatRoomNamespace = platform?.env.CHAT_ROOM;
	if (!chatRoomNamespace) {
		return new Response('Chat service unavailable', { status: 500 });
	}

	const chatRoomId = chatRoomNamespace.idFromName(CHAT_ROOM_NAME);
	return chatRoomNamespace.get(chatRoomId).fetch(request);
};
