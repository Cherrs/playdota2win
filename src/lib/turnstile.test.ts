import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FAILURE_THRESHOLD,
	FailureCounter,
	FailureCounterUnavailableError,
	getClientIp,
	isExpectedTurnstileResult,
	TURNSTILE_ACTION
} from './turnstile.ts';

test('accepts Turnstile only for the expected action, flow and hostname', () => {
	const valid = {
		success: true,
		action: TURNSTILE_ACTION,
		cdata: 'admin-auth',
		hostname: 'example.com'
	};
	assert.equal(isExpectedTurnstileResult(valid, 'admin-auth', 'example.com'), true);
	assert.equal(isExpectedTurnstileResult(valid, 'download-auth', 'example.com'), false);
	assert.equal(isExpectedTurnstileResult(valid, 'admin-auth', 'evil.example.com'), false);
	assert.equal(
		isExpectedTurnstileResult({ ...valid, action: 'other' }, 'admin-auth', 'example.com'),
		false
	);
});

test('does not trust X-Forwarded-For on public requests', () => {
	const publicRequest = new Request('https://example.com/api/admin/auth', {
		headers: { 'X-Forwarded-For': '203.0.113.10' }
	});
	const localRequest = new Request('http://localhost/api/admin/auth', {
		headers: { 'X-Forwarded-For': '203.0.113.10' }
	});

	assert.equal(getClientIp(publicRequest), 'missing-cloudflare-ip');
	assert.equal(getClientIp(localRequest), '203.0.113.10');
});

test('treats corrupt counters as already gated and increments without a second read', async () => {
	let reads = 0;
	let written = '';
	const kv = {
		get: async () => {
			reads += 1;
			return 'corrupt';
		},
		put: async (_key: string, value: string) => {
			written = value;
		}
	} as unknown as KVNamespace;
	const counter = new FailureCounter(kv, 'test', undefined, true);

	const count = await counter.getCount('ip');
	assert.equal(count, FAILURE_THRESHOLD);
	assert.equal(await counter.increment('ip', count), FAILURE_THRESHOLD + 1);
	assert.equal(reads, 1);
	assert.equal(written, String(FAILURE_THRESHOLD + 1));
});

test('fails closed when KV reads fail', async (context) => {
	context.mock.method(console, 'error', () => undefined);
	const kv = {
		get: async () => {
			throw new Error('KV unavailable');
		}
	} as unknown as KVNamespace;

	await assert.rejects(() => new FailureCounter(kv, 'test', undefined, true).getCount('ip'));
});

test('refuses an implicit KV fallback outside explicit local development', async () => {
	const kv = { get: async () => '0' } as unknown as KVNamespace;
	await assert.rejects(
		() => new FailureCounter(kv, 'test').getCount('ip'),
		FailureCounterUnavailableError
	);
});

test('records concurrent failures in one bounded strongly consistent R2 counter', async () => {
	let etagSequence = 0;
	const objects = new Map<string, { value: string; etag: string }>();
	const r2 = {
		get: async (key: string) => {
			const object = objects.get(key);
			return object
				? { etag: object.etag, json: async () => JSON.parse(object.value) as unknown }
				: null;
		},
		put: async (
			key: string,
			value: string,
			options: { onlyIf: { etagMatches?: string; etagDoesNotMatch?: string } }
		) => {
			const existing = objects.get(key);
			if (options.onlyIf.etagMatches && existing?.etag !== options.onlyIf.etagMatches) return null;
			if (options.onlyIf.etagDoesNotMatch === '*' && existing) return null;
			const stored = { value, etag: `etag-${++etagSequence}` };
			objects.set(key, stored);
			return stored;
		},
		delete: async (keys: string | string[]) => {
			for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
		}
	} as unknown as R2Bucket;
	const counter = new FailureCounter(undefined, 'test', r2);

	await Promise.all(Array.from({ length: 10 }, () => counter.increment('203.0.113.10')));
	assert.equal(await counter.getCount('203.0.113.10'), FAILURE_THRESHOLD);
	assert.equal(objects.size, 1);
	assert.equal(await counter.increment('203.0.113.10', FAILURE_THRESHOLD), FAILURE_THRESHOLD);
	assert.equal(objects.size, 1);
	await counter.clear('203.0.113.10');
	assert.equal(await counter.getCount('203.0.113.10'), 0);
	assert.equal(objects.size, 1);

	const staleClear = new FailureCounter(undefined, 'test', r2);
	assert.equal(await staleClear.getCount('203.0.113.10'), 0);
	const key = [...objects.keys()][0];
	objects.set(key, {
		value: JSON.stringify({ count: 1, expiresAt: Date.now() + 60_000 }),
		etag: `etag-${++etagSequence}`
	});
	await staleClear.clear('203.0.113.10');
	assert.equal(await new FailureCounter(undefined, 'test', r2).getCount('203.0.113.10'), 1);
});
