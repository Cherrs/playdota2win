import { json, ResponseCookies, type RequestEvent, type RequestHandler } from './http.ts';

export type HandlerModule = Readonly<Record<string, unknown>>;

export interface ApiRoute {
	match(pathname: string): Record<string, string> | null;
	handlers: HandlerModule;
}

interface RouteMatch {
	handlers: HandlerModule;
	params: Record<string, string>;
}

const ENDPOINT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;

export function exact(path: string, handlers: HandlerModule): ApiRoute {
	return {
		match: (pathname) => (pathname === path || pathname === `${path}/` ? {} : null),
		handlers
	};
}

export function splat(path: string, parameter: string, handlers: HandlerModule): ApiRoute {
	return {
		match: (pathname) => {
			let rawValue: string;
			if (pathname === path || pathname === `${path}/`) {
				rawValue = '';
			} else if (pathname.startsWith(`${path}/`)) {
				rawValue = pathname.slice(path.length + 1);
			} else {
				return null;
			}

			try {
				return { [parameter]: decodeURIComponent(rawValue) };
			} catch {
				return null;
			}
		},
		handlers
	};
}

function findRoute(routes: readonly ApiRoute[], pathname: string): RouteMatch | null {
	for (const route of routes) {
		const params = route.match(pathname);
		if (params) return { handlers: route.handlers, params };
	}
	return null;
}

export function allowedMethods(handlers: HandlerModule): string[] {
	const methods = ENDPOINT_METHODS.filter((method) => typeof handlers[method] === 'function');
	if (typeof handlers.GET === 'function' && typeof handlers.HEAD !== 'function') {
		methods.push('HEAD');
	}
	return methods;
}

function normalizeApiPath(url: URL): Response {
	const normalizedPath = url.pathname.slice(0, -1);
	return new Response(null, {
		status: 308,
		headers: {
			Location: `${normalizedPath}${url.search}`
		}
	});
}

export async function runApiHandler(
	request: Request,
	env: Env,
	executionContext: ExecutionContext,
	url: URL,
	routes: readonly ApiRoute[],
	fetchImplementation: typeof globalThis.fetch = globalThis.fetch
): Promise<Response> {
	const route = findRoute(routes, url.pathname);
	if (!route) {
		return json({ success: false, error: 'API endpoint not found' }, { status: 404 });
	}

	if (url.pathname.endsWith('/')) {
		return normalizeApiPath(url);
	}

	const requestMethod = request.method.toUpperCase();
	const handlerMethod =
		requestMethod === 'HEAD' && typeof route.handlers.HEAD !== 'function' ? 'GET' : requestMethod;
	const handler = route.handlers[handlerMethod] as RequestHandler | undefined;
	if (typeof handler !== 'function') {
		return json(
			{ success: false, error: 'Method not allowed' },
			{
				status: 405,
				headers: { Allow: allowedMethods(route.handlers).join(', ') }
			}
		);
	}

	const cookies = new ResponseCookies();
	const event: RequestEvent = {
		request,
		url,
		params: route.params,
		platform: {
			env,
			cf: request.cf,
			ctx: executionContext
		},
		cookies,
		fetch: fetchImplementation
	};
	const response = cookies.apply(await handler(event));

	return requestMethod === 'HEAD'
		? new Response(null, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers
			})
		: response;
}
