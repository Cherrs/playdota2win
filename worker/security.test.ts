import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { addSecurityHeaders, isCrossOriginAdminMutation } from './security.ts';

const target = new URL('https://playdota2.win/api/admin');

test('blocks cross-origin state-changing admin requests', () => {
	assert.equal(
		isCrossOriginAdminMutation(
			new Request(target, {
				method: 'POST',
				headers: { Origin: 'https://evil.example.com' }
			}),
			target
		),
		true
	);
	assert.equal(
		isCrossOriginAdminMutation(
			new Request(target, {
				method: 'DELETE',
				headers: { 'Sec-Fetch-Site': 'cross-site' }
			}),
			target
		),
		true
	);
});

test('allows same-origin mutations and safe reads', () => {
	assert.equal(
		isCrossOriginAdminMutation(
			new Request(target, { method: 'POST', headers: { Origin: target.origin } }),
			target
		),
		false
	);
	assert.equal(
		isCrossOriginAdminMutation(
			new Request(target, {
				method: 'GET',
				headers: { Origin: 'https://evil.example.com' }
			}),
			target
		),
		false
	);
});

test('uses immutable caching only for fingerprinted assets', () => {
	const asset = addSecurityHeaders(
		new Response('asset', { headers: { 'Content-Type': 'text/javascript' } }),
		new URL('https://playdota2.win/assets/index-a1b2c3.js')
	);
	const html = addSecurityHeaders(
		new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
		new URL('https://playdota2.win/download')
	);
	const admin = addSecurityHeaders(
		new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
		new URL('https://playdota2.win/admin')
	);

	assert.equal(asset.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
	assert.equal(html.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate');
	assert.equal(admin.headers.get('Cache-Control'), 'no-store');
});

test('production CSP authorizes the home preload and Cloudflare Web Analytics', () => {
	const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
	const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
	assert.ok(script);
	const hash = `sha256-${createHash('sha256').update(script).digest('base64')}`;
	const response = addSecurityHeaders(
		new Response(html, { headers: { 'Content-Type': 'text/html' } }),
		new URL('https://playdota2.win/')
	);

	const policy = response.headers.get('Content-Security-Policy') ?? '';
	assert.ok(policy.includes(`'${hash}'`));
	assert.match(policy, /script-src[^;]*https:\/\/static\.cloudflareinsights\.com/u);
});
