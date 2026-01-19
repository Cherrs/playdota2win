import { json, type RequestHandler } from '@sveltejs/kit';
import type { ApiResponse } from '$lib/types';
import {
	verifyDownloadPassword,
	verifyDownloadToken,
	generateDownloadToken,
	saveDownloadToken
} from '$lib/auth';

// GET: 检查 token 是否有效
export const GET: RequestHandler = async ({ request, platform }) => {
	const kv = platform?.env.APP_KV;
	const token = request.headers.get('X-Download-Token');
	
	const isValid = await verifyDownloadToken(token, kv);
	
	return json({
		success: true,
		data: { authenticated: isValid }
	} satisfies ApiResponse<{ authenticated: boolean }>);
};

// POST: 密码验证
export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const { password } = await request.json() as { password: string };
		
		if (!password) {
			return json(
				{ success: false, error: '请输入密码' } satisfies ApiResponse,
				{ status: 400 }
			);
		}
		
		const isValid = verifyDownloadPassword(password, platform?.env);
		
		if (!isValid) {
			return json(
				{ success: false, error: '密码错误' } satisfies ApiResponse,
				{ status: 401 }
			);
		}
		
		// 生成并保存 token
		const token = generateDownloadToken();
		await saveDownloadToken(token, platform?.env.APP_KV);
		
		return json({
			success: true,
			data: { token }
		} satisfies ApiResponse<{ token: string }>);
	} catch (error) {
		console.error('Error verifying download password:', error);
		return json(
			{ success: false, error: '验证失败' } satisfies ApiResponse,
			{ status: 500 }
		);
	}
};
