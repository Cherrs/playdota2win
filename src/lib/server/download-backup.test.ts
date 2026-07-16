import assert from 'node:assert/strict';
import test from 'node:test';

import type { DownloadItem, R2BackupState } from '../types.ts';
import {
	createR2DownloadBackupStore,
	deleteDownloadBackup,
	getDownloadBackupObjectKey,
	getDownloadBackupState,
	getReadyDownloadBackupObjectKey,
	isDownloadBackupReady,
	isExternalDownloadAvailable,
	mapWithConcurrency,
	normalizeExternalDownloadUrl,
	queueDownloadBackup,
	shouldUseDownloadBackup,
	syncDownloadBackup,
	type DownloadBackupBucket,
	type DownloadBackupMultipartUpload,
	type DownloadBackupLogEntry,
	type DownloadBackupLogger,
	type DownloadBackupLogLevel,
	type DownloadBackupStateBucket,
	type DownloadBackupStore
} from './download-backup.ts';

class MemoryStore implements DownloadBackupStore {
	readonly values = new Map<string, { value: string; etag: string }>();
	beforePut?: (state: R2BackupState, expectedEtag: string | null) => Promise<void>;
	#version = 0;

	async get<T = unknown>(key: string, type: 'json') {
		assert.equal(type, 'json');
		const record = this.values.get(key);
		return record === undefined
			? null
			: {
					value: JSON.parse(record.value) as T,
					etag: record.etag
				};
	}

	async put(key: string, value: string, expectedEtag: string | null): Promise<string | null> {
		await this.beforePut?.(JSON.parse(value) as R2BackupState, expectedEtag);
		const current = this.values.get(key);
		if (expectedEtag === null ? current !== undefined : current?.etag !== expectedEtag) {
			return null;
		}
		const etag = `etag-${++this.#version}`;
		this.values.set(key, { value, etag });
		return etag;
	}

	async delete(key: string): Promise<void> {
		this.values.delete(key);
	}
}

class MemoryStateBucket implements DownloadBackupStateBucket {
	readonly values = new Map<string, { value: string; etag: string }>();
	lastOptions?: Pick<R2PutOptions, 'onlyIf' | 'httpMetadata' | 'customMetadata'>;
	#version = 0;

	async get(key: string): Promise<{ etag: string; text(): Promise<string> } | null> {
		const record = this.values.get(key);
		return record === undefined
			? null
			: {
					etag: record.etag,
					async text() {
						return record.value;
					}
				};
	}

	async put(
		key: string,
		value: string,
		options: Pick<R2PutOptions, 'onlyIf' | 'httpMetadata' | 'customMetadata'>
	): Promise<{ etag: string } | null> {
		this.lastOptions = options;
		const current = this.values.get(key);
		const onlyIf = options.onlyIf;
		assert.ok(onlyIf && !(onlyIf instanceof Headers));
		if (onlyIf.etagDoesNotMatch === '*' && current) return null;
		if (onlyIf.etagMatches !== undefined && current?.etag !== onlyIf.etagMatches) return null;
		const etag = `etag-${++this.#version}`;
		this.values.set(key, { value, etag });
		return { etag };
	}

	async delete(key: string): Promise<void> {
		this.values.delete(key);
	}
}

class MemoryBucket implements DownloadBackupBucket {
	lastStream?: ReadableStream;
	multipartAborted = false;
	multipartCreated = false;
	readonly objects = new Map<
		string,
		{ body: Uint8Array; options: Parameters<DownloadBackupBucket['put']>[2] }
	>();

	async put(
		key: string,
		value: ReadableStream,
		options: Parameters<DownloadBackupBucket['put']>[2]
	): Promise<{ key: string; size: number }> {
		this.lastStream = value;
		const body = new Uint8Array(await new Response(value).arrayBuffer());
		this.objects.set(key, { body, options });
		return { key, size: body.byteLength };
	}

