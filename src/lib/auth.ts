export const ADMIN_TOKEN_KEY = 'admin_auth_token';
export const ADMIN_TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
export const DOWNLOAD_TOKEN_KEY = 'download_auth_token';
export const DOWNLOAD_TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * 验证下载密码
 */
export function verifyDownloadPassword(
	password: string,
	env: App.Platform['env'] | undefined
): boolean {
	const downloadPassword = env?.DOWNLOAD_PASSWORD;
	if (!downloadPassword) return false;
	return password === downloadPassword;
}

function isDevMode(env: App.Platform['env'] | undefined): boolean {
	return env?.DEV_MODE === 'true';
}

/**
 * 生成下载 token
 */
export function generateDownloadToken(): string {
	return crypto.randomUUID();
}

/**
 * 验证下载 token
 */
export async function verifyDownloadToken(
	token: string | null,
	kv: KVNamespace | undefined,
	path?: string,
	env?: App.Platform['env']
): Promise<boolean> {
	if (!token) return false;

	// 开发环境，如果没有 KV，允许任何 token
	if (!kv) return isDevMode(env);

	try {
		const stored = await kv.get<{ token: string; expiry: number; path?: string }>(
			DOWNLOAD_TOKEN_KEY + ':' + token,
			'json'
		);
		if (!stored) return false;

		if (Date.now() > stored.expiry) {
			await kv.delete(DOWNLOAD_TOKEN_KEY + ':' + token);
			return false;
		}

		if (path && stored.path && stored.path !== path) {
			return false;
		}

		return true;
	} catch {
		return false;
	}
}

/**
 * 保存下载 token
 */
export async function saveDownloadToken(
	token: string,
	kv: KVNamespace | undefined,
	path?: string
): Promise<void> {
	if (!kv) return;

	const expiry = Date.now() + DOWNLOAD_TOKEN_EXPIRY;
	await kv.put(DOWNLOAD_TOKEN_KEY + ':' + token, JSON.stringify({ token, expiry, path }), {
		expirationTtl: Math.ceil(DOWNLOAD_TOKEN_EXPIRY / 1000)
	});
}

export async function verifyToken(
	token: string | null,
	kv: KVNamespace | undefined,
	env?: App.Platform['env']
): Promise<boolean> {
	if (!token) return false;

	// 开发环境，如果没有 KV，允许任何 token
	if (!kv) return isDevMode(env);

	try {
		const stored = await kv.get<{ token: string; expiry: number }>(ADMIN_TOKEN_KEY, 'json');
		if (!stored) return false;

		if (stored.token !== token) return false;
		if (Date.now() > stored.expiry) return false;

		return true;
	} catch {
		return false;
	}
}
