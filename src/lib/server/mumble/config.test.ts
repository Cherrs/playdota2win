import assert from 'node:assert/strict';
import test from 'node:test';

import type { RuntimePlatform } from '../../runtime.ts';
import { getMumbleProxyConfig, getMumbleProxyHealthUrl } from './config.ts';

test('derives proxy endpoints from the request URL when env vars are missing', async () => {
	const requestUrl = new URL('http://playdota2.win/download');

	assert.deepEqual(await getMumbleProxyConfig(undefined, requestUrl), {
		wsUrl: 'ws://playdota2.win:8080/ws',
		iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
		healthUrl: 'http://playdota2.win:8080/health'
	});
	assert.equal(getMumbleProxyHealthUrl(undefined, requestUrl), 'http://playdota2.win:8080/health');
});

test('uses secure proxy endpoints for https request URLs', async () => {
	const requestUrl = new URL('https://playdota2.win/admin');

	assert.deepEqual(await getMumbleProxyConfig(undefined, requestUrl), {
		wsUrl: 'wss://playdota2.win:8080/ws',
		iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
		healthUrl: 'https://playdota2.win:8080/health'
	});
	assert.equal(getMumbleProxyHealthUrl(undefined, requestUrl), 'https://playdota2.win:8080/health');
});

test('ignores invalid STUN server URLs from env', async () => {
	const requestUrl = new URL('https://playdota2.win/download');
	const platform = {
		env: {
			MUMBLE_PROXY_STUN_SERVERS:
				'127.0.0.1:3478, stun:stun.cloudflare.com:3478, not-a-url, turns:turn.example.com:5349?transport=tcp'
		}
	} as RuntimePlatform;

	assert.deepEqual(await getMumbleProxyConfig(platform, requestUrl), {
		wsUrl: 'wss://playdota2.win:8080/ws',
		iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
		healthUrl: 'https://playdota2.win:8080/health'
	});
});

test('falls back to the default STUN server when env only contains invalid URLs', async () => {
	const requestUrl = new URL('https://playdota2.win/download');
	const platform = {
		env: {
			MUMBLE_PROXY_STUN_SERVERS: '127.0.0.1:3478, invalid-entry'
		}
	} as RuntimePlatform;

	assert.deepEqual(await getMumbleProxyConfig(platform, requestUrl), {
		wsUrl: 'wss://playdota2.win:8080/ws',
		iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
		healthUrl: 'https://playdota2.win:8080/health'
	});
});

test('attaches long-lived TURN credentials only to turn/turns URLs', async () => {
	const requestUrl = new URL('https://playdota2.win/download');
	const platform = {
		env: {
			MUMBLE_PROXY_STUN_SERVERS:
				'stun:stun.l.google.com:19302, turn:turn.example.com:3478, turns:turn.example.com:5349',
			MUMBLE_PROXY_TURN_USERNAME: 'turn-user',
			MUMBLE_PROXY_TURN_CREDENTIAL: 'turn-password'
		}
	} as RuntimePlatform;

	assert.deepEqual(await getMumbleProxyConfig(platform, requestUrl), {
		wsUrl: 'wss://playdota2.win:8080/ws',
		iceServers: [
			{ urls: 'stun:stun.l.google.com:19302' },
			{
				urls: 'turn:turn.example.com:3478',
				username: 'turn-user',
				credential: 'turn-password'
			},
			{
				urls: 'turns:turn.example.com:5349',
				username: 'turn-user',
				credential: 'turn-password'
			}
		],
		healthUrl: 'https://playdota2.win:8080/health'
	});
});

test('omits unusable TURN servers when long-lived credentials are incomplete', async () => {
	const requestUrl = new URL('https://playdota2.win/download');
	for (const env of [
		{
			MUMBLE_PROXY_STUN_SERVERS: 'stun:stun.example.com:3478, turn:turn.example.com:3478'
		},
		{
			MUMBLE_PROXY_STUN_SERVERS: 'stun:stun.example.com:3478, turn:turn.example.com:3478',
			MUMBLE_PROXY_TURN_USERNAME: 'turn-user'
		},
		{
			MUMBLE_PROXY_STUN_SERVERS: 'stun:stun.example.com:3478, turn:turn.example.com:3478',
			MUMBLE_PROXY_TURN_CREDENTIAL: 'turn-password'
		}
	]) {
		assert.deepEqual(await getMumbleProxyConfig({ env } as RuntimePlatform, requestUrl), {
			wsUrl: 'wss://playdota2.win:8080/ws',
			iceServers: [{ urls: 'stun:stun.example.com:3478' }],
			healthUrl: 'https://playdota2.win:8080/health'
		});
	}
});

test('rejects loopback proxy endpoints for public browser requests', async () => {
	const requestUrl = new URL('https://playdota2.win/download');
	const platform = {
		env: {
			MUMBLE_PROXY_WS_URL: 'ws://127.0.0.1:8080/ws',
			MUMBLE_PROXY_HEALTH_URL: 'http://127.0.0.1:8080/health'
		}
	} as RuntimePlatform;

	assert.equal(await getMumbleProxyConfig(platform, requestUrl), null);
	assert.equal(getMumbleProxyHealthUrl(platform, requestUrl), null);
});
