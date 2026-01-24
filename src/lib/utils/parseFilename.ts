import type { Platform } from '$lib/types';

/**
 * 从文件名中解析出的信息
 */
export interface ParsedFilenameInfo {
	version?: string;
	platform?: Platform;
	filename?: string;
}

/**
 * 版本号匹配规则（按优先级排序）
 */
const VERSION_PATTERNS = [
	// v1.2.3 或 v1.2.3-beta
	/(?:^|[^a-zA-Z0-9])(v\d+(?:\.\d+)*(?:-\w+)?)(?:[^a-zA-Z0-9]|$)/i,
	// 1.2.3 或 1.2.3-beta（不带v前缀）
	/(?:^|[^a-zA-Z0-9])(\d+(?:\.\d+)+(?:-\w+)?)(?:[^a-zA-Z0-9]|$)/,
	// 日期格式：2024.01.25 或 2024-01-25
	/(?:^|[^a-zA-Z0-9])(20\d{2}[.-]\d{2}[.-]\d{2})(?:[^a-zA-Z0-9]|$)/
];

/**
 * 平台匹配规则
 */
const PLATFORM_PATTERNS: Record<Platform, RegExp[]> = {
	windows: [/(?:^|[^a-zA-Z0-9])(windows?|win|w32|w64|x64|amd64)(?:[^a-zA-Z0-9]|$)/i],
	macos: [/(?:^|[^a-zA-Z0-9])(macos|mac|osx|darwin)(?:[^a-zA-Z0-9]|$)/i],
	linux: [/(?:^|[^a-zA-Z0-9])(linux|lin|ubuntu|debian|fedora|centos)(?:[^a-zA-Z0-9]|$)/i]
};

/**
 * 从URL中提取文件名
 */
export function extractFilenameFromUrl(url: string): string | null {
	try {
		// 移除查询参数和fragment
		const urlWithoutQuery = url.split(/[?#]/)[0];
		// URL解码
		const decoded = decodeURIComponent(urlWithoutQuery);
		// 获取最后一个路径段作为文件名
		const segments = decoded.split('/');
		const filename = segments[segments.length - 1];

		return filename || null;
	} catch {
		return null;
	}
}

/**
 * 从文件名中提取版本号
 */
export function extractVersion(filename: string): string | undefined {
	for (const pattern of VERSION_PATTERNS) {
		const match = filename.match(pattern);
		if (match) {
			return match[1];
		}
	}
	return undefined;
}

/**
 * 从文件名中提取平台信息
 */
export function extractPlatform(filename: string): Platform | undefined {
	const lowerFilename = filename.toLowerCase();

	for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
		for (const pattern of patterns) {
			if (pattern.test(lowerFilename)) {
				return platform as Platform;
			}
		}
	}

	return undefined;
}

/**
 * 解析文件名，提取版本号、平台和清理后的文件名
 */
export function parseFilename(filename: string): ParsedFilenameInfo {
	const result: ParsedFilenameInfo = {};

	// 提取版本号
	result.version = extractVersion(filename);

	// 提取平台
	result.platform = extractPlatform(filename);

	// 清理文件名（移除扩展名，但保留平台和版本信息用于展示）
	let cleanFilename = filename;

	// 移除常见文件扩展名
	cleanFilename = cleanFilename.replace(
		/\.(exe|dmg|tar\.gz|zip|rar|7z|deb|rpm|pkg|appimage)$/i,
		''
	);

	result.filename = cleanFilename;

	return result;
}

/**
 * 从URL中解析完整的文件信息
 */
export function parseFileFromUrl(url: string): ParsedFilenameInfo {
	const filename = extractFilenameFromUrl(url);
	if (!filename) {
		return {};
	}

	return parseFilename(filename);
}
