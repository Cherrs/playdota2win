import assert from 'node:assert/strict';
import test from 'node:test';

import type { RuntimePlatform } from '../../runtime.ts';
import { getMumbleProxyConfig, getMumbleProxyHealthUrl } from './config.ts';

test('derives proxy endpoints from the request URL when env vars are missing', async () => {
	const requestUrl = new URL('http://playdota2.win/download');

	assert.deepEqual(await getMumbleProxyConfig(undefined, requestUrl), {
		wsUrl: 'ws://playdota2.win:8080/ws',
		iceServers: [],
		healthUrl: 'http://playdota2.win:8080/health'
	});
	assert.equal(getMumbleProxyHealthUrl(undefined, requestUrl), 'http://playdota2.win:8080/health');
});

test('uses secure proxy endpoints for https request URLs', async () => {
	const requestUrl = new URL('https://playdota2.win/admin');

	assert.deepEqual(await getMumbleProxyConfig(undefined, requestUrl), {
		wsUrl: 'wss://playdota2.win:8080/ws',
		iceServers: [],
		healthUrl: 'https://playdota2.win:8080/health'
	});
	assert.equal(getMumbleProxyHealthUrl(undefined, requestUrl), 'https://playdota2.win:8080/health');
});

test('never publishes legacy TURN credentials or third-party ICE servers', async () => {
	const platform = {
		env: {
			MUMBLE_PROXY_WS_URL: 'wss://voice.example.com/ws',
			MUMBLE_PROXY_STUN_SERVERS: 'stun:external.example.com:3478,turn:external.example.com:3478',
			MUMBLE_PROXY_TURN_USERNAME: 'legacy-user',
			MUMBLE_PROXY_TURN_CREDENTIAL: 'legacy-secret'
		}
	} as RuntimePlatform;
	const config = await getMumbleProxyConfig(platform, new URL('https://playdota2.win'));
	assert.deepEqual(config?.iceServers, []);
	assert.ok(!JSON.stringify(config).includes('legacy-secret'));
	assert.equal(config?.wsUrl, 'wss://voice.example.com/ws');
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
