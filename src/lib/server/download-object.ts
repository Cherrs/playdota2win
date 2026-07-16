import type { Platform } from '../types.ts';

export const MANAGED_UPLOAD_PREFIX = 'uploads/';
export const MANAGED_UPLOAD_URL_PREFIX = '/api/admin/download/';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PLATFORMS = new Set<Platform>(['windows', 'macos', 'linux']);

export function createManagedUploadKey(platform: Platform, id = crypto.randomUUID()): string {
	return `${MANAGED_UPLOAD_PREFIX}${platform}/${id}`;
}

export function createManagedUploadUrl(key: string): string {
	if (!isManagedUploadKey(key)) throw new Error('Invalid managed upload key');
	return `${MANAGED_UPLOAD_URL_PREFIX}${key}`;
}

export function isManagedUploadKey(key: string, expectedPlatform?: Platform): boolean {
	const segments = key.split('/');
	if (segments.length !== 3 || segments[0] !== 'uploads') return false;
	const platform = segments[1] as Platform;
	return (
		PLATFORMS.has(platform) &&
		(!expectedPlatform || platform === expectedPlatform) &&
		UUID_PATTERN.test(segments[2])
	);
}

export function getManagedUploadKey(url: string, expectedPlatform?: Platform): string | null {
	if (!url.startsWith(MANAGED_UPLOAD_URL_PREFIX)) return null;
	const key = url.slice(MANAGED_UPLOAD_URL_PREFIX.length);
	return isManagedUploadKey(key, expectedPlatform) ? key : null;
}
