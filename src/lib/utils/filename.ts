export function sanitizeFilename(raw: string): string {
	const normalized = raw
		.replace(/[\r\n\t]/g, ' ')
		.replace(/["']/g, '_')
		.replace(/[/\\]/g, '_')
		.replace(/\.\./g, '_')
		.trim();

	return normalized || 'download';
}

export function buildContentDisposition(filename: string): string {
	const safe = sanitizeFilename(filename);
	const encoded = encodeURIComponent(safe);
	return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}
