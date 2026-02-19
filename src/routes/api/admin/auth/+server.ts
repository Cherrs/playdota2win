import { json, type RequestHandler } from '@sveltejs/kit';
import type { ApiResponse } from '$lib/types';
import { issueAdminJwt } from '$lib/admin-auth';
import {
	verifyTurnstile,
	FailureCounter,
	getClientIp,
	getTurnstileStatus,
	FAILURE_THRESHOLD
} from '$lib/turnstile';

export const GET: RequestHandler = async ({ request, platform }) => {
	const kv = platform?.env.APP_KV;
	const siteKey = platform?.env.TURNSTILE_SITE_KEY || '';
	const ip = getClientIp(request);

	const counter = new FailureCounter(kv, 'auth_failures');
	const status = await getTurnstileStatus(counter, ip, siteKey);

	return json({
		success: true,
		data: {
			requireTurnstile: status.required,
			siteKey: status.siteKey,
			failureCount: status.failureCount
		}
	} satisfies ApiResponse<{ requireTurnstile: boolean; siteKey: string; failureCount: number }>);
};

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const { password, turnstileToken } = (await request.json()) as {
			password: string;
			turnstileToken?: string;
		};

		const kv = platform?.env.APP_KV;
		const secretKey = platform?.env.TURNSTILE_SECRET_KEY || '';
		const siteKey = platform?.env.TURNSTILE_SITE_KEY || '';
		const ip = getClientIp(request);

		const counter = new FailureCounter(kv, 'auth_failures');
		const failureCount = await counter.getCount(ip);

		if (failureCount >= FAILURE_THRESHOLD) {
			if (!turnstileToken) {
				return json(
					{
						success: false,
						error: '请完成人机验证',
						data: { requireTurnstile: true, siteKey }
					} satisfies ApiResponse<{ requireTurnstile: boolean; siteKey: string }>,
					{ status: 400 }
				);
			}

			const isValidTurnstile = await verifyTurnstile(turnstileToken, secretKey, ip);
			if (!isValidTurnstile) {
				return json(
					{
						success: false,
						error: '人机验证失败，请重试',
						data: { requireTurnstile: true, siteKey }
					} satisfies ApiResponse<{ requireTurnstile: boolean; siteKey: string }>,
					{ status: 400 }
				);
			}
		}

		const adminPassword = platform?.env.ADMIN_PASSWORD;
		if (!adminPassword) {
			return json(
				{ success: false, error: 'Admin password not configured' } satisfies ApiResponse,
				{
					status: 500
				}
			);
		}

		if (password !== adminPassword) {
			const newFailureCount = await counter.increment(ip);
			const requireTurnstile = newFailureCount >= FAILURE_THRESHOLD;

			return json(
				{
					success: false,
					error: requireTurnstile
						? `密码错误，请完成人机验证后重试`
						: `密码错误，还有 ${FAILURE_THRESHOLD - newFailureCount} 次机会`,
					data: {
						requireTurnstile,
						siteKey: requireTurnstile ? siteKey : '',
						failureCount: newFailureCount
					}
				} satisfies ApiResponse<{
					requireTurnstile: boolean;
					siteKey: string;
					failureCount: number;
				}>,
				{ status: 401 }
			);
		}

		const jwtSecret = platform?.env.ADMIN_JWT_SECRET;
		if (!jwtSecret) {
			return json({ success: false, error: 'JWT secret not configured' } satisfies ApiResponse, {
				status: 500
			});
		}

		await counter.clear(ip);

		const token = await issueAdminJwt(jwtSecret);

		return json({ success: true, data: { token } } satisfies ApiResponse<{ token: string }>);
	} catch (error) {
		console.error('Auth error:', error);
		return json({ success: false, error: '认证失败' } satisfies ApiResponse, { status: 500 });
	}
};