	async createMultipartUpload(
		key: string,
		options: Parameters<NonNullable<DownloadBackupBucket['createMultipartUpload']>>[1]
	): Promise<DownloadBackupMultipartUpload> {
		this.multipartCreated = true;
		const parts = new Map<number, Uint8Array>();
		return {
			async uploadPart(partNumber, value) {
				let bytes: Uint8Array;
				if (typeof value === 'string') {
					bytes = new TextEncoder().encode(value);
				} else if (value instanceof Blob) {
					bytes = new Uint8Array(await value.arrayBuffer());
				} else if (value instanceof ReadableStream) {
					bytes = new Uint8Array(await new Response(value).arrayBuffer());
				} else if (value instanceof ArrayBuffer) {
					bytes = new Uint8Array(value.slice(0));
				} else {
					bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
				}
				parts.set(partNumber, bytes);
				return { partNumber, etag: `part-${partNumber}` };
			},
			abort: async () => {
				this.multipartAborted = true;
				parts.clear();
			},
			complete: async (uploadedParts) => {
				const ordered = uploadedParts.map(({ partNumber }) => parts.get(partNumber)!);
				const size = ordered.reduce((sum, value) => sum + value.byteLength, 0);
				const body = new Uint8Array(size);
				let offset = 0;
				for (const value of ordered) {
					body.set(value, offset);
					offset += value.byteLength;
				}
				this.objects.set(key, { body, options });
				return { key, size };
			}
		};
	}

	async delete(key: string): Promise<void> {
		this.objects.delete(key);
	}
}

class CapturingLogger implements DownloadBackupLogger {
	readonly records: Array<{ level: DownloadBackupLogLevel; entry: DownloadBackupLogEntry }> = [];

	write(level: DownloadBackupLogLevel, entry: DownloadBackupLogEntry): void {
		this.records.push({ level, entry });
	}

	entry(eventName: string): DownloadBackupLogEntry {
		const record = this.records.find((candidate) => candidate.entry.event_name === eventName);
		assert.ok(record, `Missing log event: ${eventName}`);
		return record.entry;
	}
}

const quietLogger = new CapturingLogger();

function deferred(): { promise: Promise<void>; resolve(): void } {
	let resolvePromise!: () => void;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: resolvePromise };
}

test('persists backup state in an immediately consistent R2 JSON adapter', async () => {
	const bucket = new MemoryStateBucket();
	const store = createR2DownloadBackupStore(bucket);
	const state = {
		status: 'pending',
		sourceUrl: 'https://example.com/file',
		operationId: 'operation-1',
		updatedAt: 1
	} as const;

	const etag = await store.put('_metadata/download-backups/item.json', JSON.stringify(state), null);
	assert.equal(etag, 'etag-1');
	assert.deepEqual(await store.get('_metadata/download-backups/item.json', 'json'), {
		value: state,
		etag: 'etag-1'
	});
	assert.equal(bucket.lastOptions?.customMetadata?.recordType, 'download-backup-state');
	assert.equal(bucket.lastOptions?.httpMetadata instanceof Headers, false);
	assert.deepEqual(bucket.lastOptions?.onlyIf, { etagDoesNotMatch: '*' });

	const nextState = { ...state, status: 'syncing' as const, updatedAt: 2 };
	assert.equal(
		await store.put('_metadata/download-backups/item.json', JSON.stringify(nextState), etag),
		'etag-2'
	);
	assert.deepEqual(bucket.lastOptions?.onlyIf, { etagMatches: 'etag-1' });
	assert.equal(
		await store.put('_metadata/download-backups/item.json', JSON.stringify(state), etag),
		null
	);
	assert.deepEqual(
		(await store.get('_metadata/download-backups/item.json', 'json'))?.value,
		nextState
	);
});

