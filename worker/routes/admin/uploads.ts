import { json, type RequestHandler } from '../../http';
import { requireAdminAuth } from '$lib/admin-auth';
import type { ApiResponse, Platform } from '$lib/types';
import { MAX_ADMIN_R2_UPLOAD_BYTES, formatMiB } from '$lib/upload-limits';
import { buildContentDisposition, sanitizeFilename } from '$lib/utils/filename';
import {
	UploadLengthError,
	createUploadByteCounter,
	parseUploadContentLength
} from '$lib/server/admin-upload';
import { createManagedUploadKey, createManagedUploadUrl } from '$lib/server/download-object';

const PLATFORMS = new Set<Platform>(['windows', 'macos', 'linux']);

function normalizeContentType(value: string | null): string {
	return value && value.length <= 255 && /^[\x20-\x7e]+$/u.test(value)
		? value
		: 'application/octet-stream';
}

function uploadError(error: unknown): Response {
	if (error instanceof UploadLengthError) {
		return json({ success: false, error: error.message } satisfies ApiResponse, {
			status: error.status
		});
	}
	console.error({
		component: 'admin_upload',
		event_name: 'admin_upload_failed',
		message: 'Failed to stream an admin upload to R2',
		error_name: error instanceof Error ? error.name : 'UnknownError',
		error_message: error instanceof Error ? error.message : String(error)
	});
	return json({ success: false, error: 'Failed to upload file' } satisfies ApiResponse, {
		status: 500
	});
}

/**
 * Raw-body upload endpoint. Keeping the binary separate from the metadata JSON
 * avoids request.formData(), which would materialize the whole multipart body.
 */
export const PUT: RequestHandler = async ({ request, platform, url }) => {
	const r2 = platform?.env?.UPLOADS_BUCKET;
	if (!r2) {
		return json({ success: false, error: 'R2 not available' } satisfies ApiResponse, {
			status: 500
		});
	}

	if (!(await requireAdminAuth(request, platform?.env?.ADMIN_JWT_SECRET, platform?.env?.APP_KV))) {
		return json({ success: false, error: 'Unauthorized' } satisfies ApiResponse, { status: 401 });
	}

	const platformValue = url.searchParams.get('platform');
	if (!platformValue || !PLATFORMS.has(platformValue as Platform)) {
		return json({ success: false, error: 'Invalid platform' } satisfies ApiResponse, {
			status: 400
		});
	}
	const filename = sanitizeFilename(url.searchParams.get('filename') || 'download').slice(0, 512);
	if (!filename) {
		return json({ success: false, error: 'Invalid filename' } satisfies ApiResponse, {
			status: 400
		});
	}

	let expectedBytes: number;
	try {
		expectedBytes = parseUploadContentLength(request.headers.get('content-length'));
	} catch (error) {
		return uploadError(error);
	}
	if (!request.body) {
		return json({ success: false, error: 'Upload body is required' } satisfies ApiResponse, {
			status: 400
		});
	}

	const key = createManagedUploadKey(platformValue as Platform);
	let receivedBytes = 0;
	try {
		const fixedLength = new FixedLengthStream(expectedBytes);
		const pipePromise = request.body
			.pipeThrough(
				createUploadByteCounter(expectedBytes, (total) => {
					receivedBytes = total;
				})
			)
			.pipeTo(fixedLength.writable);
		const putPromise = r2.put(key, fixedLength.readable, {
			httpMetadata: {
				contentType: normalizeContentType(request.headers.get('content-type')),
				contentDisposition: buildContentDisposition(filename),
				cacheControl: 'private, no-store'
			},
			customMetadata: {
				filename,
				managedUpload: 'true',
				expectedBytes: String(expectedBytes)
			}
		});

		const [pipeResult, putResult] = await Promise.allSettled([pipePromise, putPromise]);
		if (receivedBytes !== expectedBytes) {
			throw new UploadLengthError('Upload body length did not match Content-Length', 400);
		}
		if (pipeResult.status === 'rejected') throw pipeResult.reason;
		if (putResult.status === 'rejected') throw putResult.reason;
		if (putResult.value.size !== expectedBytes) {
			throw new UploadLengthError('Upload body length did not match Content-Length', 400);
		}

		return json(
			{
				success: true,
				data: {
					url: createManagedUploadUrl(key),
					filename,
					size: putResult.value.size,
					maxSize: formatMiB(MAX_ADMIN_R2_UPLOAD_BYTES)
				}
			} satisfies ApiResponse<{
				url: string;
				filename: string;
				size: number;
				maxSize: string;
			}>,
			{ status: 201 }
		);
	} catch (error) {
		try {
			await r2.delete(key);
		} catch (cleanupError) {
			console.error({
				component: 'admin_upload',
				event_name: 'admin_upload_cleanup_failed',
				message: 'Failed to clean up an incomplete R2 upload',
				object_key: key,
				error_name: cleanupError instanceof Error ? cleanupError.name : 'UnknownError'
			});
		}
		return uploadError(error);
	}
};
