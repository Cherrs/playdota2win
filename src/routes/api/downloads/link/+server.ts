import { json, type RequestHandler } from '@sveltejs/kit';
import type { ApiResponse } from '$lib/types';
import { verifyDownloadPassword, generateDownloadToken } from '$lib/auth';
import {
	createR2DownloadBackupStore,
	getDownloadBackupState,
	getReadyDownloadBackupObjectKey
} from '$lib/server/download-backup';
import { getManagedUploadKey } from '$lib/server/download-object';
import { incrementDownloadCount } from '$lib/server/download-count-store';
import { readDownloadList } from '$lib/server/download-list-store';
import { readBoundedJson, RequestBodyError } from '$lib/server/request-body';
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
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const MAX_ITEM_ID_LENGTH = 128;
const MAX_PASSWORD_LENGTH = 256;
const MAX_TURNSTILE_TOKEN_LENGTH = 4096;

function turnstileUnavailable(siteKey: string, secretKey: string, failureCount: number): Response {
	logTurnstileConfigurationError('download_auth', siteKey, secretKey, failureCount);
	return json(
		{
			success: false,
			error: '下载验证暂不可用，请稍后重试',
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

function getFilenameFromUrl(url: string): string {
	try {
		const parsed = new URL(url, 'http://local');
		const name = parsed.pathname.split('/').pop();
		return name || 'download';
	} catch {
		return 'download';
	}
}

export const GET: RequestHandler = async ({ request, platform }) => {
	try {
		const kv = platform?.env?.APP_KV;
		const siteKey = platform?.env?.TURNSTILE_SITE_KEY || '';
		const secretKey = platform?.env?.TURNSTILE_SECRET_KEY || '';
		const ip = getClientIp(request);

		const counter = new FailureCounter(kv, 'download_failures', platform?.env?.UPLOADS_BUCKET);
		const status = await getTurnstileStatus(counter, ip, siteKey, secretKey);
		if (status.unavailable) {
			return turnstileUnavailable(siteKey, secretKey, status.failureCount);
		}

		return json({
			success: true,
			data: {
				requireTurnstile: status.required,
				siteKey: status.siteKey,
				failureCount: status.failureCount
			}
		} satisfies ApiResponse<{ requireTurnstile: boolean; siteKey: string; failureCount: number }>);
	} catch (error) {
		console.error('Download verification status error:', error);
		return json({ success: false, error: '下载验证暂不可用，请稍后重试' } satisfies ApiResponse, {
			status: 503,
			headers: { 'Retry-After': String(TURNSTILE_RETRY_AFTER_SECONDS) }
		});
	}
};

export const POST: RequestHandler = async ({ request, platform, url: requestUrl }) => {
	let authenticationCompleted = false;
	try {
		let rawBody: unknown;
		try {
			rawBody = await readBoundedJson(request, MAX_REQUEST_BODY_BYTES);
		} catch (error) {
			return json(
				{
					success: false,
					error: error instanceof RequestBodyError ? error.message : '无效的 JSON 请求'
				} satisfies ApiResponse,
				{ status: error instanceof RequestBodyError ? error.status : 400 }
			);
		}
		if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
			return json({ success: false, error: '无效的请求内容' } satisfies ApiResponse, {
				status: 400
			});
		}

		const body = rawBody as Record<string, unknown>;
		if (
			Object.keys(body).some(
				(key) => !['itemId', 'password', 'turnstileToken', 'action', 'downloadSource'].includes(key)
			)
		) {
			return json({ success: false, error: '无效的请求字段' } satisfies ApiResponse, {
				status: 400
			});
		}
		const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
		const password = typeof body.password === 'string' ? body.password : '';
		const turnstileToken =
			typeof body.turnstileToken === 'string' && body.turnstileToken
				? body.turnstileToken
				: undefined;
		const action = body.action === undefined ? 'download' : body.action;
		const downloadSource = body.downloadSource === undefined ? 'auto' : body.downloadSource;

		if (!itemId || itemId.length > MAX_ITEM_ID_LENGTH) {
			return json({ success: false, error: '无效的下载项' } satisfies ApiResponse, { status: 400 });
		}
		if (action !== 'download' && action !== 'guide') {
			return json({ success: false, error: '无效的验证操作' } satisfies ApiResponse, {
				status: 400
			});
		}
		if (downloadSource !== 'auto' && downloadSource !== 'r2') {
			return json({ success: false, error: '无效的下载来源' } satisfies ApiResponse, {
				status: 400
			});
		}
		if (!password || password.length > MAX_PASSWORD_LENGTH) {
			return json({ success: false, error: '请输入密码' } satisfies ApiResponse, { status: 400 });
		}
		if (turnstileToken && turnstileToken.length > MAX_TURNSTILE_TOKEN_LENGTH) {
			return json({ success: false, error: '无效的人机验证令牌' } satisfies ApiResponse, {
				status: 400
			});
		}

		const kv = platform?.env?.APP_KV;
		const r2 = platform?.env?.UPLOADS_BUCKET;
		const secretKey = platform?.env?.TURNSTILE_SECRET_KEY || '';
		const siteKey = platform?.env?.TURNSTILE_SITE_KEY || '';
		const ip = getClientIp(request);

		const counter = new FailureCounter(kv, 'download_failures', r2);
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
				'download-auth',
				requestUrl.hostname
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

		const isValid = await verifyDownloadPassword(password, platform?.env);
		if (!isValid) {
			const newFailureCount = await counter.increment(ip, failureCount);
			const requireTurnstile = newFailureCount >= FAILURE_THRESHOLD;
			if (requireTurnstile && !turnstileConfigured) {
				return turnstileUnavailable(siteKey, secretKey, newFailureCount);
			}

			return json(
				{
					success: false,
					error: requireTurnstile
						? '密码错误，请完成人机验证后重试'
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

		if (!kv && !r2) {
			return json({ success: false, error: 'Storage not available' } satisfies ApiResponse, {
				status: 500
			});
		}

		await counter.clear(ip);
		authenticationCompleted = true;

		const { list } = await readDownloadList(kv, r2);
		const item = list.items.find((i) => i.id === itemId && i.enabled);
		if (!item) {
			return json(
				{ success: false, error: '下载项不存在', data: AUTH_RESET_DATA } satisfies ApiResponse,
				{ status: 404 }
			);
		}

		const configGuide = item.configGuide || '';
		if (action === 'guide') {
			return json({
				success: true,
				data: { verified: true, configGuide, ...AUTH_RESET_DATA }
			} satisfies ApiResponse<{
				verified: boolean;
				configGuide: string;
				requireTurnstile: false;
				siteKey: '';
			}>);
		}

		let url = item.url;
		let filename = item.filename || getFilenameFromUrl(item.url);
		let resolvedSource: 'origin' | 'r2' = 'origin';
		const requestedSource = downloadSource;

		if (item.storageType === 'link') {
			// Source probing used to add up to six seconds to every password-success path.
			// "auto" now returns the origin immediately; users can explicitly request R2.
			if (requestedSource === 'r2') {
				const backupStore = r2 ? createR2DownloadBackupStore(r2) : undefined;
				const backupState = backupStore
					? await getDownloadBackupState(backupStore, item.id)
					: undefined;
				const backupKey = getReadyDownloadBackupObjectKey(item, backupState);
				let backupExists = false;
				if (r2 && backupKey) {
					try {
						backupExists = (await r2.head(backupKey)) !== null;
					} catch (error) {
						console.error({
							component: 'download_delivery',
							event_name: 'download_backup_inspection_failed',
							message: 'Failed to inspect download R2 backup',
							item_id: item.id,
							requested_source: requestedSource,
							error_message: error instanceof Error ? error.message : String(error)
						});
					}
				}

				if (!r2 || !backupKey || !backupExists) {
					return json(
						{
							success: false,
							error: 'R2 备用下载尚未就绪',
							data: AUTH_RESET_DATA
						} satisfies ApiResponse,
						{ status: 503 }
					);
				}

				const signingSecret = platform?.env?.ADMIN_SIGNING_SECRET;
				if (!signingSecret) {
					return json(
						{
							success: false,
							error: '下载签名服务未配置',
							data: AUTH_RESET_DATA
						} satisfies ApiResponse,
						{ status: 500 }
					);
				}
				const token = await generateDownloadToken(backupKey, signingSecret);
				const search = new URLSearchParams({ token, filename });
				url = `/api/downloads/relay/${backupKey}?${search.toString()}`;
				resolvedSource = 'r2';
			}
		} else if (item.storageType === 'r2') {
			const key = getManagedUploadKey(item.url, item.platform);
			if (!key) {
				return json(
					{
						success: false,
						error: '下载对象配置无效',
						data: AUTH_RESET_DATA
					} satisfies ApiResponse,
					{ status: 500 }
				);
			}
			const signingSecret = platform?.env?.ADMIN_SIGNING_SECRET;
			if (!signingSecret) {
				return json(
					{
						success: false,
						error: '下载签名服务未配置',
						data: AUTH_RESET_DATA
					} satisfies ApiResponse,
					{ status: 500 }
				);
			}
			const token = await generateDownloadToken(key, signingSecret);
			url = `/api/downloads/relay/${key}?token=${token}`;
			filename = item.filename || key.split('/').pop() || 'download';
			resolvedSource = 'r2';
		} else if (requestedSource === 'r2') {
			return json(
				{
					success: false,
					error: '该下载项没有 R2 备份',
					data: AUTH_RESET_DATA
				} satisfies ApiResponse,
				{ status: 400 }
			);
		}

		if (kv) {
			const countUpdate = incrementDownloadCount(kv, item).catch((error) => {
				console.error({
					component: 'download_counts',
					event_name: 'download_count_increment_failed',
					message: 'Failed to increment independent download counter',
					item_id: item.id,
					error_message: error instanceof Error ? error.message : String(error)
				});
			});

			if (platform?.ctx) {
				platform.ctx.waitUntil(countUpdate);
			} else {
				await countUpdate;
			}
		}

		return json({
			success: true,
			data: {
				url,
				filename,
				configGuide,
				resolvedSource,
				...AUTH_RESET_DATA
			}
		} satisfies ApiResponse<{
			url: string;
			filename: string;
			configGuide: string;
			resolvedSource: 'origin' | 'r2';
			requireTurnstile: false;
			siteKey: '';
		}>);
	} catch (error) {
		console.error('Error getting download link:', error);
		const counterUnavailable = error instanceof FailureCounterUnavailableError;
		return json(
			{
				success: false,
				error: counterUnavailable ? '下载验证暂不可用，请稍后重试' : 'Failed to get download link',
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