function linkItem(overrides: Partial<DownloadItem> = {}): DownloadItem {
	return {
		id: 'item-123',
		platform: 'windows',
		filename: '客户端 setup.exe',
		version: 'v1.0.0',
		size: '4MB',
		storageType: 'link',
		url: 'https://downloads.example.com/client.exe',
		createdAt: 1,
		updatedAt: 1,
		enabled: true,
		...overrides
	};
}

test('normalizes only absolute HTTP(S) download URLs', () => {
	assert.equal(
		normalizeExternalDownloadUrl(' https://example.com/file.zip '),
		'https://example.com/file.zip'
	);
	assert.throws(() => normalizeExternalDownloadUrl('/file.zip'));
	assert.throws(() => normalizeExternalDownloadUrl('ftp://example.com/file.zip'));
	assert.throws(() => normalizeExternalDownloadUrl('https://user:secret@example.com/file.zip'));
	assert.throws(() => normalizeExternalDownloadUrl('http://127.0.0.1/file.zip'));
	assert.throws(() => normalizeExternalDownloadUrl('http://169.254.169.254/latest/meta-data'));
	assert.throws(() => normalizeExternalDownloadUrl('http://[::1]/file.zip'));
	assert.throws(() => normalizeExternalDownloadUrl('http://[::ffff:127.0.0.1]/file.zip'));
	assert.throws(() => normalizeExternalDownloadUrl('https://service.local/file.zip'));
});

test('builds a stable and path-safe R2 mirror key', () => {
	assert.equal(getDownloadBackupObjectKey('abc-123'), 'mirrors/abc-123');
	assert.equal(getDownloadBackupObjectKey('../bad/id'), 'mirrors/___bad_id');
});

test('resolves the current ready R2 backup object', () => {
	const item = linkItem();
	assert.equal(
		getReadyDownloadBackupObjectKey(item, {
			status: 'ready',
			sourceUrl: item.url,
			operationId: 'ready-job',
			objectKey: 'mirrors/item-123/ready-job',
			updatedAt: 1
		}),
		'mirrors/item-123/ready-job'
	);
});

test('does not issue an expiring previous backup while a refresh is pending', () => {
	const item = linkItem();
	assert.equal(
		getReadyDownloadBackupObjectKey(item, {
			status: 'syncing',
			sourceUrl: item.url,
			operationId: 'refresh-job',
			objectKey: 'mirrors/item-123/refresh-job',
			previousBackup: {
				objectKey: 'mirrors/item-123/previous-job',
				sourceUrl: item.url
			},
			updatedAt: 2
		}),
		undefined
	);
});

test('does not use an R2 backup created for an older source URL', () => {
	const item = linkItem({ url: 'https://downloads.example.com/new-client.exe' });
	assert.equal(
		getReadyDownloadBackupObjectKey(item, {
			status: 'ready',
			sourceUrl: 'https://downloads.example.com/old-client.exe',
			operationId: 'old-job',
			objectKey: 'mirrors/item-123/old-job',
			updatedAt: 1
		}),
		undefined
	);
});

test('forces R2 without probing the external source', async () => {
	let sourceProbed = false;
	const useBackup = await shouldUseDownloadBackup(
		'r2',
		'https://downloads.example.com/client.exe',
		{
			fetchImpl: async () => {
				sourceProbed = true;
				throw new Error('source probe must not run');
			}
		}
	);

	assert.equal(useBackup, true);
	assert.equal(sourceProbed, false);
});

test('accepts a successful HEAD probe without downloading the body', async () => {
	const methods: string[] = [];
	const available = await isExternalDownloadAvailable('https://example.com/file', {
		fetchImpl: async (_input, init) => {
			methods.push(init?.method || 'GET');
			return new Response(null, { status: 200 });
		}
	});

	assert.equal(available, true);
	assert.deepEqual(methods, ['HEAD']);
});

