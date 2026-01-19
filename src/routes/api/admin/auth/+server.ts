import { json, type RequestHandler } from '@sveltejs/kit';
import type { ApiResponse } from '$lib/types';
import { issueAdminJwt } from '$lib/admin-auth';

// 失败次数阈值，超过后需要 Turnstile 验证
const FAILURE_THRESHOLD = 3;
// 失败计数过期时间（秒）
const FAILURE_TTL = 60 * 15; // 15 分钟

// 验证 Turnstile token
async function verifyTurnstile(token: string, secretKey: string, ip: string): Promise<boolean> {
	const formData = new URLSearchParams();
	formData.append('secret', secretKey);
	formData.append('response', token);
	formData.append('remoteip', ip);

	const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: formData
	});

	const result = await response.json() as { success: boolean };
	return result.success;
}

// GET: 获取登录状态（是否需要 Turnstile）
export const GET: RequestHandler = async ({ request, platform }) => {
	const kv = platform?.env.APP_KV;
	const siteKey = platform?.env.TURNSTILE_SITE_KEY || '';
	
	// 获取客户端 IP
	const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
	const kvKey = `auth_failures:${ip}`;
	
	let failureCount = 0;
	if (kv) {
		const stored = await kv.get(kvKey);
		failureCount = stored ? parseInt(stored, 10) : 0;
	}
	
	const requireTurnstile = failureCount >= FAILURE_THRESHOLD;
	
	return json({
		success: true,
		data: {
			requireTurnstile,
			siteKey: requireTurnstile ? siteKey : '',
			failureCount
		}
	} satisfies ApiResponse<{ requireTurnstile: boolean; siteKey: string; failureCount: number }>);
};

// POST: 登录验证
export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const { password, turnstileToken } = await request.json() as { password: string; turnstileToken?: string };
		
		const kv = platform?.env.APP_KV;
		const secretKey = platform?.env.TURNSTILE_SECRET_KEY || '';
		
		// 获取客户端 IP
		const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
		const kvKey = `auth_failures:${ip}`;
		
		// 获取当前失败次数
		let failureCount = 0;
		if (kv) {
			const stored = await kv.get(kvKey);
			failureCount = stored ? parseInt(stored, 10) : 0;
		}
		
		// 如果失败次数超过阈值，需要验证 Turnstile
		if (failureCount >= FAILURE_THRESHOLD) {
			if (!turnstileToken) {
				return json({
					success: false,
					error: '请完成人机验证',
					data: { requireTurnstile: true, siteKey: platform?.env.TURNSTILE_SITE_KEY || '' }
				} satisfies ApiResponse<{ requireTurnstile: boolean; siteKey: string }>, { status: 400 });
			}
			
			const isValidTurnstile = await verifyTurnstile(turnstileToken, secretKey, ip);
			if (!isValidTurnstile) {
				return json({
					success: false,
					error: '人机验证失败，请重试',
					data: { requireTurnstile: true, siteKey: platform?.env.TURNSTILE_SITE_KEY || '' }
				} satisfies ApiResponse<{ requireTurnstile: boolean; siteKey: string }>, { status: 400 });
			}
		}
		
		// 从环境变量获取密码
		const adminPassword = platform?.env.ADMIN_PASSWORD || 'admin123';
		
		if (password !== adminPassword) {
			// 增加失败计数
			if (kv) {
				const newCount = failureCount + 1;
				await kv.put(kvKey, newCount.toString(), { expirationTtl: FAILURE_TTL });
			}
			
			const newFailureCount = failureCount + 1;
			const requireTurnstile = newFailureCount >= FAILURE_THRESHOLD;
			
			return json({
				success: false,
				error: requireTurnstile 
					? `密码错误，请完成人机验证后重试`
					: `密码错误，还有 ${FAILURE_THRESHOLD - newFailureCount} 次机会`,
				data: {
					requireTurnstile,
					siteKey: requireTurnstile ? (platform?.env.TURNSTILE_SITE_KEY || '') : '',
					failureCount: newFailureCount
				}
			} satisfies ApiResponse<{ requireTurnstile: boolean; siteKey: string; failureCount: number }>, { status: 401 });
		}
		
		const jwtSecret = platform?.env.ADMIN_JWT_SECRET;
		if (!jwtSecret) {
			return json({ success: false, error: 'JWT secret not configured' } satisfies ApiResponse, { status: 500 });
		}
		
		// 登录成功，清除失败计数
		if (kv) {
			await kv.delete(kvKey);
		}
		
		// 生成 JWT
		const token = await issueAdminJwt(jwtSecret);
		
		return json({ success: true, data: { token } } satisfies ApiResponse<{ token: string }>);
	} catch (error) {
		console.error('Auth error:', error);
		return json({ success: false, error: '认证失败' } satisfies ApiResponse, { status: 500 });
	}
};

