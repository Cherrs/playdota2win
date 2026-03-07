import assert from 'node:assert/strict';
import test from 'node:test';

import { getMumbleProxyConfig, getMumbleProxyHealthUrl } from './config.ts';

test('derives proxy endpoints from the request URL when env vars are missing', () => {
	const requestUrl = new URL('http://playdota2.win/download');

	assert.deepEqual(getMumbleProxyConfig(undefined, requestUrl), {
		wsUrl: 'ws://playdota2.win:8080/ws',
		iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
		healthUrl: 'http://playdota2.win:8080/health'
	});
	assert.equal(getMumbleProxyHealthUrl(undefined, requestUrl), 'http://playdota2.win:8080/health');
});

test('uses secure proxy endpoints for https request URLs', () => {
	const requestUrl = new URL('https://playdota2.win/admin');

	assert.deepEqual(getMumbleProxyConfig(undefined, requestUrl), {
		wsUrl: 'wss://playdota2.win:8080/ws',
		iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
		healthUrl: 'https://playdota2.win:8080/health'
	});
	assert.equal(getMumbleProxyHealthUrl(undefined, requestUrl), 'https://playdota2.win:8080/health');
});

test('ignores invalid STUN server URLs from env', () => {
	const requestUrl = new URL('https://playdota2.win/download');
	const platform = {
		env: {
			MUMBLE_PROXY_STUN_SERVERS:
				'127.0.0.1:3478, stun:stun.cloudflare.com:3478, not-a-url, turns:turn.example.com:5349?transport=tcp'
		}
	} as App.Platform;

	assert.deepEqual(getMumbleProxyConfig(platform, requestUrl), {
		wsUrl: 'wss://playdota2.win:8080/ws',
		iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'turns:turn.example.com:5349?transport=tcp' }],
		healthUrl: 'https://playdota2.win:8080/health'
	});
});

test('falls back to the default STUN server when env only contains invalid URLs', () => {
	const requestUrl = new URL('https://playdota2.win/download');
	const platform = {
		env: {
			MUMBLE_PROXY_STUN_SERVERS: '127.0.0.1:3478, invalid-entry'
		}
	} as App.Platform;

	assert.deepEqual(getMumbleProxyConfig(platform, requestUrl), {
		wsUrl: 'wss://playdota2.win:8080/ws',
		iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
		healthUrl: 'https://playdota2.win:8080/health'
	});
});

test('attaches TURN credentials only to turn/turns URLs', () => {
	const requestUrl = new URL('https://playdota2.win/download');
	const platform = {
		env: {
			MUMBLE_PROXY_STUN_SERVERS:
				'stun:stun.l.google.com:19302, turn:turn.example.com:3478, turns:turn.example.com:5349',
			MUMBLE_PROXY_TURN_USERNAME: 'myuser',
			MUMBLE_PROXY_TURN_CREDENTIAL: 'mypassword'
		}
	} as App.Platform;

	assert.deepEqual(getMumbleProxyConfig(platform, requestUrl), {
		wsUrl: 'wss://playdota2.win:8080/ws',
		iceServers: [
			{ urls: 'stun:stun.l.google.com:19302' },
			{ urls: 'turn:turn.example.com:3478', username: 'myuser', credential: 'mypassword' },
			{ urls: 'turns:turn.example.com:5349', username: 'myuser', credential: 'mypassword' }
		],
		healthUrl: 'https://playdota2.win:8080/health'
	});
});

test('omits credentials when only username is set', () => {
	const requestUrl = new URL('https://playdota2.win/download');
	const platform = {
		env: {
			MUMBLE_PROXY_STUN_SERVERS: 'turn:turn.example.com:3478',
			MUMBLE_PROXY_TURN_USERNAME: 'myuser'
		}
	} as App.Platform;

	assert.deepEqual(getMumbleProxyConfig(platform, requestUrl), {
		wsUrl: 'wss://playdota2.win:8080/ws',
		iceServers: [{ urls: 'turn:turn.example.com:3478' }],
		healthUrl: 'https://playdota2.win:8080/health'
	});
});

test('rejects loopback proxy endpoints for public browser requests', () => {
	const requestUrl = new URL('https://playdota2.win/download');
	const platform = {
		env: {
			MUMBLE_PROXY_WS_URL: 'ws://127.0.0.1:8080/ws',
			MUMBLE_PROXY_HEALTH_URL: 'http://127.0.0.1:8080/health'
		}
	} as App.Platform;

	assert.equal(getMumbleProxyConfig(platform, requestUrl), null);
	assert.equal(getMumbleProxyHealthUrl(platform, requestUrl), null);
});
