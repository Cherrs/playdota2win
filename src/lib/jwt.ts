const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const JWT_ALGORITHM = 'HS256';
const JWT_TYPE = 'JWT';
const MAX_JWT_LENGTH = 4096;
const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_LIFETIME_SECONDS = 60 * 60;

function base64UrlEncode(input: Uint8Array): string {
	let binary = '';
	for (const byte of input) {
		binary += String.fromCharCode(byte);
	}
	const b64 = btoa(binary);
	return b64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlEncodeJson(obj: object): string {
	return base64UrlEncode(encoder.encode(JSON.stringify(obj)));
}

function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> {
	if (!input || !/^[A-Za-z0-9_-]+$/.test(input) || input.length % 4 === 1) {
		throw new Error('Invalid base64url value');
	}
	const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
	const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function base64UrlDecodeJson(input: string): unknown {
	return JSON.parse(decoder.decode(base64UrlDecode(input)));
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array<ArrayBuffer>> {
	const key = await importHmacKey(secret);
	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
	return new Uint8Array(signature);
}

export async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
	const header = { alg: 'HS256', typ: 'JWT' };
	const headerPart = base64UrlEncodeJson(header);
	const payloadPart = base64UrlEncodeJson(payload);
	const data = `${headerPart}.${payloadPart}`;
	const signature = await hmacSha256(secret, data);
	const signaturePart = base64UrlEncode(signature);
	return `${data}.${signaturePart}`;
}

export async function verifyJwt(
	token: string,
	secret: string
): Promise<{ valid: boolean; payload?: Record<string, unknown> }> {
	if (!token || token.length > MAX_JWT_LENGTH || !secret) return { valid: false };

	try {
		const parts = token.split('.');
		if (parts.length !== 3) return { valid: false };
		const [headerPart, payloadPart, signaturePart] = parts;
		const header = base64UrlDecodeJson(headerPart);
		if (
			typeof header !== 'object' ||
			header === null ||
			Array.isArray(header) ||
			Object.keys(header).length !== 2 ||
			(header as Record<string, unknown>).alg !== JWT_ALGORITHM ||
			(header as Record<string, unknown>).typ !== JWT_TYPE
		) {
			return { valid: false };
		}

		const key = await importHmacKey(secret);
		const signature = base64UrlDecode(signaturePart);
		const data = encoder.encode(`${headerPart}.${payloadPart}`);
		if (!(await crypto.subtle.verify('HMAC', key, signature, data))) return { valid: false };

		const decodedPayload = base64UrlDecodeJson(payloadPart);
		if (
			typeof decodedPayload !== 'object' ||
			decodedPayload === null ||
			Array.isArray(decodedPayload)
		) {
			return { valid: false };
		}
		const payload = decodedPayload as Record<string, unknown>;
		const { sub, iat, exp } = payload;
		if (
			sub !== 'admin' ||
			!Number.isSafeInteger(iat) ||
			!Number.isSafeInteger(exp) ||
			(exp as number) <= (iat as number) ||
			(exp as number) - (iat as number) > MAX_TOKEN_LIFETIME_SECONDS
		) {
			return { valid: false };
		}

		const now = Math.floor(Date.now() / 1000);
		if ((iat as number) > now + CLOCK_SKEW_SECONDS || (exp as number) <= now) {
			return { valid: false };
		}
		return { valid: true, payload };
	} catch {
		return { valid: false };
	}
}
