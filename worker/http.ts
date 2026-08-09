export interface CookieOptions {
	path?: string;
	domain?: string;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: 'strict' | 'lax' | 'none';
	maxAge?: number;
	expires?: Date;
}

export interface Cookies {
	set(name: string, value: string, options?: CookieOptions): void;
	delete(name: string, options?: CookieOptions): void;
}

export interface RequestEvent {
	request: Request;
	url: URL;
	params: Record<string, string>;
	platform?: {
		env?: Env;
		cf?: CfProperties;
		ctx?: ExecutionContext;
	};
	cookies: Cookies;
	fetch: typeof globalThis.fetch;
}

export type RequestHandler = (event: RequestEvent) => Response | Promise<Response>;

export function json(data: unknown, init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers);
	if (!headers.has('Content-Type')) {
		headers.set('Content-Type', 'application/json; charset=utf-8');
	}

	return new Response(JSON.stringify(data), { ...init, headers });
}

function serializeCookie(name: string, value: string, options: CookieOptions): string {
	const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
	if (options.path) parts.push(`Path=${options.path}`);
	if (options.domain) parts.push(`Domain=${options.domain}`);
	if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.trunc(options.maxAge)}`);
	if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
	if (options.httpOnly) parts.push('HttpOnly');
	if (options.secure) parts.push('Secure');
	if (options.sameSite) {
		parts.push(`SameSite=${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1)}`);
	}
	return parts.join('; ');
}

export class ResponseCookies implements Cookies {
	readonly #values: string[] = [];

	set(name: string, value: string, options: CookieOptions = {}): void {
		this.#values.push(serializeCookie(name, value, options));
	}

	delete(name: string, options: CookieOptions = {}): void {
		this.#values.push(
			serializeCookie(name, '', {
				...options,
				maxAge: 0,
				expires: new Date(0)
			})
		);
	}

	apply(response: Response): Response {
		if (this.#values.length === 0) return response;
		const headers = new Headers(response.headers);
		for (const cookie of this.#values) headers.append('Set-Cookie', cookie);
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers
		});
	}
}
