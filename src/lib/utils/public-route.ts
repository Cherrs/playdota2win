const PUBLIC_DOWNLOAD_PATHS = new Set(['/', '/download', '/download/']);

export function isPublicDownloadPath(pathname: string): boolean {
	return PUBLIC_DOWNLOAD_PATHS.has(pathname);
}
