import { json, type RequestHandler } from '@sveltejs/kit';
import type { ApiResponse, NicknameKeywordList } from '$lib/types';

const KV_KEY = 'chat_nickname_keywords';

export const GET: RequestHandler = async ({ platform }) => {
	const kv = platform?.env.APP_KV;
	if (!kv) {
		return json({
			success: true,
			data: { keywords: [], lastUpdated: Date.now() }
		} satisfies ApiResponse<NicknameKeywordList>);
	}

	const stored = await kv.get<NicknameKeywordList>(KV_KEY, 'json');
	return json({
		success: true,
		data: stored ?? { keywords: [], lastUpdated: Date.now() }
	} satisfies ApiResponse<NicknameKeywordList>);
};
