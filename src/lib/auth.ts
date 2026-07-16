import { timingSafeEqualSecrets } from './admin-auth.ts';

export const DOWNLOAD_TOKEN_EXPIRY = 5 * 60 * 1000; // 5 minutes

const DOWNLOAD_TOKEN_VERSION = 'v1';
const encoder = new TextEncoder();

/**
 * 验证下载密码
 */
export async function verifyDownloadPassword(
	password: string,
	env: App.Platform['env'] | undefined
): Promise<boolean> {
	const downloadPassword = env?.DOWNLOAD_PASSWORD;
	if (!downloadPassword) return false;
	return timingSafeEqualSecrets(password, downloadPassword);
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> | undefined {
	if (!/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
	const padding = '='.repeat((4 - (value.length % 4)) % 4);
	try {
		const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
		return Uint8Array.from(binary, (character) => character.charCodeAt(0));
	} catch {
		return undefined;
	}
}

async function importDownloadSigningKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
}

function downloadTokenMessage(path: string, expiresAt: number): Uint8Array<ArrayBuffer> {
	return encoder.encode(`${DOWNLOAD_TOKEN_VERSION}\n${expiresAt}\n${path}`);
}

/** 生成一个仅对指定 R2 对象有效的短期无状态下载 token。 */
export async function generateDownloadToken(
	path: string,
	signingSecret: string,
	now = Date.now()
): Promise<string> {
	if (!path || !signingSecret) throw new Error('Download signing configuration is missing');
	const expiresAt = Math.ceil((now + DOWNLOAD_TOKEN_EXPIRY) / 1000);
	const key = await importDownloadSigningKey(signingSecret);
	const signature = new Uint8Array(
		await crypto.subtle.sign('HMAC', key, downloadTokenMessage(path, expiresAt))
	);
	return `${DOWNLOAD_TOKEN_VERSION}.${expiresAt}.${bytesToBase64Url(signature)}`;
}

/** 验证 token 的签名、五分钟有效期以及绑定的 R2 对象路径。 */
export async function verifyDownloadToken(
	token: string | null,
	path: string,
	signingSecret: string | undefined,
	now = Date.now()
): Promise<boolean> {
	if (!token || !path || !signingSecret || token.length > 128) return false;
	const [version, rawExpiry, rawSignature, extra] = token.split('.');
	if (extra !== undefined || version !== DOWNLOAD_TOKEN_VERSION || !/^\d{10}$/u.test(rawExpiry)) {
		return false;
	}

	const expiresAt = Number(rawExpiry);
	const nowSeconds = Math.floor(now / 1000);
	const maxExpiry = Math.ceil((now + DOWNLOAD_TOKEN_EXPIRY) / 1000);
	if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds || expiresAt > maxExpiry) {
		return false;
	}

	const signature = base64UrlToBytes(rawSignature);
	if (!signature || signature.byteLength !== 32) return false;

	try {
		const key = await importDownloadSigningKey(signingSecret);
		return await crypto.subtle.verify(
			'HMAC',
			key,
			signature,
			downloadTokenMessage(path, expiresAt)
		);
	} catch {
		return false;
	}
}