test('falls back to a ranged GET when the origin rejects HEAD', async () => {
	const requests: Array<{ method: string; range: string | null }> = [];
	const available = await isExternalDownloadAvailable('https://example.com/file', {
		fetchImpl: async (_input, init) => {
			const headers = new Headers(init?.headers);
			requests.push({ method: init?.method || 'GET', range: headers.get('range') });
			return init?.method === 'HEAD'
				? new Response(null, { status: 405 })
				: new Response('x', { status: 206 });
		}
	});

	assert.equal(available, true);
	assert.deepEqual(requests, [
		{ method: 'HEAD', range: null },
		{ method: 'GET', range: 'bytes=0-0' }
	]);
});

test('reports an unavailable origin after both probes fail', async () => {
	let calls = 0;
	const available = await isExternalDownloadAvailable('https://example.com/file', {
		fetchImpl: async () => {
			calls += 1;
			throw new Error('offline');
		}
	});

	assert.equal(available, false);
	assert.equal(calls, 2);
});

test('streams an external download into R2 and records a ready state', async () => {
	const store = new MemoryStore();
	const bucket = new MemoryBucket();
	const item = linkItem();
	const queued = await queueDownloadBackup(store, item, { logger: quietLogger });

	const sourceResponse = new Response('file-content', {
		status: 200,
		headers: { 'content-type': 'application/octet-stream', 'content-length': '12' }
	});
	const sourceStream = sourceResponse.body;
	const state = await syncDownloadBackup(item, store, bucket, {
		operationId: queued.operationId,
		logger: quietLogger,
		fetchImpl: async () => sourceResponse
	});

	assert.equal(state.status, 'ready');
	assert.equal(state.size, 12);
	assert.equal(isDownloadBackupReady(item, state), true);
	const objectKey = state.objectKey;
	assert.ok(objectKey);
	assert.match(objectKey, /^mirrors\/item-123\/[a-f0-9-]+$/);
	const stored = bucket.objects.get(objectKey);
	assert.ok(stored);
	assert.equal(new TextDecoder().decode(stored.body), 'file-content');
	const metadata = stored.options.httpMetadata;
	assert.ok(metadata && !(metadata instanceof Headers));
	assert.equal(metadata.contentType, 'application/octet-stream');
	assert.match(metadata.contentDisposition || '', /filename="___ setup\.exe"/);
	assert.match(metadata.contentDisposition || '', /filename\*=UTF-8''%E5%AE%A2/);
	assert.equal(stored.options.customMetadata?.filename, '客户端 setup.exe');
	assert.deepEqual(await getDownloadBackupState(store, item.id), state);
	assert.strictEqual(bucket.lastStream, sourceStream);
	assert.equal(bucket.multipartCreated, false);
});

test('rejects an oversized declared backup before writing an R2 object', async () => {
	const store = new MemoryStore();
	const bucket = new MemoryBucket();
	const item = linkItem();
	const queued = await queueDownloadBackup(store, item, { logger: quietLogger });
	let bodyCancelled = false;
	const response = new Response(
		new ReadableStream<Uint8Array>({
			cancel() {
				bodyCancelled = true;
			}
		}),
		{ headers: { 'content-length': '7' } }
	);

	const state = await syncDownloadBackup(item, store, bucket, {
		operationId: queued.operationId,
		logger: quietLogger,
		maxBytes: 6,
		fetchImpl: async () => response
	});

	assert.equal(state.status, 'failed');
	assert.match(state.error || '', /exceeds/i);
	assert.equal(bucket.objects.size, 0);
	assert.equal(bucket.multipartCreated, false);
	assert.equal(bodyCancelled, true);
});

test('deletes a known-length R2 object when the stored size crosses the limit', async () => {
	const store = new MemoryStore();
	const item = linkItem();
	const queued = await queueDownloadBackup(store, item, { logger: quietLogger });
	const deleted: string[] = [];
	const bucket: DownloadBackupBucket = {
		async put(key, value) {
			await new Response(value).arrayBuffer();
			return { key, size: 7 };
		},
		async delete(key) {
			deleted.push(key);
		}
	};

	const state = await syncDownloadBackup(item, store, bucket, {
		operationId: queued.operationId,
		logger: quietLogger,
		maxBytes: 6,
		fetchImpl: async () => new Response(new Uint8Array(6), { headers: { 'content-length': '6' } })
	});

	assert.equal(state.status, 'failed');
	assert.match(state.error || '', /exceeds/i);
	assert.ok(
		deleted.includes(state.objectKey || getDownloadBackupObjectKey(item.id, queued.operationId))
	);
});

