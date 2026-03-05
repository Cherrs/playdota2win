export const CHAT_MESSAGE_KEY_PREFIX = 'chat:message:';
export const DEFAULT_CHAT_NICKNAME = '游客';
export const MAX_CHAT_MESSAGE_LENGTH = 500;
export const MAX_CHAT_NICKNAME_LENGTH = 24;
export const CHAT_RATE_LIMIT_WINDOW_MS = 10_000;
export const CHAT_RATE_LIMIT_MAX_MESSAGES = 6;

function stripControlChars(value: string): string {
	let result = '';
	for (const char of value) {
		const code = char.charCodeAt(0);
		if (code < 32 || code === 127) {
			continue;
		}
		result += char;
	}
	return result;
}

export function normalizeText(value: string): string {
	return stripControlChars(value).replace(/\s+/g, ' ').trim();
}

export function normalizeNickname(value: string): string {
	return normalizeText(value).slice(0, MAX_CHAT_NICKNAME_LENGTH);
}
