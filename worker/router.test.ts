import assert from 'node:assert/strict';
import test from 'node:test';

import { json, type RequestEvent } from './http.ts';
import { allowedMethods, exact, runApiHandler, splat } from './router.ts';

const env = {} as Env;
const executionContext = {
	waitUntil() {},
	passThroughOnException() {}
} as unknown as ExecutionContext;

test('exact and rest routes retain the established path matching contract', () => {
	const exactRoute = exact('/api/downloads', {});
	assert.deepEqual(exactRoute.match('/api/downloads'), {});
	assert.deepEqual(exactRoute.match('/api/downloads/'), {});
	assert.equal(exactRoute.match('/api/downloads/more'), null);

	const restRoute = splat('/api/downloads/relay', 'path', {});
	assert.deepEqual(restRoute.match('/api/downloads/relay'), { path: '' });
	assert.deepEqual(restRoute.match('/api/downloads/relay/'), { path: '' });
	assert.deepEqual(restRoute.match('/api/downloads/relay/maps%2Ftest.zip'), {
		path: 'maps/test.zip'
	});
	assert.equal(restRoute.match('/api/downloads/relay-bad/maps/test.zip'), null);
	assert.equal(restRoute.match('/api/downloads/relay/%ZZ'), null);
});

test('adapter forwards request, params, platform, fetch and response cookies', async () => {
	let received: RequestEvent | undefined;
	const fetchImplementation = (async () => new Response('upstream')) as typeof globalThis.fetch;
	const routes = [
		splat('/api/files', 'path', {
			GET: (event: RequestEvent) => {
				received = event;
				event.cookies.set('session', 'signed token', {
					path: '/',
					httpOnly: true,
					secure: true,
					sameSite: 'strict'
				});
				return json({ path: event.params.path });
			}
		})
	];
	const request = new Request('https://example.com/api/files/maps%2Ftest.zip');
	const cf = { colo: 'HKG' } as CfProperties;
	Object.defineProperty(request, 'cf', { value: cf });
	const response = await runApiHandler(
		request,
		env,
		executionContext,
		new URL(request.url),
		routes,
		fetchImplementation
	);

	assert.equal(received?.request, request);
	assert.equal(received?.url.href, request.url);
	assert.deepEqual(received?.params, { path: 'maps/test.zip' });
	assert.equal(received?.platform?.env, env);
	assert.equal(received?.platform?.cf, cf);
	assert.equal(received?.platform?.ctx, executionContext);
	assert.equal(received?.fetch, fetchImplementation);
	assert.deepEqual(await response.json(), { path: 'maps/test.zip' });
	assert.match(response.headers.get('Set-Cookie') ?? '', /session=signed%20token/u);
	assert.match(response.headers.get('Set-Cookie') ?? '', /HttpOnly/u);
});

test('GET supplies HEAD while preserving headers and omitting the response body', async () => {
	let getCalls = 0;
	const routes = [
		exact('/api/probe', {
			GET: () => {
				getCalls += 1;
				return new Response('body', { headers: { ETag: 'probe-etag' } });
			}
		})
	];
	const request = new Request('https://example.com/api/probe', { method: 'HEAD' });
	const response = await runApiHandler(
		request,
		env,
		executionContext,
		new URL(request.url),
		routes
	);

	assert.equal(getCalls, 1);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('ETag'), 'probe-etag');
	assert.equal(await response.text(), '');
});

test('explicit HEAD handlers take precedence over GET', async () => {
	const routes = [
		exact('/api/probe', {
			GET: () => new Response('get', { headers: { 'X-Handler': 'get' } }),
			HEAD: () => new Response(null, { status: 204, headers: { 'X-Handler': 'head' } })
		})
	];
	const request = new Request('https://example.com/api/probe', { method: 'HEAD' });
	const response = await runApiHandler(
		request,
		env,
		executionContext,
		new URL(request.url),
		routes
	);

	assert.equal(response.status, 204);
	assert.equal(response.headers.get('X-Handler'), 'head');
});

test('405 includes the complete established Allow contract', async () => {
	const handlers = {
		GET: () => new Response(),
		POST: () => new Response(),
		OPTIONS: () => new Response()
	};
	assert.deepEqual(allowedMethods(handlers), ['GET', 'POST', 'OPTIONS', 'HEAD']);

	const request = new Request('https://example.com/api/probe', { method: 'PATCH' });
	const response = await runApiHandler(request, env, executionContext, new URL(request.url), [
		exact('/api/probe', handlers)
	]);

	assert.equal(response.status, 405);
	assert.equal(response.headers.get('Allow'), 'GET, POST, OPTIONS, HEAD');
	assert.deepEqual(await response.json(), { success: false, error: 'Method not allowed' });
});

test('known trailing-slash routes normalize and unknown routes remain 404', async () => {
	const routes = [exact('/api/probe', { GET: () => new Response('ok') })];
	const trailingRequest = new Request('https://example.com/api/probe/?page=2');
	const redirect = await runApiHandler(
		trailingRequest,
		env,
		executionContext,
		new URL(trailingRequest.url),
		routes
	);
	assert.equal(redirect.status, 308);
	assert.equal(redirect.headers.get('Location'), '/api/probe?page=2');

	const missingRequest = new Request('https://example.com/api/missing/');
	const missing = await runApiHandler(
		missingRequest,
		env,
		executionContext,
		new URL(missingRequest.url),
		routes
	);
	assert.equal(missing.status, 404);
	assert.deepEqual(await missing.json(), {
		success: false,
		error: 'API endpoint not found'
	});
});
