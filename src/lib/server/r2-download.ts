import { buildContentDisposition } from '../utils/filename.ts';

export interface R2DownloadObject {
	readonly size: number;
	readonly httpEtag: string;
	readonly uploaded: Date;
	readonly body?: ReadableStream;
	readonly customMetadata?: Record<string, string>;
	writeHttpMetadata(headers: Headers): void;
}

export interface R2DownloadBucket {
	head(key: string): Promise<R2DownloadObject | null>;
	get(key: string, options?: R2GetOptions): Promise<R2DownloadObject | null>;
}

export interface R2DownloadResponseOptions {
	filename?: string;
	fallbackFilename?: string;
	headers?: HeadersInit;
}

interface ParsedRange {
	offset: number;
	length: number;
}

type RangeParseResult =
	{ kind: 'range'; range: ParsedRange } | { kind: 'unsatisfiable' } | { kind: 'ignore' };

function parseRangeHeader(value: string, size: number): RangeParseResult {
	if (value.length > 256 || value.includes(',')) return { kind: 'ignore' };
	const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
	if (!match || (!match[1] && !match[2])) return { kind: 'ignore' };
	if (size === 0) return { kind: 'unsatisfiable' };

	if (!match[1]) {
		const suffix = Number(match[2]);
		if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: 'unsatisfiable' };
		const length = Math.min(suffix, size);
		return { kind: 'range', range: { offset: size - length, length } };
	}

	const offset = Number(match[1]);
	if (!Number.isSafeInteger(offset) || offset < 0 || offset >= size) {
		return { kind: 'unsatisfiable' };
	}
	if (!match[2]) return { kind: 'range', range: { offset, length: size - offset } };

	const requestedEnd = Number(match[2]);
	if (!Number.isSafeInteger(requestedEnd) || requestedEnd < offset) {
		return { kind: 'unsatisfiable' };
	}
	const end = Math.min(requestedEnd, size - 1);
	return { kind: 'range', range: { offset, length: end - offset + 1 } };
}

function ifRangeMatches(value: string | null, object: R2DownloadObject): boolean {
	if (!value) return true;
	const trimmed = value.trim();
	if (trimmed.startsWith('"') || trimmed.startsWith('W/')) {
		return !trimmed.startsWith('W/') && trimmed === object.httpEtag;
	}
	const timestamp = Date.parse(trimmed);
	return Number.isFinite(timestamp) && object.uploaded.getTime() <= timestamp + 999;
}

function conditionalHeaders(requestHeaders: Headers): Headers | undefined {
	const result = new Headers();
	for (const name of ['if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since']) {
		const value = requestHeaders.get(name);
		if (value !== null) result.set(name, value);
	}
	return Array.from(result).length > 0 ? result : undefined;
}

function weakEtag(value: string): string {
	return value.trim().replace(/^W\//u, '');
}

function etagListMatches(value: string, current: string, weak: boolean): boolean {
	if (value.trim() === '*') return true;
	return value.split(',').some((candidate) => {
		const trimmed = candidate.trim();
		if (!weak && trimmed.startsWith('W/')) return false;
		return weak ? weakEtag(trimmed) === weakEtag(current) : trimmed === current;
	});
}

function conditionalFailureStatus(
	requestHeaders: Headers,
	object: R2DownloadObject
): 304 | 412 | undefined {
	const ifMatch = requestHeaders.get('if-match');
	if (ifMatch && !etagListMatches(ifMatch, object.httpEtag, false)) return 412;

	if (!ifMatch) {
		const ifUnmodifiedSince = requestHeaders.get('if-unmodified-since');
		if (ifUnmodifiedSince) {
			const timestamp = Date.parse(ifUnmodifiedSince);
			if (Number.isFinite(timestamp) && object.uploaded.getTime() > timestamp + 999) return 412;
		}
	}

	const ifNoneMatch = requestHeaders.get('if-none-match');
	if (ifNoneMatch && etagListMatches(ifNoneMatch, object.httpEtag, true)) return 304;
	if (!ifNoneMatch) {
		const ifModifiedSince = requestHeaders.get('if-modified-since');
		if (ifModifiedSince) {
			const timestamp = Date.parse(ifModifiedSince);
			if (Number.isFinite(timestamp) && object.uploaded.getTime() <= timestamp + 999) return 304;
		}
	}

	return undefined;
}

function objectHeaders(object: R2DownloadObject, options: R2DownloadResponseOptions): Headers {
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('ETag', object.httpEtag);
	headers.set('Last-Modified', object.uploaded.toUTCString());
	headers.set('Accept-Ranges', 'bytes');
	const filename =
		options.filename || object.customMetadata?.filename || options.fallbackFilename || 'download';
	headers.set('Content-Disposition', buildContentDisposition(filename.slice(0, 512)));
	for (const [name, value] of new Headers(options.headers)) headers.set(name, value);
	return headers;
}

/**
 * Fetch an R2 object with RFC-compatible single-range and conditional GET support.
 * Returns null only when the object does not exist.
 */
export async function createR2DownloadResponse(
	bucket: R2DownloadBucket,
	key: string,
	request: Request,
	options: R2DownloadResponseOptions
): Promise<Response | null> {
	const rawRange = request.headers.get('range');
	let range: ParsedRange | undefined;

	if (rawRange) {
		const metadata = await bucket.head(key);
		if (!metadata) return null;
		const failedPrecondition = conditionalFailureStatus(request.headers, metadata);
		if (failedPrecondition !== undefined) {
			const headers = objectHeaders(metadata, options);
			headers.delete('Content-Length');
			headers.delete('Content-Range');
			return new Response(null, { status: failedPrecondition, headers });
		}
		if (ifRangeMatches(request.headers.get('if-range'), metadata)) {
			const parsedRange = parseRangeHeader(rawRange, metadata.size);
			if (parsedRange.kind === 'range') {
				range = parsedRange.range;
			} else if (parsedRange.kind === 'unsatisfiable') {
				const headers = objectHeaders(metadata, options);
				headers.set('Content-Range', `bytes */${metadata.size}`);
				headers.delete('Content-Length');
				return new Response(null, { status: 416, headers });
			}
		}
	}

	const onlyIf = conditionalHeaders(request.headers);
	const object = await bucket.get(key, {
		...(onlyIf ? { onlyIf } : {}),
		...(range ? { range } : {})
	});
	if (!object) return null;

	const headers = objectHeaders(object, options);
	if (!object.body) {
		headers.delete('Content-Length');
		headers.delete('Content-Range');
		return new Response(null, {
			status: conditionalFailureStatus(request.headers, object) ?? 412,
			headers
		});
	}

	if (range) {
		headers.set(
			'Content-Range',
			`bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`
		);
		headers.set('Content-Length', String(range.length));
		return new Response(object.body, { status: 206, headers });
	}

	headers.set('Content-Length', String(object.size));
	return new Response(object.body, { status: 200, headers });
}
