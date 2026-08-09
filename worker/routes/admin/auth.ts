import { json, type RequestHandler } from '../../http';
import type { ApiResponse } from '$lib/types';
import { readBoundedJson, RequestBodyError } from '$lib/server/request-body';
import {
	ADMIN_JWT_TTL_MS,
	ADMIN_SESSION_COOKIE,
	issueAdminJwt,
	requireAdminAuth,
	timingSafeEqualSecrets
} from '$lib/admin-auth';
import {
	verifyTurnstile,
	FailureCounter,
	FailureCounterUnavailableError,
	getClientIp,
	getTurnstileStatus,
	logTurnstileConfigurationError,
	FAILURE_THRESHOLD
} from '$lib/turnstile';

const TURNSTILE_RETRY_AFTER_SECONDS = 15 * 60;
const AUTH_RESET_DATA = { requireTurnstile: false, siteKey: '' } as const;
const MAX_AUTH_BODY_BYTES = 8 * 1024;
const MAX_PASSWORD_LENGTH = 256;
const MAX_TURNSTILE_TOKEN_LENGTH = 4096;

interface LoginInput {
	password: string;
	turnstileToken?: string;
}

function isLoginInput(value: unknown): value is LoginInput {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const input = value as Record<string, unknown>;
	return (
		Object.keys(input).every((key) => key === 'password' || key === 'turnstileToken') &&
		typeof input.password === 'string' &&
		input.password.length > 0 &&
		input.password.length <= MAX_PASSWORD_LENGTH &&
		(input.turnstileToken === undefined ||
			(typeof input.turnstileToken === 'string' &&
				input.turnstileToken.length > 0 &&
				input.turnstileToken.length <= MAX_TURNSTILE_TOKEN_LENGTH))
	);
}

function loginInputError(): Response {
	return json({ success: false, error: '请输入有效密码' } satisfies ApiResponse, {
		status: 400
	});
}

function turnstileUnavailable(siteKey: string, secretKey: string, failureCount: number): Response {
	logTurnstileConfigurationError('admin_auth', siteKey, secretKey, failureCount);
	return json(
		{
			success: false,
			error: '登录验证暂不可用，请稍后重试',
			data: { ...AUTH_RESET_DATA, failureCount }
		} satisfies ApiResponse<{
			requireTurnstile: false;
			siteKey: '';
			failureCount: number;
		}>,
		{
			status: 503,
			headers: { 'Retry-After': String(TURNSTILE_RETRY_AFTER_SECONDS) }
		}
	);
}

export const GET: RequestHandler = async ({ request, platform }) => {
	try {
		const jwtSecret = platform?.env?.ADMIN_JWT_SECRET;
		if (await requireAdminAuth(request, jwtSecret)) {
			return json({
				success: true,
				data: { authenticated: true, ...AUTH_RESET_DATA, failureCount: 0 }
			} satisfies ApiResponse<{
				authenticated: true;
				requireTurnstile: false;
				siteKey: '';
				failureCount: number;
			}>);
		}

		const kv = platform?.env?.APP_KV;
		const siteKey = platform?.env?.TURNSTILE_SITE_KEY || '';
		const secretKey = platform?.env?.TURNSTILE_SECRET_KEY || '';
		const ip = getClientIp(request);
		const counter = new FailureCounter(kv, 'auth_failures', platform?.env?.UPLOADS_BUCKET);
		const status = await getTurnstileStatus(counter, ip, siteKey, secretKey);
		if (status.unavailable) {
			return turnstileUnavailable(siteKey, secretKey, status.failureCount);
		}

		return json({
			success: true,
			data: {
				authenticated: false,
				requireTurnstile: status.required,
				siteKey: status.siteKey,
				failureCount: status.failureCount
			}
		} satisfies ApiResponse<{
			authenticated: false;
			requireTurnstile: boolean;
			siteKey: string;
			failureCount: number;
		}>);
	} catch (error) {
		console.error({
			component: 'admin_auth',
			event_name: 'admin_session_check_failed',
			error_message: error instanceof Error ? error.message : String(error)
		});
		return json({ success: false, error: '登录状态暂时无法检查' } satisfies ApiResponse, {
			status: 503
		});
	}
};

