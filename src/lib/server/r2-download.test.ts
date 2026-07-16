import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createR2DownloadResponse,
	type R2DownloadBucket,
	type R2DownloadObject
} from './r2-download.ts';

const BODY = new TextEncoder().encode('0123456789');
const UPLOADED = new Date('2026-07-13T10:00:00.000Z');

function object(body = true): R2DownloadObject {
	return {
		size: BODY.byteLength,
		httpEtag: '"etag-1"',
		uploaded: UPLOADED,
		body: body ? new Response(BODY).body || undefined : undefined,
		customMetadata: { filename: 'stored.zip' },
		writeHttpMetadata(headers) {
			headers.set('Content-Type', 'application/zip');
		}
	};
}

function bucket(getObject = object()): R2DownloadBucket & { lastOptions?: R2GetOptions } {
	return {
		lastOptions: undefined,
		async head() {
			return object(false);
		},
		async get(_key, options) {
			this.lastOptions = options;
			return getObject;
		}
	};
}

test('streams a complete R2 object with download metadata', async () => {
	const response = await createR2DownloadResponse(
		bucket(),
		'uploads/id',
		new Request('https://example.com/file'),
		{ filename: '客户端.zip', headers: { 'Cache-Control': 'private, no-store' } }
	);

	assert.ok(response);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('content-length'), '10');
	assert.equal(response.headers.get('accept-ranges'), 'bytes');
	assert.equal(response.headers.get('etag'), '"etag-1"');
	assert.match(response.headers.get('content-disposition') || '', /filename\*=UTF-8''/u);
	assert.equal(await response.text(), '0123456789');
});

test('serves a bounded byte range as 206', async () => {
	const fakeBucket = bucket();
	const response = await createR2DownloadResponse(
		fakeBucket,
		'uploads/id',
		new Request('https://example.com/file', { headers: { Range: 'bytes=2-5' } }),
		{ filename: 'file.zip' }
	);

	assert.ok(response);
	assert.equal(response.status, 206);
	assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
	assert.equal(response.headers.get('content-length'), '4');
	assert.deepEqual(fakeBucket.lastOptions?.range, { offset: 2, length: 4 });
});

test('returns 416 for a syntactically valid but unsatisfiable range', async () => {
	const fakeBucket = bucket();
	const response = await createR2DownloadResponse(
		fakeBucket,
		'uploads/id',
		new Request('https://example.com/file', { headers: { Range: 'bytes=99-100' } }),
		{ filename: 'file.zip' }
	);

	assert.ok(response);
	assert.equal(response.status, 416);
	assert.equal(response.headers.get('content-range'), 'bytes */10');
	assert.equal(fakeBucket.lastOptions, undefined);
});

test('ignores malformed and multiple ranges instead of returning 416', async () => {
	for (const range of ['invalid', 'bytes=0-1,4-5']) {
		const fakeBucket = bucket();
		const response = await createR2DownloadResponse(
			fakeBucket,
			'uploads/id',
			new Request('https://example.com/file', { headers: { Range: range } }),
			{ filename: 'file.zip' }
		);
		assert.ok(response);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('content-range'), null);
		assert.equal(fakeBucket.lastOptions?.range, undefined);
	}
});

test('evaluates conditional requests before an unsatisfiable range', async () => {
	const fakeBucket = bucket();
	const response = await createR2DownloadResponse(
		fakeBucket,
		'uploads/id',
		new Request('https://example.com/file', {
			headers: { Range: 'bytes=99-100', 'If-None-Match': 'W/"etag-1"' }
		}),
		{ filename: 'file.zip' }
	);

	assert.ok(response);
	assert.equal(response.status, 304);
	assert.equal(response.headers.get('content-range'), null);
	assert.equal(fakeBucket.lastOptions, undefined);
});

test('ignores Range when If-Range does not match the current object', async () => {
	const fakeBucket = bucket();
	const response = await createR2DownloadResponse(
		fakeBucket,
		'uploads/id',
		new Request('https://example.com/file', {
			headers: { Range: 'bytes=2-5', 'If-Range': '"older-etag"' }
		}),
		{ filename: 'file.zip' }
	);

	assert.ok(response);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('content-range'), null);
	assert.equal(fakeBucket.lastOptions?.range, undefined);
});

test('returns a bodyless 304 when R2 reports a matching conditional request', async () => {
	const fakeBucket = bucket(object(false));
	const response = await createR2DownloadResponse(
		fakeBucket,
		'uploads/id',
		new Request('https://example.com/file', { headers: { 'If-None-Match': 'W/"etag-1"' } }),
		{ filename: 'file.zip' }
	);

	assert.ok(response);
	assert.equal(response.status, 304);
	assert.equal(response.body, null);
	assert.equal(fakeBucket.lastOptions?.onlyIf instanceof Headers, true);
});
