import type { RequestHandler } from '@sveltejs/kit';
import { verifyDownloadToken } from '$lib/auth';
import { buildContentDisposition } from '$lib/utils/filename';

// GET: R2 中转下载
export const GET: RequestHandler = async ({ params, platform, request }) => {
	try {
		const r2 = platform?.env.UPLOADS_BUCKET;
		const kv = platform?.env.APP_KV;
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

		const authed = await verifyDownloadToken(token, kv, key, platform?.env);
		if (!authed) {
			return new Response('Unauthorized', { status: 401 });
		}

		const object = await r2.get(key);
		if (!object) {
			return new Response('File not found', { status: 404 });
		}

		const headers = new Headers();
		object.writeHttpMetadata(headers);
		headers.set('etag', object.httpEtag);

		const filename = key.split('/').pop() || 'download';
		headers.set('Content-Disposition', buildContentDisposition(filename));

		return new Response(object.body, { headers });
	} catch (error) {
		console.error('Error serving relay download:', error);
		return new Response('Failed to serve file', { status: 500 });
	}
};
