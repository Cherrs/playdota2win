/**
 * 简单的 Markdown 解析工具
 */

/**
 * 解析简单的 Markdown 到 HTML
 */
export function parseMarkdown(text: string): string {
	if (!text) return '';

	// Escape HTML
	const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

	const lines = escaped.split(/\r?\n/);
	let output = '';
	let inList = false;

	const parseInline = (t: string) =>
		t
			.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.*?)\*/g, '<em>$1</em>')
			.replace(/`(.*?)`/g, '<code>$1</code>')
			.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

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
		return { type: 'open', value: openMatch[1].trim() };
	}
	const urlMatch = step.match(/\b(?:mumble|https?):\/\/[^\s]+/i);
	if (urlMatch) {
		return { type: 'open', value: urlMatch[0] };
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
		window.open(action.value, '_blank', 'noopener');
		onMessage(`已打开：${action.value}`);
	}
}
