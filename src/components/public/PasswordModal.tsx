import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Platform, PublicDownloadItem } from '$lib/types';
import {
	loadTurnstileScript,
	removeTurnstile,
	renderTurnstile,
	resetTurnstile
} from '$lib/utils/turnstile-client';
import { usePublicDialog } from '../../hooks/public-dialog';
import styles from './PasswordModal.module.css';

interface PasswordModalProps {
	item: PublicDownloadItem;
	purpose?: 'download' | 'guide';
	requireTurnstile: boolean;
	turnstileSiteKey: string;
	allowR2Download?: boolean;
	onClose: () => void;
	onSubmit: (
		password: string,
		turnstileToken: string,
		downloadSource: 'auto' | 'r2',
		signal: AbortSignal
	) => Promise<void>;
}

function getPlatformLabel(platform: Platform): string {
	switch (platform) {
		case 'windows':
			return 'Windows';
		case 'macos':
			return 'macOS';
		case 'linux':
			return 'Linux';
		default:
			return platform;
	}
}

export default function PasswordModal({
	item,
	purpose = 'download',
	requireTurnstile,
	turnstileSiteKey,
	allowR2Download = false,
	onClose,
	onSubmit
}: PasswordModalProps) {
	const [password, setPassword] = useState('');
	const [error, setError] = useState('');
	const [downloading, setDownloading] = useState(false);
	const [activeDownloadSource, setActiveDownloadSource] = useState<'auto' | 'r2' | null>(null);
	const [turnstileVerification, setTurnstileVerification] = useState<{
		key: string;
		token: string;
	} | null>(null);
	const [turnstileFailedKey, setTurnstileFailedKey] = useState<string | null>(null);
	const [turnstileRetryNonce, setTurnstileRetryNonce] = useState(0);
	const dialogRef = useRef<HTMLDivElement>(null);
	const passwordInputRef = useRef<HTMLInputElement>(null);
	const turnstileContainerRef = useRef<HTMLDivElement>(null);
	const turnstileWidgetIdRef = useRef<string | null>(null);
	const turnstileGenerationRef = useRef(0);
	const submitGenerationRef = useRef(0);
	const activeRequestControllerRef = useRef<AbortController | null>(null);
	const titleId = useId();
	const subtitleId = useId();
	const errorId = useId();
	const turnstileKey = `${requireTurnstile ? 'required' : 'optional'}:${turnstileSiteKey}:${turnstileRetryNonce}`;
	const turnstileToken =
		turnstileVerification?.key === turnstileKey ? turnstileVerification.token : '';
	const turnstileLoadFailed =
		(requireTurnstile && !turnstileSiteKey) || turnstileFailedKey === turnstileKey;

	const requestClose = useCallback(() => {
		submitGenerationRef.current += 1;
		activeRequestControllerRef.current?.abort();
		activeRequestControllerRef.current = null;
		setDownloading(false);
		setActiveDownloadSource(null);
		onClose();
	}, [onClose]);

	const handleDialogKeyDown = usePublicDialog({
		dialogRef,
		initialFocusRef: passwordInputRef,
		onClose: requestClose
	});

	const focusPassword = useCallback((select = false) => {
		window.requestAnimationFrame(() => {
			if (!passwordInputRef.current?.isConnected) return;
			passwordInputRef.current.focus();
			if (select) passwordInputRef.current.select();
		});
	}, []);

	useEffect(() => {
		return () => {
			submitGenerationRef.current += 1;
			activeRequestControllerRef.current?.abort();
			activeRequestControllerRef.current = null;
		};
	}, []);

	useEffect(() => {
		const container = turnstileContainerRef.current;
		const generation = ++turnstileGenerationRef.current;
		let cancelled = false;

		removeTurnstile(turnstileWidgetIdRef.current);
		turnstileWidgetIdRef.current = null;
		if (!requireTurnstile || !turnstileSiteKey || !container) return;

		const isCurrent = () =>
			!cancelled && generation === turnstileGenerationRef.current && container.isConnected;

		void (async () => {
			try {
				await loadTurnstileScript();
				await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
				if (!isCurrent()) return;

				const widgetId = renderTurnstile(container, turnstileSiteKey, {
					onSuccess: (token) => {
						if (!isCurrent()) return;
						setTurnstileVerification({ key: turnstileKey, token });
						setError('');
					},
					onExpired: () => {
						if (isCurrent()) setTurnstileVerification(null);
					},
					onError: (message) => {
						if (!isCurrent()) return;
						setTurnstileVerification(null);
						setError(message);
					}
				});
				if (!widgetId) throw new Error('Failed to render Turnstile');
				if (!isCurrent()) {
					removeTurnstile(widgetId);
					return;
				}
				turnstileWidgetIdRef.current = widgetId;
			} catch {
				if (isCurrent()) setTurnstileFailedKey(turnstileKey);
			}
		})();

		return () => {
			cancelled = true;
			if (turnstileGenerationRef.current === generation) {
				turnstileGenerationRef.current += 1;
			}
			removeTurnstile(turnstileWidgetIdRef.current);
			turnstileWidgetIdRef.current = null;
		};
	}, [requireTurnstile, turnstileKey, turnstileSiteKey]);

	const handleSubmit = async (downloadSource: 'auto' | 'r2' = 'auto') => {
		if (downloading) return;
		if (!password.trim()) {
			setError('请输入下载密码');
			focusPassword();
			return;
		}
		if (requireTurnstile && !turnstileToken) {
			setError('请完成人机验证');
			return;
		}

		setDownloading(true);
		setActiveDownloadSource(downloadSource);
		setError('');
		const generation = ++submitGenerationRef.current;
		const controller = new AbortController();
		activeRequestControllerRef.current = controller;
		let refocusPassword = false;

		try {
			await onSubmit(password, turnstileToken, downloadSource, controller.signal);
		} catch (caught) {
			if (controller.signal.aborted || generation !== submitGenerationRef.current) return;
			setError(caught instanceof Error ? caught.message : '下载失败');
			if (requireTurnstile && turnstileWidgetIdRef.current) {
				resetTurnstile(turnstileWidgetIdRef.current);
				setTurnstileVerification(null);
			}
			refocusPassword = true;
		} finally {
			if (generation === submitGenerationRef.current) {
				activeRequestControllerRef.current = null;
				setDownloading(false);
				setActiveDownloadSource(null);
			}
		}
		if (refocusPassword && generation === submitGenerationRef.current) focusPassword(true);
	};

	return (
		<div
			className={styles['modal-backdrop']}
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			aria-describedby={subtitleId}
		>
			<div className={styles['modal-scrim']} onClick={requestClose} aria-hidden="true" />
			<div
				className={styles['modal-card']}
				ref={dialogRef}
				tabIndex={-1}
				onKeyDown={handleDialogKeyDown}
			>
				<div className={styles['modal-header']}>
					<h3 id={titleId}>{purpose === 'guide' ? '🔐 验证后查看配置指引' : '🔐 输入下载密码'}</h3>
					<button
						className={styles['modal-close']}
						onClick={requestClose}
						type="button"
						aria-label="关闭密码验证"
					>
						×
					</button>
				</div>
				<p className={styles['modal-subtitle']} id={subtitleId}>
					{item.title || `${getPlatformLabel(item.platform)} 版本`}
				</p>
				<div className={styles['auth-form']}>
					<input
						type="password"
						className={styles['auth-input']}
						placeholder="请输入下载密码"
						aria-label="下载密码"
						autoComplete="current-password"
						value={password}
						ref={passwordInputRef}
						disabled={downloading}
						aria-invalid={Boolean(error)}
						aria-describedby={error ? errorId : undefined}
						onChange={(event) => {
							setPassword(event.target.value);
							if (error) setError('');
						}}
						onKeyDown={(event) => {
							if (event.key === 'Enter') void handleSubmit('auto');
						}}
					/>

					{requireTurnstile ? (
						<div className={styles['turnstile-wrapper']}>
							<div ref={turnstileContainerRef} />
							{turnstileLoadFailed ? (
								<>
									<p className={styles['auth-error']} role="alert">
										人机验证暂时无法加载
									</p>
									<button
										className={styles['turnstile-retry']}
										type="button"
										onClick={() => {
											setTurnstileFailedKey(null);
											setError('');
											setTurnstileRetryNonce((value) => value + 1);
										}}
									>
										重新加载验证
									</button>
								</>
							) : !turnstileToken ? (
								<p className={styles['turnstile-hint']}>🤖 请完成人机验证</p>
							) : (
								<p className={styles['turnstile-success']}>✅ 验证通过</p>
							)}
						</div>
					) : null}

					{error ? (
						<p className={styles['auth-error']} id={errorId} role="alert" aria-live="assertive">
							{error}
						</p>
					) : null}
				</div>
				<div className={styles['modal-actions']}>
					<button
						type="button"
						className={styles['modal-btn']}
						aria-busy={downloading && activeDownloadSource === 'auto'}
						onClick={() => void handleSubmit('auto')}
						disabled={downloading || (requireTurnstile && !turnstileToken)}
					>
						{downloading && activeDownloadSource === 'auto' ? (
							<>
								<span className={styles.spinner} aria-hidden="true" />
								{purpose === 'guide' ? '正在验证...' : '正在检查下载源...'}
							</>
						) : purpose === 'guide' ? (
							'验证并查看 →'
						) : (
							'开始下载 →'
						)}
					</button>

					{allowR2Download && password.trim() ? (
						<button
							type="button"
							className={`${styles['modal-btn']} ${styles['backup-btn']}`}
							aria-busy={downloading && activeDownloadSource === 'r2'}
							onClick={() => void handleSubmit('r2')}
							disabled={downloading || (requireTurnstile && !turnstileToken)}
						>
							{downloading && activeDownloadSource === 'r2' ? (
								<>
									<span className={styles.spinner} aria-hidden="true" />
									正在连接 R2...
								</>
							) : (
								'备用下载（R2）'
							)}
						</button>
					) : null}
				</div>
			</div>
		</div>
	);
}