test('counts an unknown-length source, aborts multipart, and removes it on overflow', async () => {
	const store = new MemoryStore();
	const bucket = new MemoryBucket();
	const item = linkItem();
	const queued = await queueDownloadBackup(store, item, { logger: quietLogger });
	let bodyCancelled = false;
	const response = new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(4));
				controller.enqueue(new Uint8Array(4));
			},
			cancel() {
				bodyCancelled = true;
			}
		}),
		{ headers: { 'content-type': 'application/octet-stream' } }
	);

	const state = await syncDownloadBackup(item, store, bucket, {
		operationId: queued.operationId,
		logger: quietLogger,
		maxBytes: 6,
		fetchImpl: async () => response
	});

	assert.equal(state.status, 'failed');
	assert.match(state.error || '', /exceeds/i);
	assert.equal(bucket.multipartCreated, true);
	assert.equal(bucket.multipartAborted, true);
	assert.equal(bucket.objects.size, 0);
	assert.equal(bodyCancelled, true);
});

test('stores an unknown-length source through a bounded multipart upload', async () => {
	const store = new MemoryStore();
	const bucket = new MemoryBucket();
	const item = linkItem();
	const queued = await queueDownloadBackup(store, item, { logger: quietLogger });
	const response = new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('abc'));
				controller.enqueue(new TextEncoder().encode('def'));
				controller.close();
			}
		}),
		{ headers: { 'content-type': 'application/octet-stream' } }
	);

	const state = await syncDownloadBackup(item, store, bucket, {
		operationId: queued.operationId,
		logger: quietLogger,
		maxBytes: 6,
		fetchImpl: async () => response
	});

	assert.equal(state.status, 'ready');
	assert.equal(state.size, 6);
	assert.equal(bucket.multipartCreated, true);
	assert.equal(bucket.multipartAborted, false);
	assert.equal(new TextDecoder().decode(bucket.objects.get(state.objectKey!)?.body), 'abcdef');
});

