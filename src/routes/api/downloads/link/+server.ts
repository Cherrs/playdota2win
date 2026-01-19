import { json, type RequestHandler } from '@sveltejs/kit';
import type { ApiResponse, DownloadList } from '$lib/types';
import { verifyDownloadPassword, generateDownloadToken, saveDownloadToken } from '$lib/auth';

const KV_KEY = 'downloads_list';
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

	const result = (await response.json()) as { success: boolean };
	return result.success;
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

// GET: 检查是否需要 Turnstile
export const GET: RequestHandler = async ({ request, platform }) => {
	const kv = platform?.env.APP_KV;
	const siteKey = platform?.env.TURNSTILE_SITE_KEY || '';
	const ip =
		request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
	const kvKey = `download_failures:${ip}`;

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

// POST: 验证密码并返回下载链接
export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const { itemId, password, turnstileToken } = (await request.json()) as {
			itemId?: string;
			password?: string;
			turnstileToken?: string;
		};
		if (!itemId) {
			return json({ success: false, error: 'itemId is required' } satisfies ApiResponse, {
				status: 400
			});
		}
		if (!password) {
			return json({ success: false, error: '请输入密码' } satisfies ApiResponse, { status: 400 });
		}

		const kv = platform?.env.APP_KV;
		const ip =
			request.headers.get('CF-Connecting-IP') ||
			request.headers.get('X-Forwarded-For') ||
			'unknown';
		const kvKey = `download_failures:${ip}`;
		const secretKey = platform?.env.TURNSTILE_SECRET_KEY || '';
		const siteKey = platform?.env.TURNSTILE_SITE_KEY || '';

		let failureCount = 0;
		if (kv) {
			const stored = await kv.get(kvKey);
			failureCount = stored ? parseInt(stored, 10) : 0;
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

		const isValid = verifyDownloadPassword(password, platform?.env);
		if (!isValid) {
			if (kv) {
				const newCount = failureCount + 1;
				await kv.put(kvKey, newCount.toString(), { expirationTtl: FAILURE_TTL });
			}

			const newFailureCount = failureCount + 1;
			const requireTurnstile = newFailureCount >= FAILURE_THRESHOLD;

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

		if (!kv) {
			return json({ success: false, error: 'KV not available' } satisfies ApiResponse, {
				status: 500
			});
		}

		await kv.delete(kvKey);

		const data = await kv.get<DownloadList>(KV_KEY, 'json');
		const list = data || { items: [], downloadCount: 12580, lastUpdated: Date.now() };
		const item = list.items.find((i) => i.id === itemId && i.enabled);
		if (!item) {
			return json({ success: false, error: '下载项不存在' } satisfies ApiResponse, { status: 404 });
		}

		let url = item.url;
		let filename = item.filename || getFilenameFromUrl(item.url);
		if (item.storageType === 'r2' && item.url.startsWith('/api/admin/download/')) {
			const key = item.url.replace('/api/admin/download/', '');
			const token = generateDownloadToken();
			await saveDownloadToken(token, kv, key);
			url = `/api/downloads/relay/${key}?token=${token}`;
			filename = item.filename || key.split('/').pop() || 'download';
		}

		// 记录下载次数
		list.downloadCount = (list.downloadCount || 0) + 1;
		await kv.put(KV_KEY, JSON.stringify(list));

		return json({
			success: true,
			data: { url, filename, count: list.downloadCount }
		} satisfies ApiResponse<{ url: string; filename: string; count: number }>);
	} catch (error) {
		console.error('Error getting download link:', error);
		return json({ success: false, error: 'Failed to get download link' } satisfies ApiResponse, {
			status: 500
		});
	}
};
