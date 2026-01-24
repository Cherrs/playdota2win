const encoder = new TextEncoder();

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

function base64UrlDecodeToString(input: string): string {
	const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
	const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return new TextDecoder().decode(bytes);
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
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
	const parts = token.split('.');
	if (parts.length !== 3) return { valid: false };
	const [headerPart, payloadPart, signaturePart] = parts;
	const data = `${headerPart}.${payloadPart}`;
	const expected = await hmacSha256(secret, data);
	const expectedPart = base64UrlEncode(expected);
	if (expectedPart !== signaturePart) return { valid: false };

	const payloadJson = base64UrlDecodeToString(payloadPart);
	const payload = JSON.parse(payloadJson);
	if (typeof payload?.exp === 'number' && Date.now() > payload.exp) return { valid: false };
	return { valid: true, payload };
}