test('logs bounded and redacted source diagnostics for an HTTP 400 response', async () => {
	const store = new MemoryStore();
	const bucket = new MemoryBucket();
	const logger = new CapturingLogger();
	const item = linkItem({
		url: 'https://d.example.com:8081/file.exe?token=topsecret&X-Amz-Signature=abcsecret'
	});
	const queued = await queueDownloadBackup(store, item, {
		logger,
		trigger: 'manual_single'
	});
	let bodyCancelled = false;
	const response = new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						`Client sent an HTTP request to an HTTPS server. token=topsecret ${'x'.repeat(2000)}`
					)
				);
			},
			cancel() {
				bodyCancelled = true;
			}
		}),
		{
			status: 400,
			statusText: 'Bad Request',
			headers: {
				server: 'Caddy',
				'content-type': 'text/plain; charset=utf-8',
				'content-length': '2100',
				'cf-ray': 'test-ray'
			}
		}
	);
	Object.defineProperty(response, 'url', {
		value: 'https://redirect.example.com:8443/file.exe?token=redirectsecret'
	});

	const state = await syncDownloadBackup(item, store, bucket, {
		operationId: queued.operationId,
		trigger: 'manual_single',
		logger,
		fetchImpl: async () => response
	});

	assert.equal(state.status, 'failed');
	assert.match(state.error || '', /HTTP 400/);
	assert.equal(bucket.objects.size, 0);
	assert.equal(bodyCancelled, true);

	const rejected = logger.entry('download_backup_source_rejected');
	assert.equal(rejected.item_id, item.id);
	assert.equal(rejected.operation_id, queued.operationId);
	assert.equal(rejected.trigger, 'manual_single');
	assert.equal(rejected.stage, 'source_response');
	assert.equal(rejected.origin_status, 400);
	assert.equal(rejected.origin_status_text, 'Bad Request');
	assert.equal(rejected.origin_server, 'Caddy');
	assert.equal(rejected.origin_content_type, 'text/plain; charset=utf-8');
	assert.equal(rejected.origin_cf_ray, 'test-ray');
	assert.equal(rejected.source_hostname, 'd.example.com');
	assert.equal(rejected.source_port, '8081');
	assert.equal(rejected.final_hostname, 'redirect.example.com');
	assert.equal(rejected.final_port, '8443');
	assert.equal(rejected.error_body_bytes_read, 1024);
	assert.equal(rejected.error_body_truncated, true);
	assert.match(String(rejected.error_body_preview), /HTTPS server/);
	assert.ok(String(rejected.error_body_preview).length <= 512);

	const failure = logger.entry('download_backup_failed');
	assert.equal(failure.error_kind, 'origin_http');
	assert.equal(failure.error_name, 'SourceHttpError');
	assert.equal(failure.backup_preserved, false);
	assert.equal(typeof failure.elapsed_ms, 'number');
	const serializedLogs = JSON.stringify(logger.records);
	assert.doesNotMatch(serializedLogs, /topsecret|abcsecret|redirectsecret/);
	assert.doesNotMatch(serializedLogs, /set-cookie|authorization/i);
});

test('does not read a binary error body for diagnostics', async () => {
	const store = new MemoryStore();
	const bucket = new MemoryBucket();
	const logger = new CapturingLogger();
	const item = linkItem();
	const queued = await queueDownloadBackup(store, item, { logger });
	let pullCount = 0;
	let bodyCancelled = false;
	const response = new Response(
		new ReadableStream<Uint8Array>({
			pull() {
				pullCount += 1;
			},
			cancel() {
				bodyCancelled = true;
			}
		}),
		{ status: 500, headers: { 'content-type': 'application/octet-stream' } }
	);

	await syncDownloadBackup(item, store, bucket, {
		operationId: queued.operationId,
		logger,
		fetchImpl: async () => response
	});

	const rejected = logger.entry('download_backup_source_rejected');
	assert.equal(rejected.error_body_preview_skipped, true);
	assert.equal(Object.hasOwn(rejected, 'error_body_preview'), false);
	assert.equal(bodyCancelled, true);
	assert.ok(pullCount <= 1);
});

test('classifies an R2 streaming failure in observability logs', async () => {
	const store = new MemoryStore();
	const logger = new CapturingLogger();
	const item = linkItem();
	const queued = await queueDownloadBackup(store, item, { logger, trigger: 'manual_single' });
	const bucket: DownloadBackupBucket = {
		async put() {
			throw new Error('R2 internal failure');
		},
		async delete() {}
	};

	const state = await syncDownloadBackup(item, store, bucket, {
		operationId: queued.operationId,
		trigger: 'manual_single',
		logger,
		fetchImpl: async () =>
			new Response('file', {
				headers: { 'content-type': 'application/octet-stream', 'content-length': '4' }
			})
	});

	assert.equal(state.status, 'failed');
	const failure = logger.entry('download_backup_failed');
	assert.equal(failure.stage, 'stream_to_r2');
	assert.equal(failure.error_kind, 'r2_put');
	assert.equal(failure.error_name, 'Error');
	assert.equal(failure.origin_content_length, '4');
});

