import { json, type RequestHandler } from '@sveltejs/kit';
import type { ApiResponse, DownloadList } from '$lib/types';
import { verifyDownloadPassword, generateDownloadToken, saveDownloadToken } from '$lib/auth';

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

// POST: 验证密码并返回下载链接
export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const { itemId, password } = await request.json() as { itemId?: string; password?: string };
		if (!itemId) {
			return json({ success: false, error: 'itemId is required' } satisfies ApiResponse, { status: 400 });
		}
		if (!password) {
			return json({ success: false, error: '请输入密码' } satisfies ApiResponse, { status: 400 });
		}

		const isValid = verifyDownloadPassword(password, platform?.env);
		if (!isValid) {
			return json({ success: false, error: '密码错误' } satisfies ApiResponse, { status: 401 });
		}

		const kv = platform?.env.APP_KV;
		if (!kv) {
			return json({ success: false, error: 'KV not available' } satisfies ApiResponse, { status: 500 });
		}

		const data = await kv.get<DownloadList>(KV_KEY, 'json');
		const list = data || { items: [], downloadCount: 12580, lastUpdated: Date.now() };
		const item = list.items.find(i => i.id === itemId && i.enabled);
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

		return json({ success: true, data: { url, filename, count: list.downloadCount } } satisfies ApiResponse<{ url: string; filename: string; count: number }>);
	} catch (error) {
		console.error('Error getting download link:', error);
		return json({ success: false, error: 'Failed to get download link' } satisfies ApiResponse, { status: 500 });
	}
};
