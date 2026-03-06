import type { MumbleProxyConfig } from '$lib/types';

const DEFAULT_STUN_SERVERS = ['stun:stun.l.google.com:19302'];

function normalizeUrl(value: string | undefined): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

function parseStunServers(value: string | undefined): string[] {
	if (!value) {
		return DEFAULT_STUN_SERVERS;
	}

	const servers = value
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);

	return servers.length > 0 ? Array.from(new Set(servers)) : DEFAULT_STUN_SERVERS;
}

export function getMumbleProxyConfig(platform: App.Platform | undefined): MumbleProxyConfig | null {
	const wsUrl = normalizeUrl(platform?.env.MUMBLE_PROXY_WS_URL);
	if (!wsUrl) {
		return null;
	}

	return {
		wsUrl,
		stunServers: parseStunServers(platform?.env.MUMBLE_PROXY_STUN_SERVERS)
	};
}

export function getMumbleProxyHealthUrl(platform: App.Platform | undefined): string | null {
	const explicitUrl = normalizeUrl(platform?.env.MUMBLE_PROXY_HEALTH_URL);
	if (explicitUrl) {
		return explicitUrl;
	}

	const config = getMumbleProxyConfig(platform);
	if (!config) {
		return null;
	}

	try {
		const url = new URL(config.wsUrl);
		url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
		url.pathname = url.pathname.endsWith('/ws')
			? `${url.pathname.slice(0, -3)}/health`
			: `${url.pathname.replace(/\/+$/, '')}/health`;
		url.search = '';
		url.hash = '';
		return url.toString();
	} catch (error) {
		console.error('Failed to derive Mumble health URL from proxy WebSocket URL:', error);
		return null;
	}
}
