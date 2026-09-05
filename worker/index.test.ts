import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';

import { createServer, type ViteDevServer } from 'vite';

interface WorkerEntrypoint {
	fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response>;
}

const root = resolve(import.meta.dirname, '..');
const assets = {
	fetch: async () => new Response('asset response', { headers: { 'X-Asset': 'true' } })
} as unknown as Fetcher;
const env = { ASSETS: assets } as Env;
const executionContext = {
	waitUntil() {},
	passThroughOnException() {}
} as unknown as ExecutionContext;

let vite: ViteDevServer;
let worker: WorkerEntrypoint;

test.before(async () => {
	vite = await createServer({
		root,
		configFile: false,
		appType: 'custom',
		logLevel: 'silent',
		server: { middlewareMode: true },
		resolve: {
			alias: {
				$lib: resolve(root, 'src/lib')
			}
		}
	});
	const entry = (await vite.ssrLoadModule('/worker/index.ts')) as {
		default: WorkerEntrypoint;
	};
	worker = entry.default;
});

test.after(async () => {
	await vite.close();
});

test('applies the runtime voice CSP to page, rejected admin and error responses', async () => {
	const configuredEnv = { ...env, MUMBLE_PROXY_WS_URL: 'wss://relay.example.net/ws' };
	const requests = [
		new Request('https://example.com/download'),
		new Request('https://example.com/api/admin', {
			method: 'POST',
			headers: { Origin: 'https://other.example.net' }
		})
	];
	for (const request of requests) {
		const response = await worker.fetch(request, configuredEnv, executionContext);
		assert.ok(response.headers.get('Content-Security-Policy')?.includes('wss://relay.example.net'));
	}
	const response = await worker.fetch(
		requests[0],
		{
			...configuredEnv,
			ASSETS: {
				fetch: async () => {
					throw new Error('fixture asset failure');
				}
			} as unknown as Fetcher
		},
		executionContext
	);
	assert.equal(response.status, 500);
	assert.ok(response.headers.get('Content-Security-Policy')?.includes('wss://relay.example.net'));
});

const endpoints = [
	['/api/admin', 'GET, POST, PUT, DELETE, HEAD'],
	['/api/admin/announcements', 'GET, POST, PUT, DELETE, HEAD'],
	['/api/admin/auth', 'GET, POST, DELETE, HEAD'],
	['/api/admin/categories', 'GET, POST, PUT, DELETE, HEAD'],
	['/api/admin/chat/nicknames', 'GET, PUT, HEAD'],
	['/api/admin/download/example.zip', 'GET, HEAD'],
	['/api/admin/downloads/sync', 'POST'],
	['/api/admin/downloads/update', 'POST'],
	['/api/admin/mumble/health', 'GET, HEAD'],
	['/api/admin/uploads', 'PUT'],
	['/api/announcements', 'GET, HEAD'],
	['/api/categories', 'GET, HEAD'],
	['/api/chat/nicknames', 'GET, HEAD'],
	['/api/downloads', 'GET, HEAD'],
	['/api/downloads/auth', 'GET, POST, HEAD'],
	['/api/downloads/link', 'GET, POST, HEAD'],
	['/api/downloads/relay/example.zip', 'GET, HEAD'],
	['/api/gettime', 'GET, HEAD'],
	['/api/mumble/config', 'GET, HEAD'],
	['/api/rustdesk', 'GET, OPTIONS, HEAD']
] as const;

test('all 20 endpoint paths expose the same 35 explicit methods plus HEAD fallbacks', async () => {
	assert.equal(endpoints.length, 20);
	assert.equal(
		endpoints.reduce(
			(count, [, allow]) => count + allow.split(', ').filter((method) => method !== 'HEAD').length,
			0
		),
		35
	);

	for (const [path, allow] of endpoints) {
		const response = await worker.fetch(
			new Request(`https://example.com${path}`, { method: 'PATCH' }),
			env,
			executionContext
		);
		assert.equal(response.status, 405, path);
		assert.equal(response.headers.get('Allow'), allow, path);
		assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff', path);
	}
});

test('rest endpoints still match an empty path parameter', async () => {
	for (const [path, allow] of [
		['/api/admin/download', 'GET, HEAD'],
		['/api/downloads/relay', 'GET, HEAD']
	] as const) {
		const response = await worker.fetch(
			new Request(`https://example.com${path}`, { method: 'PATCH' }),
			env,
			executionContext
		);
		assert.equal(response.status, 405, path);
		assert.equal(response.headers.get('Allow'), allow, path);
	}
});

test('entrypoint supplies HEAD, explicit OPTIONS, API 404 and asset fallback behavior', async () => {
	const head = await worker.fetch(
		new Request('https://example.com/api/gettime', { method: 'HEAD' }),
		env,
		executionContext
	);
	assert.equal(head.status, 200);
	assert.equal(await head.text(), '');
	assert.match(head.headers.get('Content-Type') ?? '', /^application\/json/u);

	const options = await worker.fetch(
		new Request('https://example.com/api/rustdesk', { method: 'OPTIONS' }),
		env,
		executionContext
	);
	assert.equal(options.status, 204);
	assert.equal(options.headers.get('Access-Control-Allow-Origin'), '*');

	const missing = await worker.fetch(
		new Request('https://example.com/api/not-found'),
		env,
		executionContext
	);
	assert.equal(missing.status, 404);
	assert.deepEqual(await missing.json(), {
		success: false,
		error: 'API endpoint not found'
	});
	const apiRoot = await worker.fetch(new Request('https://example.com/api'), env, executionContext);
	assert.equal(apiRoot.status, 404);
	assert.deepEqual(await apiRoot.json(), {
		success: false,
		error: 'API endpoint not found'
	});

	const asset = await worker.fetch(
		new Request('https://example.com/download'),
		env,
		executionContext
	);
	assert.equal(await asset.text(), 'asset response');
	assert.equal(asset.headers.get('X-Asset'), 'true');
	assert.match(asset.headers.get('Content-Security-Policy') ?? '', /default-src 'self'/u);
	assert.match(
		asset.headers.get('Content-Security-Policy') ?? '',
		/script-src[^;]*'unsafe-inline'/u
	);
});

test('cross-origin admin mutations are rejected before routing with security headers', async () => {
	const response = await worker.fetch(
		new Request('https://example.com/api/admin', {
			method: 'POST',
			headers: { Origin: 'https://attacker.example' }
		}),
		env,
		executionContext
	);

	assert.equal(response.status, 403);
	assert.equal(response.headers.get('Cache-Control'), 'no-store');
	assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
	assert.deepEqual(await response.json(), {
		success: false,
		error: '拒绝跨站管理请求'
	});
});
