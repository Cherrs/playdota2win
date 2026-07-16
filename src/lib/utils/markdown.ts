/** 只允许在指引和公告中打开的 URL 协议。 */
const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mumble:']);
const MAX_LINK_LENGTH = 2048;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * 验证用户可见内容里的链接。相对路径只允许当前站点内的绝对路径和锚点。
 */
export function getSafePublicUrl(rawValue: string): string | null {
	const value = rawValue.trim();
	const hasControlCharacter = Array.from(value).some((character) => {
		const code = character.charCodeAt(0);
		return code <= 31 || code === 127;
	});
	if (!value || value.length > MAX_LINK_LENGTH || hasControlCharacter || /[\s"'<>\\]/.test(value)) {
		return null;
	}
	if (value.startsWith('#')) return value;
	if (value.startsWith('/') && !value.startsWith('//')) return value;

	try {
		const parsed = new URL(value);
		if (!ALLOWED_LINK_PROTOCOLS.has(parsed.protocol.toLowerCase())) return null;
		if (parsed.username || parsed.password) return null;
		return value;
	} catch {
		return null;
	}
}

/**
 * 解析简单的 Markdown 到 HTML
 */
export function parseMarkdown(text: string): string {
	if (!text) return '';

	// 先将 Markdown 链接换成不可由输入伪造的占位符，再进行 HTML 转义。
	// 这样用户输入永远不会进入 href 属性或成为原始 HTML。
	const renderedLinks: string[] = [];
	const withLinkPlaceholders = text.replace(
		/\[([^\]\r\n]{1,500})\]\(([^)\r\n]{1,2048})\)/g,
		(_match, label: string, rawUrl: string) => {
			const safeUrl = getSafePublicUrl(rawUrl);
			if (!safeUrl) return `${label} (${rawUrl})`;
			const index = renderedLinks.length;
			renderedLinks.push(
				`<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
			);
			return `\uE000PD2WLINK${index}\uE001`;
		}
	);
	const escaped = escapeHtml(withLinkPlaceholders);

	const lines = escaped.split(/\r?\n/);
	let output = '';
	let inList = false;

	const parseInline = (t: string) => {
		const formatted = t
			.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.*?)\*/g, '<em>$1</em>')
			.replace(/`(.*?)`/g, '<code>$1</code>');
		return formatted.replace(/\uE000PD2WLINK(\d+)\uE001/g, (_match, index: string) => {
			return renderedLinks[Number(index)] ?? '';
		});
	};

	for (const line of lines) {
		// Headers
		if (line.startsWith('#')) {
			if (inList) {
				output += '</ul>';
				inList = false;
			}
			const levelMatch = line.match(/^#+/);
			const level = levelMatch ? levelMatch[0].length : 1;
			const content = line.substring(level).trim();
			// Shift header levels: # -> h3, ## -> h4
			const tagName = 'h' + Math.min(level + 2, 6);
			output += `<${tagName}>${parseInline(content)}</${tagName}>`;
			continue;
		}

		// List items
		if (line.match(/^\s*-\s/)) {
			if (!inList) {
				output += '<ul>';
				inList = true;
			}
			const content = line.replace(/^\s*-\s/, '');
			output += `<li>${parseInline(content)}</li>`;
			continue;
		}

		// End list if needed
		if (inList && line.trim() === '') {
			output += '</ul>';
			inList = false;
			continue;
		}
		if (inList && !line.match(/^\s*-\s/) && line.trim()) {
			output += '</ul>';
			inList = false;
		}

		// Regular lines
		if (line.trim()) {
			output += `<p>${parseInline(line)}</p>`;
		}
	}
	if (inList) output += '</ul>';
	return output;
}

/**
 * 移除 HTML 标签
 */
export function stripHtmlTags(markup: string): string {
	return markup.replace(/<[^>]*>/g, '');
}

/**
 * 解析配置指引步骤
 */
export function parseGuideSteps(guide?: string): string[] {
	if (!guide) return [];
	return guide
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

/**
 * 获取指引步骤的动作类型
 */
export function getGuideAction(step: string): { type: 'copy' | 'open'; value: string } | null {
	const copyMatch = step.match(/^\s*(?:复制|copy)\s*[:：]?\s*(.+)$/i);
	if (copyMatch?.[1]) {
		return { type: 'copy', value: copyMatch[1].trim() };
	}
	const openMatch = step.match(/^\s*(?:打开|open)\s*[:：]?\s*(\S+)\s*$/i);
	if (openMatch?.[1]) {
		const value = getSafePublicUrl(openMatch[1]);
		return value ? { type: 'open', value } : null;
	}
	const urlMatch = step.match(/\b(?:mumble|https?):\/\/[^\s]+/i);
	if (urlMatch) {
		const value = getSafePublicUrl(urlMatch[0]);
		return value ? { type: 'open', value } : null;
	}
	return null;
}

/**
 * 执行指引动作
 */
export async function handleGuideAction(
	action: { type: 'copy' | 'open'; value: string },
	onMessage: (message: string) => void
): Promise<void> {
	if (action.type === 'copy') {
		try {
			await navigator.clipboard.writeText(action.value);
			onMessage(`已复制：${action.value}`);
		} catch (e) {
			console.error('Failed to copy text:', e);
			onMessage('复制失败，请手动复制。');
		}
		return;
	}

	if (action.type === 'open') {
		const safeUrl = getSafePublicUrl(action.value);
		if (!safeUrl) {
			onMessage('链接不安全，已拒绝打开。');
			return;
		}
		window.open(safeUrl, '_blank', 'noopener,noreferrer');
		onMessage(`已打开：${safeUrl}`);
	}
}
