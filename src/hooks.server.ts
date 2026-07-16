import { json, type Handle } from '@sveltejs/kit';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isCrossOriginAdminMutation(request: Request, url: URL): boolean {
	if (!url.pathname.startsWith('/api/admin') || !UNSAFE_METHODS.has(request.method)) return false;
	if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return true;
	const origin = request.headers.get('Origin');
	if (!origin) return false;
	try {
		return new URL(origin).origin !== url.origin;
	} catch {
		return true;
	}
}

function addSecurityHeaders(response: Response, url: URL): Response {
	const headers = new Headers(response.headers);
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Referrer-Policy', 'no-referrer');
	headers.set('X-Frame-Options', 'DENY');
	headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
	headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
	if (url.protocol === 'https:') {
		headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
	if (url.pathname === '/admin' || url.pathname.startsWith('/api/admin')) {
		headers.set('Cache-Control', 'no-store');
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

export const handle: Handle = async ({ event, resolve }) => {
	if (isCrossOriginAdminMutation(event.request, event.url)) {
		return addSecurityHeaders(
			json({ success: false, error: '拒绝跨站管理请求' }, { status: 403 }),
			event.url
		);
	}

	return addSecurityHeaders(await resolve(event), event.url);
};
