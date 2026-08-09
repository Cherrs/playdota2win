import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
	loadTurnstileScript,
	removeTurnstile,
	renderTurnstile,
	resetTurnstile
} from '$lib/utils/turnstile-client';

interface TurnstileController {
	token: string;
	loadFailed: boolean;
	retry: () => void;
	reset: () => void;
}

export function useTurnstile(
	containerRef: RefObject<HTMLDivElement | null>,
	required: boolean,
	siteKey: string,
	flow: 'admin-auth' | 'download-auth' = 'admin-auth',
	onSuccess?: () => void,
	onError?: (message: string) => void
): TurnstileController {
	const widgetIdRef = useRef<string | null>(null);
	const generationRef = useRef(0);
	const [retryNonce, setRetryNonce] = useState(0);
	const widgetKey = `${flow}:${siteKey}:${retryNonce}`;
	const [tokenState, setTokenState] = useState({ key: '', token: '' });
	const [failedKey, setFailedKey] = useState('');
	const token = tokenState.key === widgetKey ? tokenState.token : '';
	const loadFailed = required && (!siteKey || failedKey === widgetKey);

	const reset = useCallback(() => {
		resetTurnstile(widgetIdRef.current);
		setTokenState({ key: widgetKey, token: '' });
	}, [widgetKey]);

	const retry = useCallback(() => {
		setFailedKey('');
		setRetryNonce((value) => value + 1);
	}, []);

	useEffect(() => {
		const generation = ++generationRef.current;
		let cancelled = false;
		removeTurnstile(widgetIdRef.current);
		widgetIdRef.current = null;
		if (!required || !siteKey || !containerRef.current) return;

		void (async () => {
			try {
				await loadTurnstileScript();
				if (cancelled || generation !== generationRef.current || !containerRef.current) return;

				const widgetId = renderTurnstile(
					containerRef.current,
					siteKey,
					{
						onSuccess: (nextToken) => {
							if (!cancelled && generation === generationRef.current) {
								setTokenState({ key: widgetKey, token: nextToken });
								onSuccess?.();
							}
						},
						onExpired: () => {
							if (!cancelled && generation === generationRef.current) {
								setTokenState({ key: widgetKey, token: '' });
							}
						},
						onError: (message) => {
							if (!cancelled && generation === generationRef.current) {
								setTokenState({ key: widgetKey, token: '' });
								setFailedKey(widgetKey);
								onError?.(message);
							}
						}
					},
					flow
				);
				if (!widgetId) throw new Error('Failed to render Turnstile');
				if (cancelled || generation !== generationRef.current) {
					removeTurnstile(widgetId);
					return;
				}
				widgetIdRef.current = widgetId;
			} catch {
				if (!cancelled && generation === generationRef.current) setFailedKey(widgetKey);
			}
		})();

		return () => {
			cancelled = true;
			if (generation === generationRef.current) generationRef.current += 1;
			removeTurnstile(widgetIdRef.current);
			widgetIdRef.current = null;
		};
	}, [containerRef, flow, onError, onSuccess, required, retryNonce, siteKey, widgetKey]);

	return { token, loadFailed, retry, reset };
}