export const POST: RequestHandler = async ({ request, platform, url, cookies }) => {
	let authenticationCompleted = false;
	try {
		let parsedInput: unknown;
		try {
			parsedInput = await readBoundedJson(request, MAX_AUTH_BODY_BYTES);
		} catch (error) {
			return error instanceof RequestBodyError
				? json({ success: false, error: error.message } satisfies ApiResponse, {
						status: error.status
					})
				: loginInputError();
		}
		if (!isLoginInput(parsedInput)) return loginInputError();
		const { password, turnstileToken } = parsedInput;

		const kv = platform?.env?.APP_KV;
		const secretKey = platform?.env?.TURNSTILE_SECRET_KEY || '';
		const siteKey = platform?.env?.TURNSTILE_SITE_KEY || '';
		const ip = getClientIp(request);

		const counter = new FailureCounter(kv, 'auth_failures', platform?.env?.UPLOADS_BUCKET);
		const failureCount = await counter.getCount(ip);
		const turnstileConfigured = Boolean(siteKey && secretKey);

		if (failureCount >= FAILURE_THRESHOLD && !turnstileConfigured) {
			return turnstileUnavailable(siteKey, secretKey, failureCount);
		}

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

			const isValidTurnstile = await verifyTurnstile(
				turnstileToken,
				secretKey,
				ip,
				'admin-auth',
				url.hostname
			);
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

		const adminPassword = platform?.env?.ADMIN_PASSWORD;
		if (!adminPassword) {
			return json(
				{ success: false, error: 'Admin password not configured' } satisfies ApiResponse,
				{
					status: 500
				}
			);
		}

		if (!(await timingSafeEqualSecrets(password, adminPassword))) {
			const newFailureCount = await counter.increment(ip, failureCount);
			const requireTurnstile = newFailureCount >= FAILURE_THRESHOLD;
			if (requireTurnstile && !turnstileConfigured) {
				return turnstileUnavailable(siteKey, secretKey, newFailureCount);
			}

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

		const jwtSecret = platform?.env?.ADMIN_JWT_SECRET;
		if (!jwtSecret) {
			return json(
				{
					success: false,
					error: 'JWT secret not configured',
					data: AUTH_RESET_DATA
				} satisfies ApiResponse,
				{ status: 500 }
			);
		}

		const token = await issueAdminJwt(jwtSecret);
		await counter.clear(ip);
		cookies.set(ADMIN_SESSION_COOKIE, token, {
			httpOnly: true,
			secure: url.protocol === 'https:',
			sameSite: 'strict',
			path: '/',
			maxAge: Math.floor(ADMIN_JWT_TTL_MS / 1000)
		});
		authenticationCompleted = true;

		return json({
			success: true,
			data: { authenticated: true, ...AUTH_RESET_DATA }
		} satisfies ApiResponse<{
			authenticated: true;
			requireTurnstile: false;
			siteKey: '';
		}>);
	} catch (error) {
		console.error('Auth error:', error);
		const counterUnavailable = error instanceof FailureCounterUnavailableError;
		return json(
			{
				success: false,
				error: counterUnavailable ? '登录验证暂不可用，请稍后重试' : '认证失败',
				...(authenticationCompleted ? { data: AUTH_RESET_DATA } : {})
			} satisfies ApiResponse,
			{
				status: counterUnavailable ? 503 : 500,
				...(counterUnavailable
					? { headers: { 'Retry-After': String(TURNSTILE_RETRY_AFTER_SECONDS) } }
					: {})
			}
		);
	}
};

export const DELETE: RequestHandler = async ({ cookies, url }) => {
	cookies.delete(ADMIN_SESSION_COOKIE, {
		path: '/',
		httpOnly: true,
		secure: url.protocol === 'https:',
		sameSite: 'strict'
	});
	return json({ success: true, data: { authenticated: false } } satisfies ApiResponse<{
		authenticated: false;
	}>);
};
