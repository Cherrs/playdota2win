import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { addSecurityHeaders, isCrossOriginAdminMutation } from './security.ts';

const target = new URL('https://example.com/api/admin');

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
		new URL('https://example.com/assets/index-a1b2c3.js')
	);
	const html = addSecurityHeaders(
		new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
		new URL('https://example.com/download')
	);
	const admin = addSecurityHeaders(
		new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
		new URL('https://example.com/admin')
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
		new URL('https://example.com/')
	);

	const policy = response.headers.get('Content-Security-Policy') ?? '';
	assert.ok(policy.includes(`'${hash}'`));
	assert.match(policy, /script-src[^;]*https:\/\/static\.cloudflareinsights\.com/u);
});

test('CSP permits the configured voice origin without permitting every WebSocket host', () => {
	const response = addSecurityHeaders(new Response('ok'), target, {
		MUMBLE_PROXY_WS_URL: 'wss://relay.example.net:8443/ws?token=test'
	});
	const policy = response.headers.get('Content-Security-Policy') ?? '';
	const sources = policy.match(/connect-src ([^;]+)/u)?.[1].split(' ') ?? [];
	assert.ok(sources.includes('wss://relay.example.net:8443'));
	assert.ok(!sources.includes('wss:'));
	assert.ok(!policy.includes('token=test'));
});

test('CSP follows the default voice endpoint on HTTPS and local HTTP', () => {
	for (const [page, endpoint] of [
		['https://example.com/download', 'wss://example.com:8080'],
		['http://localhost:5173/download', 'ws://localhost:8080']
	]) {
		const response = addSecurityHeaders(new Response('ok'), new URL(page));
		assert.ok(response.headers.get('Content-Security-Policy')?.includes(endpoint));
	}
});

test('CSP ignores invalid, credentialed, private and insecure production voice URLs', () => {
	for (const endpoint of [
		'wss://; script-src *',
		'wss://user:password@voice.example.com/ws',
		'ws://voice.example.com/ws',
		'wss://127.0.0.1:8080/ws',
		'https://voice.example.com/ws'
	]) {
		const response = addSecurityHeaders(new Response('ok'), target, {
			MUMBLE_PROXY_WS_URL: endpoint
		});
		const policy = response.headers.get('Content-Security-Policy') ?? '';
		assert.doesNotMatch(policy, /connect-src[^;]*wss?:/u);
		assert.equal(policy.split('script-src').length, 2);
		assert.ok(!policy.includes('password'));
	}
});
