export class RequestBodyError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 413
	) {
		super(message);
		this.name = 'RequestBodyError';
	}
}

/** Read JSON without allowing a missing/chunked Content-Length to bypass the route limit. */
export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
	const contentLength = request.headers.get('content-length');
	if (contentLength !== null) {
		if (!/^(?:0|[1-9]\d*)$/u.test(contentLength)) {
			throw new RequestBodyError('无效的 Content-Length', 400);
		}
		const declaredBytes = Number(contentLength);
		if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
			throw new RequestBodyError('请求内容过大', 413);
		}
	}

	if (!request.body) throw new RequestBodyError('请求内容不能为空', 400);
	const reader = request.body.getReader();
	const decoder = new TextDecoder('utf-8', { fatal: true });
	let total = 0;
	let text = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel('request body limit exceeded');
				throw new RequestBodyError('请求内容过大', 413);
			}
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
	} catch (error) {
		if (error instanceof RequestBodyError) throw error;
		throw new RequestBodyError('无效的请求编码', 400);
	}

	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new RequestBodyError('无效的 JSON 请求', 400);
	}
}
