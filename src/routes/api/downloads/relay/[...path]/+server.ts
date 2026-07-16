import type { RequestHandler } from '@sveltejs/kit';
import { verifyDownloadToken } from '$lib/auth';
import { createR2DownloadResponse } from '$lib/server/r2-download';

// GET: R2 中转下载
export const GET: RequestHandler = async ({ params, platform, request }) => {
	try {
		const r2 = platform?.env?.UPLOADS_BUCKET;
		if (!r2) {
			return new Response('R2 not available', { status: 500 });
		}

		const url = new URL(request.url);
		const token = url.searchParams.get('token');
		const key = params.path;
		if (!key) {
			return new Response('Path is required', { status: 400 });
		}

		if (key.includes('..') || key.startsWith('/') || key.includes('\\')) {
			return new Response('Invalid key', { status: 400 });
		}

		const authed = await verifyDownloadToken(token, key, platform?.env?.ADMIN_SIGNING_SECRET);
		if (!authed) {
			return new Response('Unauthorized', { status: 401 });
		}

		const requestedFilename = url.searchParams.get('filename');
		const response = await createR2DownloadResponse(r2, key, request, {
			filename: requestedFilename || undefined,
			fallbackFilename: key.split('/').pop() || 'download',
			headers: {
				'Cache-Control': 'private, no-store',
				'X-Content-Type-Options': 'nosniff',
				'Referrer-Policy': 'no-referrer'
			}
		});
		return response || new Response('File not found', { status: 404 });
	} catch (error) {
		console.error('Error serving relay download:', error);
		return new Response('Failed to serve file', { status: 500 });
	}
};
