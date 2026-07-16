import assert from 'node:assert/strict';
import test from 'node:test';

import {
	UploadLengthError,
	createUploadByteCounter,
	parseUploadContentLength,
	resolveManagedUpload,
	type ManagedUploadBucket
} from './admin-upload.ts';

test('requires a positive bounded Content-Length for Worker uploads', () => {
	assert.equal(parseUploadContentLength('12', 20), 12);
	for (const value of [null, '', '-1', '1.5', ' 1', '0']) {
		assert.throws(() => parseUploadContentLength(value, 20), UploadLengthError);
	}
	assert.throws(
		() => parseUploadContentLength('21', 20),
		(error: unknown) => error instanceof UploadLengthError && error.status === 413
	);
});

test('counts streaming bytes and rejects a body that crosses the limit', async () => {
	let counted = 0;
	const source = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(3));
			controller.enqueue(new Uint8Array(4));
			controller.close();
		}
	});
	const stream = source.pipeThrough(createUploadByteCounter(6, (total) => (counted = total)));
	await assert.rejects(new Response(stream).arrayBuffer(), UploadLengthError);
	assert.equal(counted, 7);
});

test('resolves only canonical, existing, bounded managed upload URLs for the platform', async () => {
	const key = 'uploads/windows/11111111-1111-4111-8111-111111111111';
	const bucket: ManagedUploadBucket = {
		async head(candidate) {
			return candidate === key
				? {
						key,
						size: 12,
						customMetadata: { managedUpload: 'true', expectedBytes: '12' }
					}
				: null;
		}
	};

	assert.deepEqual(
		await resolveManagedUpload(bucket, `/api/admin/download/${key}`, 'windows', 20),
		{
			key,
			size: 12,
			customMetadata: { managedUpload: 'true', expectedBytes: '12' }
		}
	);
	assert.equal(await resolveManagedUpload(bucket, `/api/admin/download/${key}`, 'linux', 20), null);
	assert.equal(
		await resolveManagedUpload(
			{
				async head() {
					return {
						key,
						size: 21,
						customMetadata: { managedUpload: 'true', expectedBytes: '21' }
					};
				}
			},
			`/api/admin/download/${key}`,
			'windows',
			20
		),
		null
	);
	assert.equal(
		await resolveManagedUpload(
			{
				async head() {
					return { key, size: 12 };
				}
			},
			`/api/admin/download/${key}`,
			'windows',
			20
		),
		null
	);
});
