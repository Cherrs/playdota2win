import { json } from './http.ts';
import { getMumbleProxyWsUrl } from '../src/lib/server/mumble/config.ts';
import type { RuntimeEnvironment } from '../src/lib/runtime.ts';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HASHED_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const HTML_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
const PUBLIC_HOME_PRELOAD_HASH = "'sha256-LkuUBDGRH2PJdzD0/6922PtpuJX2fkkVeZFHilA1X/Y='";

const scriptSources = [
	"'self'",
	PUBLIC_HOME_PRELOAD_HASH,
	...(import.meta.env?.DEV ? ["'unsafe-inline'"] : []),
	'https://challenges.cloudflare.com',
	'https://static.cloudflareinsights.com'
].join(' ');

const CONTENT_SECURITY_POLICY_DIRECTIVES = [
	"default-src 'self'",
	"base-uri 'self'",
	"object-src 'none'",
	"frame-ancestors 'none'",
	"form-action 'self'",
	`script-src ${scriptSources}`,
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
	"font-src 'self' data: https://fonts.gstatic.com",
	"img-src 'self' data: blob:",
	"media-src 'self' blob:",
	"worker-src 'self' blob:",
	'frame-src https://challenges.cloudflare.com'
];

function contentSecurityPolicy(url: URL, env?: RuntimeEnvironment): string {
	const sources = ["'self'", 'https:', 'https://challenges.cloudflare.com'];
	const wsUrl = getMumbleProxyWsUrl({ env }, url);
	if (wsUrl) {
		try {
			const endpoint = new URL(wsUrl);
			if (
				(endpoint.protocol === 'wss:' ||
					(url.protocol === 'http:' && endpoint.protocol === 'ws:')) &&
				!endpoint.username &&
				!endpoint.password
			)
				sources.push(endpoint.origin);
		} catch {
			// Invalid deployment URLs must not inject CSP directives or break page responses.
		}
	}
	return [...CONTENT_SECURITY_POLICY_DIRECTIVES, `connect-src ${sources.join(' ')}`].join('; ');
}

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

export function rejectCrossOriginAdminMutation(request: Request, url: URL): Response | null {
	return isCrossOriginAdminMutation(request, url)
		? json({ success: false, error: '拒绝跨站管理请求' }, { status: 403 })
		: null;
}

export function addSecurityHeaders(
	response: Response,
	url: URL,
	env?: RuntimeEnvironment
): Response {
	const headers = new Headers(response.headers);
	headers.set('Content-Security-Policy', contentSecurityPolicy(url, env));
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
	} else if (url.pathname.startsWith('/assets/')) {
		headers.set('Cache-Control', HASHED_ASSET_CACHE_CONTROL);
	} else if ((headers.get('Content-Type') ?? '').startsWith('text/html')) {
		headers.set('Cache-Control', HTML_CACHE_CONTROL);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}
