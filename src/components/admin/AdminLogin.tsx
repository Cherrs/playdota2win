import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResponse } from '$lib/types';
import { preloadTurnstileScript } from '$lib/utils/turnstile-client';
import '$lib/styles/admin-form.css';
import { classNames } from './classNames';
import { useTurnstile } from './useTurnstile';
import styles from './AdminLogin.module.css';

interface AdminLoginProps {
	onLoginSuccess: () => void;
	initialTurnstileRequired?: boolean;
	initialTurnstileSiteKey?: string;
}

interface LoginResponse {
	authenticated?: boolean;
	requireTurnstile?: boolean;
	siteKey?: string;
	failureCount?: number;
}

export default function AdminLogin({
	onLoginSuccess,
	initialTurnstileRequired = false,
	initialTurnstileSiteKey = ''
}: AdminLoginProps) {
	const [password, setPassword] = useState('');
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);
	const [turnstileOverride, setTurnstileOverride] = useState<{
		required: boolean;
		siteKey: string;
	} | null>(null);
	const requireTurnstile = turnstileOverride?.required ?? initialTurnstileRequired;
	const turnstileSiteKey =
		turnstileOverride?.siteKey ?? (initialTurnstileRequired ? initialTurnstileSiteKey : '');
	const turnstileContainerRef = useRef<HTMLDivElement>(null);
	const loginControllerRef = useRef<AbortController | null>(null);
	const clearError = useCallback(() => setError(''), []);
	const showTurnstileError = useCallback((message: string) => setError(message), []);
	const turnstile = useTurnstile(
		turnstileContainerRef,
		requireTurnstile,
		turnstileSiteKey,
		'admin-auth',
		clearError,
		showTurnstileError
	);

	useEffect(() => {
		preloadTurnstileScript();
		return () => {
			loginControllerRef.current?.abort();
			loginControllerRef.current = null;
		};
	}, []);

	function applyTurnstileState(state: LoginResponse | undefined): void {
		if (typeof state?.requireTurnstile !== 'boolean') return;
		setTurnstileOverride({
			required: state.requireTurnstile,
			siteKey: state.requireTurnstile ? state.siteKey || '' : ''
		});
	}

	async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		if (loading || loginControllerRef.current) return;
		if (!password) {
			setError('请输入密码');
			return;
		}
		if (requireTurnstile && !turnstile.token) {
			setError('请完成人机验证');
			return;
		}

		const controller = new AbortController();
		loginControllerRef.current = controller;
		setLoading(true);
		setError('');
		try {
			const response = await fetch('/api/admin/auth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					password,
					turnstileToken: turnstile.token || undefined
				}),
				signal: controller.signal
			});
			const data = (await response.json()) as ApiResponse<LoginResponse>;
			if (controller.signal.aborted) return;
			if (response.ok && data.success && data.data?.authenticated === true) {
				onLoginSuccess();
				return;
			}

			setError(data.error || '密码错误');
			applyTurnstileState(data.data);
			if (data.data?.requireTurnstile === true || requireTurnstile) turnstile.reset();
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			setError('网络错误');
			if (requireTurnstile) turnstile.reset();
		} finally {
			if (loginControllerRef.current === controller) {
				loginControllerRef.current = null;
				setLoading(false);
			}
		}
	}

	return (
		<div className={styles.container}>
			<div className={styles.card}>
				<div className={styles.icon}>🔐</div>
				<h1>管理后台</h1>
				<p className={styles.subtitle}>请输入密码以继续</p>

				{error ? (
					<div className={styles.error} role="alert">
						<span>❌</span>
						{error}
					</div>
				) : null}

				<form className={styles.form} onSubmit={(event) => void handleLogin(event)}>
					<input
						type="password"
						className="admin-input"
						value={password}
						placeholder="输入管理密码"
						autoComplete="current-password"
						onChange={(event) => {
							setPassword(event.target.value);
							if (error) setError('');
						}}
					/>

					{requireTurnstile ? (
						<div className={styles.turnstile}>
							<div ref={turnstileContainerRef} />
							{turnstile.loadFailed ? (
								<>
									<p className={styles.turnstileHint}>人机验证暂时无法加载</p>
									<button type="button" className="admin-btn" onClick={turnstile.retry}>
										重新加载验证
									</button>
								</>
							) : turnstile.token ? (
								<p className={styles.turnstileSuccess}>✅ 验证通过</p>
							) : (
								<p className={styles.turnstileHint}>🤖 请完成人机验证</p>
							)}
						</div>
					) : null}

					<button
						type="submit"
						className={classNames('admin-btn admin-btn-primary', styles.loginButton)}
						disabled={loading || (requireTurnstile && !turnstile.token)}
					>
						{loading ? (
							<>
								<span className={styles.spinner} /> 验证中...
							</>
						) : (
							'🚀 进入后台'
						)}
					</button>
				</form>

				<p className={styles.hint}>💡 忘记密码？请联系管理员</p>
			</div>
		</div>
	);
}
