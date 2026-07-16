function isPrivateIpv4(hostname: string): boolean {
	const parts = hostname.split('.');
	if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return false;
	const octets = parts.map(Number);
	if (octets.some((octet) => octet < 0 || octet > 255)) return false;
	const [first, second] = octets;
	return (
		first === 0 ||
		first === 10 ||
		first === 127 ||
		(first === 100 && second >= 64 && second <= 127) ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168) ||
		first >= 224
	);
}

function parseIpv6(hostname: string): number[] | null {
	let normalized = hostname;
	const ipv4Tail = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized)?.[1];
	if (ipv4Tail) {
		const octets = ipv4Tail.split('.').map(Number);
		if (octets.length !== 4 || octets.some((octet) => octet < 0 || octet > 255)) return null;
		normalized =
			normalized.slice(0, -ipv4Tail.length) +
			`${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
	}
	const halves = normalized.split('::');
	if (halves.length > 2) return null;
	const parseHalf = (value: string): number[] | null => {
		if (!value) return [];
		const groups = value.split(':');
		if (groups.some((group) => !/^[0-9a-f]{1,4}$/iu.test(group))) return null;
		return groups.map((group) => Number.parseInt(group, 16));
	};
	const left = parseHalf(halves[0]);
	const right = parseHalf(halves[1] || '');
	if (!left || !right) return null;
	if (halves.length === 1) return left.length === 8 ? left : null;
	const missing = 8 - left.length - right.length;
	return missing >= 1 ? [...left, ...new Array<number>(missing).fill(0), ...right] : null;
}

function isPrivateIpv6(hostname: string): boolean {
	const groups = parseIpv6(hostname);
	if (!groups) return false;
	if (groups.every((group) => group === 0)) return true;
	if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;
	if ((groups[0] & 0xfe00) === 0xfc00) return true;
	if ((groups[0] & 0xffc0) === 0xfe80) return true;
	if ((groups[0] & 0xff00) === 0xff00) return true;
	const mappedOrCompatible =
		groups.slice(0, 5).every((group) => group === 0) && (groups[5] === 0 || groups[5] === 0xffff);
	if (!mappedOrCompatible) return false;
	return isPrivateIpv4(
		`${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
	);
}

export function isPrivateNetworkHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
	if (
		normalized === 'localhost' ||
		normalized.endsWith('.localhost') ||
		normalized.endsWith('.local') ||
		normalized === 'metadata.google.internal'
	) {
		return true;
	}
	if (isPrivateIpv4(normalized)) return true;
	if (!normalized.includes(':')) return false;
	return isPrivateIpv6(normalized);
}

/** Browser-safe validation for direct S3 uploads and their public URLs. */
export function normalizePublicHttpsUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 8192) throw new Error('URL 长度无效');
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error('URL 必须是有效的绝对 HTTPS 地址');
	}
	if (parsed.protocol !== 'https:') throw new Error('URL 必须使用 HTTPS');
	if (parsed.username || parsed.password) throw new Error('URL 不能包含用户名或密码');
	if (isPrivateNetworkHostname(parsed.hostname)) throw new Error('URL 必须使用公网主机');
	return parsed.toString();
}
