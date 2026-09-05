import assert from 'node:assert/strict';
import test from 'node:test';

import { json, ResponseCookies } from '../../worker/http.ts';
import { addSecurityHeaders } from '../../worker/security.ts';

test('response cookies preserve the secure admin session contract', () => {
	const cookies = new ResponseCookies();
	cookies.set('admin_session', 'signed.token', {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'strict',
		maxAge: 3600
	});

	const response = cookies.apply(json({ success: true }));
	const setCookie = response.headers.get('Set-Cookie') ?? '';
	assert.match(setCookie, /^admin_session=signed.token;/u);
	assert.match(setCookie, /Path=\//u);
	assert.match(setCookie, /Max-Age=3600/u);
	assert.match(setCookie, /HttpOnly/u);
	assert.match(setCookie, /Secure/u);
	assert.match(setCookie, /SameSite=Strict/u);
});

test('response cookies preserve logout expiry and existing response headers', () => {
	const cookies = new ResponseCookies();
	cookies.delete('admin_session', {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'strict'
	});

	const response = cookies.apply(new Response(null, { headers: { ETag: 'session-state' } }));
	const setCookie = response.headers.get('Set-Cookie') ?? '';
	assert.equal(response.headers.get('ETag'), 'session-state');
	assert.match(setCookie, /^admin_session=;/u);
	assert.match(setCookie, /Max-Age=0/u);
	assert.match(setCookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/u);
	assert.match(setCookie, /HttpOnly/u);
});

test('security headers retain CSP and admin no-store behavior', () => {
	const url = new URL('https://example.com/admin');
	const response = addSecurityHeaders(new Response('ok'), url);

	assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
	assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
	assert.equal(response.headers.get('Cache-Control'), 'no-store');
	assert.match(response.headers.get('Content-Security-Policy') ?? '', /frame-ancestors 'none'/u);
	assert.match(
		response.headers.get('Content-Security-Policy') ?? '',
		/https:\/\/challenges\.cloudflare\.com/u
	);
	assert.doesNotMatch(
		response.headers.get('Content-Security-Policy') ?? '',
		/script-src[^;]*'unsafe-inline'/u
	);
});
