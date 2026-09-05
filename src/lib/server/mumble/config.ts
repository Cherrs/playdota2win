import type { MumbleProxyConfig } from '$lib/types';
import type { RuntimePlatform } from '$lib/runtime';

const DEFAULT_PROXY_PORT = '8080';

function normalizeUrl(value: string | undefined): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

function isIpv4Address(hostname: string): boolean {
	const parts = hostname.split('.');
	return (
		parts.length === 4 &&
		parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
	);
}

function isPrivateHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	if (
		normalized === 'localhost' ||
		normalized === '::1' ||
		normalized === '[::1]' ||
		normalized.endsWith('.localhost')
	) {
		return true;
	}

	if (!isIpv4Address(normalized)) {
		return false;
	}

	const [first, second] = normalized.split('.').map(Number);
	return (
		first === 10 ||
		first === 127 ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168)
	);
}

function isBrowserReachableUrl(value: string, requestUrl?: URL): boolean {
	if (!requestUrl || isPrivateHostname(requestUrl.hostname)) {
		return true;
	}

	try {
		return !isPrivateHostname(new URL(value).hostname);
	} catch {
		return false;
	}
}

function deriveProxyUrl(requestUrl: URL | undefined, kind: 'ws' | 'health'): string | null {
	if (!requestUrl) {
		return null;
	}

	const url = new URL(requestUrl);
	url.protocol =
		kind === 'ws'
			? requestUrl.protocol === 'https:'
				? 'wss:'
				: 'ws:'
			: requestUrl.protocol === 'https:'
				? 'https:'
				: 'http:';
	url.port = DEFAULT_PROXY_PORT;
	url.pathname = kind === 'ws' ? '/ws' : '/health';
	url.search = '';
	url.hash = '';
	return url.toString();
}

export async function getMumbleProxyConfig(
	platform: RuntimePlatform | undefined,
	requestUrl?: URL
): Promise<MumbleProxyConfig | null> {
	const wsUrl = normalizeUrl(platform?.env?.MUMBLE_PROXY_WS_URL);
	if (wsUrl && !isBrowserReachableUrl(wsUrl, requestUrl)) {
		return null;
	}
	if (!wsUrl && !requestUrl) {
		return null;
	}

	const healthUrl = normalizeUrl(platform?.env?.MUMBLE_PROXY_HEALTH_URL);

	return {
		wsUrl: wsUrl ?? deriveProxyUrl(requestUrl, 'ws')!,
		// Session-scoped ICE credentials arrive directly from MumDota over WSS.
		iceServers: [],
		healthUrl:
			healthUrl && !isBrowserReachableUrl(healthUrl, requestUrl)
				? null
				: (healthUrl ?? deriveProxyUrl(requestUrl, 'health'))
	};
}

export function getMumbleProxyHealthUrl(
	platform: RuntimePlatform | undefined,
	requestUrl?: URL
): string | null {
	const explicitUrl = normalizeUrl(platform?.env?.MUMBLE_PROXY_HEALTH_URL);
	if (explicitUrl) {
		return isBrowserReachableUrl(explicitUrl, requestUrl) ? explicitUrl : null;
	}

	const wsUrl =
		normalizeUrl(platform?.env?.MUMBLE_PROXY_WS_URL) ?? deriveProxyUrl(requestUrl, 'ws');
	if (!wsUrl || !isBrowserReachableUrl(wsUrl, requestUrl)) {
		return null;
	}

	try {
		const url = new URL(wsUrl);
		url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
		url.pathname = url.pathname.endsWith('/ws')
			? `${url.pathname.slice(0, -3)}/health`
			: `${url.pathname.replace(/\/+$/, '')}/health`;
		url.search = '';
		url.hash = '';
		return url.toString();
	} catch (error) {
		console.error('Failed to derive Mumble health URL from proxy WebSocket URL:', error);
		return deriveProxyUrl(requestUrl, 'health');
	}
}
