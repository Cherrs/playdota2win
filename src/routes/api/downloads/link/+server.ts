import { json, type RequestHandler } from '@sveltejs/kit';
import type { ApiResponse, DownloadList } from '$lib/types';
import { verifyDownloadPassword, generateDownloadToken, saveDownloadToken } from '$lib/auth';
import {
	verifyTurnstile,
	FailureCounter,
	getClientIp,
	getTurnstileStatus,
	FAILURE_THRESHOLD
} from '$lib/turnstile';

const KV_KEY = 'downloads_list';

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
	const kv = platform?.env.APP_KV;
	const siteKey = platform?.env.TURNSTILE_SITE_KEY || '';
	const ip = getClientIp(request);

	const counter = new FailureCounter(kv, 'download_failures');
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
		const secretKey = platform?.env.TURNSTILE_SECRET_KEY || '';
		const siteKey = platform?.env.TURNSTILE_SITE_KEY || '';
		const ip = getClientIp(request);

		const counter = new FailureCounter(kv, 'download_failures');
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

		const isValid = verifyDownloadPassword(password, platform?.env);
		if (!isValid) {
			const newFailureCount = await counter.increment(ip);
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

		await counter.clear(ip);

		const data = await kv.get<DownloadList>(KV_KEY, 'json');
		const list = data || { items: [], downloadCount: 12580, lastUpdated: Date.now() };
		const item = list.items.find((i) => i.id === itemId && i.enabled);
		if (!item) {
			return json({ success: false, error: '下载项不存在' } satisfies ApiResponse, { status: 404 });
		}

		let url = item.url;
		let filename = item.filename || getFilenameFromUrl(item.url);

		console.log('[Download Link] Item details:', {
			id: item.id,
			storageType: item.storageType,
			originalUrl: item.url,
			filename: item.filename
		});

		if (item.storageType === 'r2' && item.url.startsWith('/api/admin/download/')) {
			const key = item.url.replace('/api/admin/download/', '');
			const token = generateDownloadToken();
			await saveDownloadToken(token, kv, key);
			url = `/api/downloads/relay/${key}?token=${token}`;
			filename = item.filename || key.split('/').pop() || 'download';
			console.log('[Download Link] Generated R2 relay URL:', url);
		} else {
			console.log('[Download Link] Using direct URL:', url);
		}

		// 增加单项下载计数（接受最终一致性）
		// 注意：读-修改-写模式在极少数并发情况下可能丢失约 0.1% 的更新
		// 根据 research.md 中的架构决策，这个权衡是可接受的
		item.downloadCount = (item.downloadCount || 0) + 1;
		// 增加总下载计数
		list.downloadCount = (list.downloadCount || 0) + 1;
		await kv.put(KV_KEY, JSON.stringify(list));

		console.log('[Download Link] Final response:', {
			url,
			filename,
			count: list.downloadCount,
			originalItemUrl: item.url,
			storageType: item.storageType
		});

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