test('records a failed state when the source download fails', async () => {
	const store = new MemoryStore();
	const bucket = new MemoryBucket();
	const item = linkItem();
	const queued = await queueDownloadBackup(store, item, { logger: quietLogger });

	const state = await syncDownloadBackup(item, store, bucket, {
		operationId: queued.operationId,
		logger: quietLogger,
		fetchImpl: async () => new Response(null, { status: 503 })
	});

	assert.equal(state.status, 'failed');
	assert.match(state.error || '', /HTTP 503/);
	assert.equal(bucket.objects.size, 0);
});

test('keeps a same-source ready backup when a later refresh fails', async () => {
	const store = new MemoryStore();
	const bucket = new MemoryBucket();
	const item = linkItem();
	const firstJob = await queueDownloadBackup(store, item, { logger: quietLogger });
	const firstReady = await syncDownloadBackup(item, store, bucket, {
		operationId: firstJob.operationId,
		logger: quietLogger,
		fetchImpl: async () => new Response('known-good')
	});
	assert.equal(firstReady.status, 'ready');

	const refreshJob = await queueDownloadBackup(store, item, { logger: quietLogger });
	const afterFailure = await syncDownloadBackup(item, store, bucket, {
		operationId: refreshJob.operationId,
		logger: quietLogger,
		fetchImpl: async () => new Response(null, { status: 502 })
	});

	assert.equal(afterFailure.status, 'ready');
	assert.equal(afterFailure.objectKey, firstReady.objectKey);
	assert.match(afterFailure.error || '', /Latest sync failed.*HTTP 502/);
	assert.equal(isDownloadBackupReady(item, afterFailure), true);
	assert.equal(bucket.objects.size, 1);
});

test('replaces and deletes the previous object after a successful refresh', async () => {
	const store = new MemoryStore();
	const bucket = new MemoryBucket();
	const item = linkItem();
	const firstJob = await queueDownloadBackup(store, item, { logger: quietLogger });
	const firstReady = await syncDownloadBackup(item, store, bucket, {
		operationId: firstJob.operationId,
		logger: quietLogger,
		fetchImpl: async () => new Response('version-one')
	});

	const refreshJob = await queueDownloadBackup(store, item, { logger: quietLogger });
	const refreshed = await syncDownloadBackup(item, store, bucket, {
		operationId: refreshJob.operationId,
		logger: quietLogger,
		fetchImpl: async () => new Response('version-two')
	});

	assert.equal(refreshed.status, 'ready');
	assert.notEqual(refreshed.objectKey, firstReady.objectKey);
	assert.equal(bucket.objects.has(firstReady.objectKey || ''), false);
	assert.equal(bucket.objects.size, 1);
});

test('deletes the current R2 object and backup state with the download item', async () => {
	const store = new MemoryStore();
	const bucket = new MemoryBucket();
	const item = linkItem();
	const job = await queueDownloadBackup(store, item, { logger: quietLogger });
	await syncDownloadBackup(item, store, bucket, {
		operationId: job.operationId,
		logger: quietLogger,
		fetchImpl: async () => new Response('file')
	});
	assert.equal(bucket.objects.size, 1);

	await deleteDownloadBackup(item.id, store, bucket);

	assert.equal(bucket.objects.size, 0);
	assert.equal(await getDownloadBackupState(store, item.id), undefined);
});

test('does not let a superseded background job overwrite a newer state', async () => {
	const store = new MemoryStore();
	const bucket = new MemoryBucket();
	const item = linkItem();
	const oldJob = await queueDownloadBackup(store, item, { logger: quietLogger });
	const newJob = await queueDownloadBackup(store, item, { logger: quietLogger });
	let fetched = false;

	const state = await syncDownloadBackup(item, store, bucket, {
		operationId: oldJob.operationId,
		logger: quietLogger,
		fetchImpl: async () => {
			fetched = true;
			return new Response('stale');
		}
	});

	assert.equal(fetched, false);
	assert.equal(state.operationId, newJob.operationId);
	assert.equal(state.status, 'pending');
});

