import type { RequestHandler } from '@sveltejs/kit';
import { verifySignedUrl } from '$lib/admin-auth';

// 提供 R2 存储的文件下载
export const GET: RequestHandler = async ({ params, platform, request }) => {
	try {
		const r2 = platform?.env.UPLOADS_BUCKET;
		if (!r2) {
			return new Response('R2 not available', { status: 500 });
		}

		const signingSecret =
			platform?.env.ADMIN_SIGNING_SECRET || platform?.env.ADMIN_PASSWORD || 'dev-secret';
		const url = new URL(request.url);
		const authed = await verifySignedUrl(url, signingSecret);
		if (!authed) {
			return new Response('Unauthorized', { status: 401 });
		}

		const key = params.path;
		if (!key) {
			return new Response('Path is required', { status: 400 });
		}

		if (key.includes('..') || key.startsWith('/') || key.includes('\\')) {
			return new Response('Invalid key', { status: 400 });
		}

		const object = await r2.get(key);
		if (!object) {
			return new Response('File not found', { status: 404 });
		}

		const headers = new Headers();
		object.writeHttpMetadata(headers);
		headers.set('etag', object.httpEtag);

		// 设置下载文件名
		const filename = key.split('/').pop() || 'download';
		headers.set('Content-Disposition', `attachment; filename="${filename}"`);

		return new Response(object.body, { headers });
	} catch (error) {
		console.error('Error serving file:', error);
		return new Response('Failed to serve file', { status: 500 });
	}
};
