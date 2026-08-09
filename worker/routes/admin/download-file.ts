import type { RequestHandler } from '../../http';
import { verifySignedUrl } from '$lib/admin-auth';
import { createR2DownloadResponse } from '$lib/server/r2-download';
import { isManagedUploadKey } from '$lib/server/download-object';

// 提供 R2 存储的文件下载
export const GET: RequestHandler = async ({ params, platform, request }) => {
	try {
		const r2 = platform?.env?.UPLOADS_BUCKET;
		if (!r2) {
			return new Response('R2 not available', { status: 500 });
		}

		const signingSecret = platform?.env?.ADMIN_SIGNING_SECRET;
		if (!signingSecret) {
			return new Response('Signing secret not configured', { status: 500 });
		}
		const url = new URL(request.url);
		const authed = await verifySignedUrl(url, signingSecret);
		if (!authed) {
			return new Response('Unauthorized', { status: 401 });
		}

		const key = params.path;
		if (!key) {
			return new Response('Path is required', { status: 400 });
		}

		if (!isManagedUploadKey(key)) {
			return new Response('Invalid key', { status: 400 });
		}

		const response = await createR2DownloadResponse(r2, key, request, {
			fallbackFilename: key.split('/').pop() || 'download',
			headers: {
				'Cache-Control': 'private, no-store',
				'X-Content-Type-Options': 'nosniff',
				'Referrer-Policy': 'no-referrer'
			}
		});
		return response || new Response('File not found', { status: 404 });
	} catch (error) {
		console.error('Error serving file:', error);
		return new Response('Failed to serve file', { status: 500 });
	}
};