test('does not start the same queued operation twice after it entered syncing', async () => {
	const store = new MemoryStore();
	const bucket = new MemoryBucket();
	const item = linkItem();
	const job = await queueDownloadBackup(store, item, { logger: quietLogger });
	const firstFetchReached = deferred();
	const releaseFirstFetch = deferred();
	const firstSync = syncDownloadBackup(item, store, bucket, {
		operationId: job.operationId,
		logger: quietLogger,
		fetchImpl: async () => {
			firstFetchReached.resolve();
			await releaseFirstFetch.promise;
			return new Response('file');
		}
	});
	await firstFetchReached.promise;

	let duplicateFetched = false;
	const duplicateResult = await syncDownloadBackup(item, store, bucket, {
		operationId: job.operationId,
		logger: quietLogger,
		fetchImpl: async () => {
			duplicateFetched = true;
			return new Response('duplicate');
		}
	});

	assert.equal(duplicateFetched, false);
	assert.equal(duplicateResult.status, 'syncing');
	releaseFirstFetch.resolve();
	assert.equal((await firstSync).status, 'ready');
});

test('ready CAS cannot overwrite a newer pending job during the final state transition', async () => {
	const store = new MemoryStore();
	const bucket = new MemoryBucket();
	const item = linkItem();
	const oldJob = await queueDownloadBackup(store, item, { logger: quietLogger });
	const readyWriteReached = deferred();
	const releaseReadyWrite = deferred();
	store.beforePut = async (state) => {
		if (state.operationId === oldJob.operationId && state.status === 'ready') {
			readyWriteReached.resolve();
			await releaseReadyWrite.promise;
		}
	};

	const oldSync = syncDownloadBackup(item, store, bucket, {
		operationId: oldJob.operationId,
		logger: quietLogger,
		fetchImpl: async () => new Response('stale-file')
	});
	await readyWriteReached.promise;
	const newJob = await queueDownloadBackup(store, item, { logger: quietLogger });
	releaseReadyWrite.resolve();
	const oldResult = await oldSync;

	assert.equal(oldResult.operationId, newJob.operationId);
	assert.equal(oldResult.status, 'pending');
	const persistedState = await getDownloadBackupState(store, item.id);
	assert.equal(persistedState?.operationId, newJob.operationId);
	assert.equal(persistedState?.status, 'pending');
	assert.equal(bucket.objects.size, 0);
});

test('failed CAS cannot overwrite a newer pending job during failure handling', async () => {
	const store = new MemoryStore();
	const bucket = new MemoryBucket();
	const item = linkItem();
	const oldJob = await queueDownloadBackup(store, item, { logger: quietLogger });
	const failedWriteReached = deferred();
	const releaseFailedWrite = deferred();
	store.beforePut = async (state) => {
		if (state.operationId === oldJob.operationId && state.status === 'failed') {
			failedWriteReached.resolve();
			await releaseFailedWrite.promise;
		}
	};

	const oldSync = syncDownloadBackup(item, store, bucket, {
		operationId: oldJob.operationId,
		logger: quietLogger,
		fetchImpl: async () => new Response(null, { status: 503 })
	});
	await failedWriteReached.promise;
	const newJob = await queueDownloadBackup(store, item, { logger: quietLogger });
	releaseFailedWrite.resolve();
	const oldResult = await oldSync;

	assert.equal(oldResult.operationId, newJob.operationId);
	assert.equal(oldResult.status, 'pending');
	const persistedState = await getDownloadBackupState(store, item.id);
	assert.equal(persistedState?.operationId, newJob.operationId);
	assert.equal(persistedState?.status, 'pending');
	assert.equal(bucket.objects.size, 0);
});

test('limits concurrent batch work', async () => {
	let active = 0;
	let peak = 0;
	const values = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
		active += 1;
		peak = Math.max(peak, active);
		await new Promise((resolve) => setTimeout(resolve, 5));
		active -= 1;
		return value * 2;
	});

	assert.deepEqual(values, [2, 4, 6, 8, 10, 12, 14]);
	assert.equal(peak, 3);
});
