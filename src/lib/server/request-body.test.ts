import assert from 'node:assert/strict';
import test from 'node:test';

import { readBoundedJson, RequestBodyError } from './request-body.ts';

test('reads bounded JSON with or without Content-Length', async () => {
	assert.deepEqual(
		await readBoundedJson(
			new Request('https://example.com', { method: 'POST', body: JSON.stringify({ ok: true }) }),
			64
		),
		{ ok: true }
	);
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('{"ok":'));
			controller.enqueue(new TextEncoder().encode('true}'));
			controller.close();
		}
	});
	assert.deepEqual(
		await readBoundedJson(
			new Request('https://example.com', {
				method: 'POST',
				body: stream,
				duplex: 'half'
			} as RequestInit & { duplex: 'half' }),
			64
		),
		{ ok: true }
	);
});

test('rejects oversized declared and chunked request bodies', async () => {
	await assert.rejects(
		() =>
			readBoundedJson(
				new Request('https://example.com', {
					method: 'POST',
					headers: { 'Content-Length': '100' },
					body: '{}'
				}),
				10
			),
		(error: unknown) => error instanceof RequestBodyError && error.status === 413
	);
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(new Uint8Array(11));
		}
	});
	await assert.rejects(
		() =>
			readBoundedJson(
				new Request('https://example.com', {
					method: 'POST',
					body: stream,
					duplex: 'half'
				} as RequestInit & { duplex: 'half' }),
				10
			),
		(error: unknown) => error instanceof RequestBodyError && error.status === 413
	);
});
