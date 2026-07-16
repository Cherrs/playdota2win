import type { IceServer, MumbleProxyConfig } from '$lib/types';

const DEFAULT_STUN_SERVERS = ['stun:stun.l.google.com:19302'];
const DEFAULT_PROXY_PORT = '8080';
const VALID_ICE_PROTOCOLS = new Set(['stun:', 'turn:', 'turns:']);

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

function parseIceServerUrls(value: string | undefined): string[] {
	const urls = value
		? value
				.split(',')
				.map((entry) => entry.trim())
				.filter(Boolean)
				.filter((entry) => {
					try {
						const url = new URL(entry);
						return VALID_ICE_PROTOCOLS.has(url.protocol) && url.pathname.length > 0;
					} catch {
						return false;
					}
				})
		: [];

	return urls.length > 0 ? Array.from(new Set(urls)) : DEFAULT_STUN_SERVERS;
}

function createIceServers(platform: App.Platform | undefined): IceServer[] {
	const urls = parseIceServerUrls(platform?.env?.MUMBLE_PROXY_STUN_SERVERS);
	const username = platform?.env?.MUMBLE_PROXY_TURN_USERNAME?.trim();
	const credential = platform?.env?.MUMBLE_PROXY_TURN_CREDENTIAL?.trim();
	const credentials = username && credential ? { username, credential } : null;

	return urls.flatMap((url) => {
		const isTurn = url.startsWith('turn:') || url.startsWith('turns:');
		if (isTurn && !credentials) {
			return [];
		}
		return [{ urls: url, ...(isTurn ? credentials : null) }];
	});
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
	platform: App.Platform | undefined,
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
		iceServers: createIceServers(platform),
		healthUrl:
			healthUrl && !isBrowserReachableUrl(healthUrl, requestUrl)
				? null
				: (healthUrl ?? deriveProxyUrl(requestUrl, 'health'))
	};
}

export function getMumbleProxyHealthUrl(
	platform: App.Platform | undefined,
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
