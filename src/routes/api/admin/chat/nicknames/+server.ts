import { json, type RequestHandler } from '@sveltejs/kit';
import { requireAdminAuth } from '$lib/admin-auth';
import type { ApiResponse, NicknameKeywordList } from '$lib/types';

const KV_KEY = 'chat_nickname_keywords';

export const GET: RequestHandler = async ({ request, platform }) => {
	const authed = await requireAdminAuth(request, platform?.env.ADMIN_JWT_SECRET);
	if (!authed)
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });

	const kv = platform?.env.APP_KV;
	if (!kv)
		return json({
			success: true,
			data: { keywords: [], lastUpdated: Date.now() }
		} satisfies ApiResponse<NicknameKeywordList>);

	const stored = await kv.get<NicknameKeywordList>(KV_KEY, 'json');
	return json({
		success: true,
		data: stored ?? { keywords: [], lastUpdated: Date.now() }
	} satisfies ApiResponse<NicknameKeywordList>);
};

export const PUT: RequestHandler = async ({ request, platform }) => {
	const authed = await requireAdminAuth(request, platform?.env.ADMIN_JWT_SECRET);
	if (!authed)
		return json({ success: false, error: '未授权' } satisfies ApiResponse, { status: 401 });

	const kv = platform?.env.APP_KV;
	if (!kv)
		return json({ success: false, error: 'KV 不可用' } satisfies ApiResponse, { status: 500 });

	const body = (await request.json()) as { keywords?: string[] };
	if (!Array.isArray(body.keywords)) {
		return json({ success: false, error: 'keywords 必须是字符串数组' } satisfies ApiResponse, {
			status: 400
		});
	}

	const keywords = body.keywords
		.map((k: string) => (typeof k === 'string' ? k.trim() : ''))
		.filter((k: string) => k.length > 0);

	const data: NicknameKeywordList = { keywords, lastUpdated: Date.now() };
	await kv.put(KV_KEY, JSON.stringify(data));
	return json({ success: true, data } satisfies ApiResponse<NicknameKeywordList>);
};
