/**
 * Turnstile 前端客户端工具
 * 用于在浏览器端加载、渲染和管理 Cloudflare Turnstile 小部件
 */

declare global {
	interface Window {
		turnstile: {
			render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
			remove: (widgetId: string) => void;
			reset: (widgetId: string) => void;
		};
		onTurnstileLoad?: () => void;
	}
}

export interface TurnstileRenderOptions {
	sitekey: string;
	theme?: 'light' | 'dark' | 'auto';
	callback?: (token: string) => void;
	'expired-callback'?: () => void;
	'error-callback'?: () => void;
}

export interface TurnstileState {
	required: boolean;
	siteKey: string;
	token: string;
	widgetId: string | null;
	loaded: boolean;
}

/**
 * 创建初始 Turnstile 状态
 */
export function createTurnstileState(): TurnstileState {
	return {
		required: false,
		siteKey: '',
		token: '',
		widgetId: null,
		loaded: false
	};
}

/**
 * 加载 Turnstile 脚本
 */
export function loadTurnstileScript(onLoad: () => void): void {
	// 检查是否已加载
	if (window.turnstile || document.querySelector('script[src*="turnstile"]')) {
		onLoad();
		return;
	}

	const script = document.createElement('script');
	script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad';
	script.async = true;

	window.onTurnstileLoad = () => {
		onLoad();
	};

	document.head.appendChild(script);
}

/**
 * 渲染 Turnstile 小部件
 */
export function renderTurnstile(
	containerId: string,
	siteKey: string,
	callbacks: {
		onSuccess: (token: string) => void;
		onExpired: () => void;
		onError: (message: string) => void;
	},
	currentWidgetId: string | null
): string | null {
	if (!window.turnstile || !siteKey) {
		return null;
	}

	const container = document.getElementById(containerId);
	if (!container) {
		return null;
	}

	// 清理旧的 widget
	if (currentWidgetId) {
		try {
			window.turnstile.remove(currentWidgetId);
		} catch {
			/* ignore */
		}
	}

	// 清空容器
	container.innerHTML = '';

	// 渲染新的 widget
	const widgetId = window.turnstile.render(container, {
		sitekey: siteKey,
		theme: 'light',
		callback: callbacks.onSuccess,
		'expired-callback': callbacks.onExpired,
		'error-callback': () => {
			callbacks.onError('人机验证加载失败，请刷新页面重试');
		}
	});

	return widgetId;
}

/**
 * 重置 Turnstile 小部件
 */
export function resetTurnstile(widgetId: string | null): void {
	if (widgetId && window.turnstile) {
		try {
			window.turnstile.reset(widgetId);
		} catch {
			/* ignore */
		}
	}
}
