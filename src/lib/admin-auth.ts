import { verifyJwt, signJwt } from '$lib/jwt';

export const ADMIN_SIGN_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const ADMIN_JWT_TTL_MS = 60 * 60 * 1000; // 1 hour

function getBearerToken(request: Request): string | null {
	const authHeader = request.headers.get('Authorization') ?? '';
	const token = authHeader.replace(/^Bearer\s+/i, '').trim();
	return token || null;
}

export async function requireAdminAuth(
	request: Request,
	secret: string | undefined,
	kv?: KVNamespace
): Promise<boolean> {
	const token = getBearerToken(request);
	if (!token || !secret) return false;
	void kv;
	const result = await verifyJwt(token, secret);
	return result.valid === true;
}

export async function issueAdminJwt(secret: string): Promise<string> {
	const now = Date.now();
	const payload = {
		sub: 'admin',
		iat: now,
		exp: now + ADMIN_JWT_TTL_MS
	};
	return signJwt(payload, secret);
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
	return Array.from(new Uint8Array(signature))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export async function signDownloadPath(path: string, secret: string, ttlMs = ADMIN_SIGN_TTL_MS): Promise<string> {
	const expires = Date.now() + ttlMs;
	const data = `${path}|${expires}`;
	const sig = await hmacSha256Hex(secret, data);
	const separator = path.includes('?') ? '&' : '?';
	return `${path}${separator}expires=${expires}&sig=${sig}`;
}

export async function verifySignedUrl(url: URL, secret: string): Promise<boolean> {
	const expiresRaw = url.searchParams.get('expires');
	const sig = url.searchParams.get('sig') ?? '';
	const expires = Number(expiresRaw);

	if (!expiresRaw || Number.isNaN(expires) || !sig) return false;
	if (Date.now() > expires) return false;

	const data = `${url.pathname}|${expires}`;
	const expected = await hmacSha256Hex(secret, data);
	return expected === sig;
}
