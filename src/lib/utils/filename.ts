export function sanitizeFilename(raw: string): string {
	const withoutControls = Array.from(raw, (character) => {
		const code = character.charCodeAt(0);
		return code <= 31 || code === 127 ? ' ' : character;
	}).join('');
	const normalized = withoutControls
		.replace(/["']/g, '_')
		.replace(/[/\\]/g, '_')
		.replace(/\.\./g, '_')
		.trim();

	return normalized || 'download';
}

export function buildContentDisposition(filename: string): string {
	const safe = sanitizeFilename(filename);
	const asciiFallback = safe.replace(/[^\x20-\x7e]/g, '_');
	const encoded = encodeURIComponent(safe);
	return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
