import type { Platform } from '../types.ts';
import { MAX_ADMIN_R2_UPLOAD_BYTES } from '../upload-limits.ts';
import {
	createManagedUploadUrl,
	getManagedUploadKey,
	isManagedUploadKey
} from './download-object.ts';

export class UploadLengthError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'UploadLengthError';
		this.status = status;
	}
}

export interface ManagedUploadObject {
	key: string;
	size: number;
	httpMetadata?: R2HTTPMetadata;
	customMetadata?: Record<string, string>;
}

export interface ManagedUploadBucket {
	head(key: string): Promise<ManagedUploadObject | null>;
}

export function parseUploadContentLength(
	value: string | null,
	maxBytes = MAX_ADMIN_R2_UPLOAD_BYTES
): number {
	if (value === null) {
		throw new UploadLengthError('Content-Length is required for uploads', 411);
	}
	if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
		throw new UploadLengthError('Invalid Content-Length', 400);
	}
	const length = Number(value);
	if (!Number.isSafeInteger(length) || length <= 0) {
		throw new UploadLengthError('Upload body must not be empty', 400);
	}
	if (length > maxBytes) {
		throw new UploadLengthError(
			`Upload exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB limit`,
			413
		);
	}
	return length;
}

/**
 * Counts every chunk even after Content-Length was checked. The caller pipes
 * this into a FixedLengthStream so R2 still receives a stream with known size.
 */
export function createUploadByteCounter(
	maxBytes: number,
	onBytes: (total: number) => void
): TransformStream<Uint8Array, Uint8Array> {
	let total = 0;
	return new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			total += chunk.byteLength;
			onBytes(total);
			if (total > maxBytes) {
				throw new UploadLengthError(
					`Upload exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB limit`,
					413
				);
			}
			controller.enqueue(chunk);
		}
	});
}

export async function resolveManagedUpload(
	bucket: ManagedUploadBucket,
	url: string,
	platform: Platform,
	maxBytes = MAX_ADMIN_R2_UPLOAD_BYTES
): Promise<ManagedUploadObject | null> {
	const key = getManagedUploadKey(url, platform);
	if (!key || !isManagedUploadKey(key, platform) || createManagedUploadUrl(key) !== url)
		return null;
	const object = await bucket.head(key);
	if (!object || object.size <= 0 || object.size > maxBytes) return null;
	if (
		object.customMetadata?.managedUpload !== 'true' ||
		object.customMetadata.expectedBytes !== String(object.size)
	) {
		return null;
	}
	return object;
}
