/**
 * Cloudflare Turnstile 的浏览器端显式渲染工具。
 * 动态弹窗共享一次脚本加载，但各自管理 widget 的创建与销毁。
 */

export interface TurnstileRenderOptions {
	sitekey: string;
	theme?: 'light' | 'dark' | 'auto';
	action?: string;
	cData?: string;
	callback?: (token: string) => void;
	'expired-callback'?: () => void;
	'error-callback'?: (errorCode?: string) => boolean | void;
}

export interface TurnstileApi {
	render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
	remove: (widgetId: string) => void;
	reset: (widgetId: string) => void;
}

declare global {
	interface Window {
		turnstile?: TurnstileApi;
	}
}

export interface TurnstileState {
	required: boolean;
	siteKey: string;
	token: string;
	widgetId: string | null;
	loaded: boolean;
}

const TURNSTILE_SCRIPT_SELECTOR = 'script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]';
const TURNSTILE_SCRIPT_URL =
	'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TURNSTILE_LOAD_TIMEOUT_MS = 15_000;
const TURNSTILE_READY_POLL_MS = 50;

let turnstileLoadPromise: Promise<TurnstileApi> | null = null;

/** 创建初始 Turnstile 状态。 */
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
 * 加载 Turnstile API。并发调用共享同一个 Promise；已有脚本仍在加载时继续等待，
 * 不会把“存在 script 标签”误判为 API 已就绪。
 */
export function loadTurnstileScript(): Promise<TurnstileApi> {
	if (typeof window === 'undefined' || typeof document === 'undefined') {
		return Promise.reject(new Error('Turnstile is only available in the browser'));
	}
	if (window.turnstile) return Promise.resolve(window.turnstile);
	if (turnstileLoadPromise) return turnstileLoadPromise;

	const promise = new Promise<TurnstileApi>((resolve, reject) => {
		let script = document.querySelector<HTMLScriptElement>(TURNSTILE_SCRIPT_SELECTOR);
		let appendScript = false;
		let settled = false;
		const timers: { timeoutId?: number; pollId?: number } = {};

		const cleanup = () => {
			if (timers.timeoutId !== undefined) window.clearTimeout(timers.timeoutId);
			if (timers.pollId !== undefined) window.clearInterval(timers.pollId);
			script?.removeEventListener('load', handleReady);
			script?.removeEventListener('error', handleError);
		};

		const succeed = () => {
			if (settled || !window.turnstile) return;
			settled = true;
			cleanup();
			resolve(window.turnstile);
		};

		function handleReady() {
			succeed();
		}

		function handleError() {
			if (settled) return;
			settled = true;
			cleanup();
			script?.remove();
			reject(new Error('Failed to load Turnstile'));
		}

		if (!script) {
			script = document.createElement('script');
			script.src = TURNSTILE_SCRIPT_URL;
			script.async = true;
			script.defer = true;
			script.dataset.playdota2winTurnstile = 'true';
			appendScript = true;
		}

		script.addEventListener('load', handleReady);
		script.addEventListener('error', handleError);
		if (appendScript) document.head.appendChild(script);
		timers.pollId = window.setInterval(succeed, TURNSTILE_READY_POLL_MS);
		timers.timeoutId = window.setTimeout(handleError, TURNSTILE_LOAD_TIMEOUT_MS);
		succeed();
	});

	turnstileLoadPromise = promise;
	void promise.then(
		() => {
			if (turnstileLoadPromise === promise) turnstileLoadPromise = null;
		},
		() => {
			if (turnstileLoadPromise === promise) turnstileLoadPromise = null;
		}
	);
	return promise;
}

/**
 * 页面进入时静默预加载 Turnstile。预加载失败不会提前打扰用户；真正需要验证时，
 * loadTurnstileScript() 会重新发起加载并由调用方展示错误状态。
 */
export function preloadTurnstileScript(): void {
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	void loadTurnstileScript().catch(() => undefined);
}

/** 在指定元素中创建一个 Turnstile widget。 */
export function renderTurnstile(
	container: HTMLElement,
	siteKey: string,
	callbacks: {
		onSuccess: (token: string) => void;
		onExpired: () => void;
		onError: (message: string) => void;
	},
	flow: 'admin-auth' | 'download-auth' = 'download-auth'
): string | null {
	if (!window.turnstile || !siteKey || !container.isConnected) return null;

	container.replaceChildren();
	return window.turnstile.render(container, {
		sitekey: siteKey,
		theme: 'light',
		action: 'turnstile-spin-v1',
		cData: flow,
		callback: callbacks.onSuccess,
		'expired-callback': callbacks.onExpired,
		'error-callback': () => {
			callbacks.onError('人机验证加载失败，请重试');
			return true;
		}
	});
}

/** 重置现有 widget。 */
export function resetTurnstile(widgetId: string | null): void {
	if (!widgetId || !window.turnstile) return;
	try {
		window.turnstile.reset(widgetId);
	} catch {
		/* widget 可能已经由 Turnstile 清理 */
	}
}

/** 销毁现有 widget 及其 DOM。 */
export function removeTurnstile(widgetId: string | null): void {
	if (!widgetId || !window.turnstile) return;
	try {
		window.turnstile.remove(widgetId);
	} catch {
		/* widget 可能已经被销毁 */
	}
}
