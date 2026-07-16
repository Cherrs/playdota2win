import { verifyJwt, signJwt } from './jwt.ts';

export const ADMIN_SIGN_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const ADMIN_JWT_TTL_MS = 60 * 60 * 1000; // 1 hour
export const ADMIN_SESSION_COOKIE = 'admin_session';
const encoder = new TextEncoder();
const SECRET_COMPARE_KEY = encoder.encode('playdota2win-secret-comparison-v1');

function getCookieValue(request: Request, name: string): string | null {
	const cookieHeader = request.headers.get('Cookie');
	if (!cookieHeader) return null;
	for (const part of cookieHeader.split(';')) {
		const separator = part.indexOf('=');
		if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
		const value = part.slice(separator + 1).trim();
		try {
			return decodeURIComponent(value) || null;
		} catch {
			return null;
		}
	}
	return null;
}

export async function requireAdminAuth(
	request: Request,
	secret: string | undefined,
	kv?: KVNamespace
): Promise<boolean> {
	const token = getCookieValue(request, ADMIN_SESSION_COOKIE);
	if (!token || !secret) return false;
	void kv;
	const result = await verifyJwt(token, secret);
	return result.valid === true && result.payload?.sub === 'admin';
}

export async function issueAdminJwt(secret: string): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const payload = {
		sub: 'admin',
		iat: now,
		exp: now + Math.floor(ADMIN_JWT_TTL_MS / 1000)
	};
	return signJwt(payload, secret);
}

async function importHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		usages
	);
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array<ArrayBuffer>> {
	const key = await importHmacKey(secret, ['sign']);
	return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> | null {
	if (!/^[a-f0-9]{64}$/i.test(value)) return null;
	const bytes = new Uint8Array(value.length / 2);
	for (let index = 0; index < bytes.length; index++) {
		bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

/** 先固定输入长度，再使用 Web Crypto HMAC verify 做常数时间比较。 */
export async function timingSafeEqualSecrets(provided: string, expected: string): Promise<boolean> {
	const [providedHash, expectedHash] = await Promise.all([
		crypto.subtle.digest('SHA-256', encoder.encode(provided)),
		crypto.subtle.digest('SHA-256', encoder.encode(expected))
	]);
	const compareKey = await crypto.subtle.importKey(
		'raw',
		SECRET_COMPARE_KEY,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
	const expectedSignature = await crypto.subtle.sign(
		'HMAC',
		compareKey,
		new Uint8Array(expectedHash)
	);
	return crypto.subtle.verify('HMAC', compareKey, expectedSignature, new Uint8Array(providedHash));
}

export async function signDownloadPath(
	path: string,
	secret: string,
	ttlMs = ADMIN_SIGN_TTL_MS
): Promise<string> {
	const expires = Date.now() + ttlMs;
	const data = `${path}|${expires}`;
	const sig = bytesToHex(await hmacSha256(secret, data));
	const separator = path.includes('?') ? '&' : '?';
	return `${path}${separator}expires=${expires}&sig=${sig}`;
}

export async function verifySignedUrl(url: URL, secret: string): Promise<boolean> {
	const expiresRaw = url.searchParams.get('expires');
	const sig = url.searchParams.get('sig') ?? '';
	const expires = Number(expiresRaw);

	if (!expiresRaw || !Number.isSafeInteger(expires) || !sig) return false;
	if (Date.now() > expires) return false;
	const signature = hexToBytes(sig);
	if (!signature) return false;

	const data = `${url.pathname}|${expires}`;
	const key = await importHmacKey(secret, ['verify']);
	return crypto.subtle.verify('HMAC', key, signature, encoder.encode(data));
}
