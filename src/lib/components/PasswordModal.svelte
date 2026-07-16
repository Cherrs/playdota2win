<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import type { Platform, PublicDownloadItem } from '$lib/types';
	import { trapFocus } from '$lib/utils/a11y';
	import {
		loadTurnstileScript,
		removeTurnstile,
		renderTurnstile,
		resetTurnstile
	} from '$lib/utils/turnstile-client';

	interface Props {
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

	let {
		item,
		purpose = 'download',
		requireTurnstile,
		turnstileSiteKey,
		allowR2Download = false,
		onClose,
		onSubmit
	}: Props = $props();

	let password = $state('');
	let error = $state('');
	let downloading = $state(false);
	let activeDownloadSource = $state<'auto' | 'r2' | null>(null);
	let turnstileToken = $state('');
	let turnstileLoadFailed = $state(false);
	let turnstileRetryNonce = $state(0);
	let dialogRef = $state<HTMLDivElement | null>(null);
	let closeButtonRef = $state<HTMLButtonElement | null>(null);
	let passwordInputRef = $state<HTMLInputElement | null>(null);
	let turnstileContainerRef = $state<HTMLDivElement | null>(null);
	let turnstileWidgetId: string | null = null;
	let turnstileGeneration = 0;
	let submitGeneration = 0;
	let activeRequestController: AbortController | null = null;
	let lastFocusedElement: HTMLElement | null = null;
	const titleId = crypto.randomUUID();
	const errorId = crypto.randomUUID();

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

	function destroyTurnstileWidget() {
		const widgetId = turnstileWidgetId;
		turnstileWidgetId = null;
		removeTurnstile(widgetId);
	}

	async function focusPassword(select = false) {
		await tick();
		if (!passwordInputRef?.isConnected) return;
		passwordInputRef.focus();
		if (select) passwordInputRef.select();
	}

	function handlePasswordInput() {
		if (error) error = '';
	}

	function retryTurnstile() {
		turnstileLoadFailed = false;
		error = '';
		turnstileRetryNonce += 1;
	}

	function requestClose() {
		submitGeneration += 1;
		activeRequestController?.abort();
		activeRequestController = null;
		downloading = false;
		activeDownloadSource = null;
		onClose();
	}

	async function handleSubmit(downloadSource: 'auto' | 'r2' = 'auto') {
		if (downloading) return;
		if (!password.trim()) {
			error = '请输入下载密码';
			await focusPassword();
			return;
		}

		if (requireTurnstile && !turnstileToken) {
			error = '请完成人机验证';
			return;
		}

		downloading = true;
		activeDownloadSource = downloadSource;
		error = '';
		const generation = ++submitGeneration;
		const controller = new AbortController();
		activeRequestController = controller;
		let refocusPassword = false;

		try {
			await onSubmit(password, turnstileToken, downloadSource, controller.signal);
		} catch (e) {
			if (controller.signal.aborted || generation !== submitGeneration) return;
			error = e instanceof Error ? e.message : '下载失败';
			if (requireTurnstile && turnstileWidgetId) {
				resetTurnstile(turnstileWidgetId);
				turnstileToken = '';
			}
			refocusPassword = true;
		} finally {
			if (generation === submitGeneration) {
				activeRequestController = null;
				downloading = false;
				activeDownloadSource = null;
			}
		}
		if (refocusPassword && generation === submitGeneration) await focusPassword(true);
	}

	onDestroy(() => {
		submitGeneration += 1;
		activeRequestController?.abort();
		activeRequestController = null;
	});

	$effect(() => {
		const required = requireTurnstile;
		const siteKey = turnstileSiteKey;
		const container = turnstileContainerRef;
		const retryNonce = turnstileRetryNonce;
		const generation = ++turnstileGeneration;
		let cancelled = false;

		destroyTurnstileWidget();
		turnstileToken = '';
		turnstileLoadFailed = required && !siteKey;
		if (!required || !siteKey || !container) return;

		const isCurrent = () =>
			!cancelled &&
			generation === turnstileGeneration &&
			retryNonce === turnstileRetryNonce &&
			container.isConnected;

		void (async () => {
			try {
				await loadTurnstileScript();
				// 先让本次提交的错误文案完成渲染，再启动 Turnstile。
				await tick();
				if (!isCurrent()) return;

				const widgetId = renderTurnstile(container, siteKey, {
					onSuccess: (token: string) => {
						if (!isCurrent()) return;
						turnstileToken = token;
						error = '';
					},
					onExpired: () => {
						if (isCurrent()) turnstileToken = '';
					},
					onError: (message: string) => {
						if (!isCurrent()) return;
						turnstileToken = '';
						error = message;
					}
				});

				if (!widgetId) throw new Error('Failed to render Turnstile');
				if (!isCurrent()) {
					removeTurnstile(widgetId);
					return;
				}
				turnstileWidgetId = widgetId;
			} catch {
				if (isCurrent()) turnstileLoadFailed = true;
			}
		})();

		return () => {
			cancelled = true;
			if (turnstileGeneration === generation) turnstileGeneration += 1;
			destroyTurnstileWidget();
			turnstileToken = '';
		};
	});

	$effect(() => {
		lastFocusedElement =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		void focusPassword();
		const handleKeydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') requestClose();
		};
		document.addEventListener('keydown', handleKeydown);
		return () => {
			document.removeEventListener('keydown', handleKeydown);
			lastFocusedElement?.focus();
		};
	});
</script>

<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={titleId}>
	<button type="button" class="modal-scrim" onclick={requestClose} aria-label="关闭密码验证"
	></button>
	<div class="modal-card" bind:this={dialogRef} use:trapFocus tabindex="-1">
		<div class="modal-header">
			<h3 id={titleId}>{purpose === 'guide' ? '🔐 验证后查看配置指引' : '🔐 输入下载密码'}</h3>
			<button
				class="modal-close"
				onclick={requestClose}
				type="button"
				bind:this={closeButtonRef}
				aria-label="关闭密码验证"
			>
				×
			</button>
		</div>
		<p class="modal-subtitle">
			{item.title || `${getPlatformLabel(item.platform)} 版本`}
		</p>
		<div class="auth-form">
			<input
				type="password"
				class="auth-input"
				placeholder="请输入下载密码"
				aria-label="下载密码"
				autocomplete="current-password"
				bind:value={password}
				bind:this={passwordInputRef}
				disabled={downloading}
				aria-invalid={Boolean(error)}
				aria-describedby={error ? errorId : undefined}
				oninput={handlePasswordInput}
				onkeydown={(e) => e.key === 'Enter' && handleSubmit('auto')}
			/>

			{#if requireTurnstile}
				<div class="turnstile-wrapper">
					<div bind:this={turnstileContainerRef}></div>
					{#if turnstileLoadFailed}
						<p class="auth-error" role="alert">人机验证暂时无法加载</p>
						<button class="turnstile-retry" type="button" onclick={retryTurnstile}>
							重新加载验证
						</button>
					{:else if !turnstileToken}
						<p class="turnstile-hint">🤖 请完成人机验证</p>
					{:else}
						<p class="turnstile-success">✅ 验证通过</p>
					{/if}
				</div>
			{/if}

			{#if error}
				<p class="auth-error" id={errorId} role="alert" aria-live="assertive">
					{error}
				</p>
			{/if}
		</div>
		<div class="modal-actions">
			<button
				type="button"
				class="modal-btn"
				aria-busy={downloading && activeDownloadSource === 'auto'}
				onclick={() => handleSubmit('auto')}
				disabled={downloading || (requireTurnstile && !turnstileToken)}
			>
				{#if downloading && activeDownloadSource === 'auto'}
					<span class="spinner" aria-hidden="true"></span>
					{purpose === 'guide' ? '正在验证...' : '正在检查下载源...'}
				{:else}
					{purpose === 'guide' ? '验证并查看 →' : '开始下载 →'}
				{/if}
			</button>

			{#if allowR2Download && password.trim()}
				<button
					type="button"
					class="modal-btn backup-btn"
					aria-busy={downloading && activeDownloadSource === 'r2'}
					onclick={() => handleSubmit('r2')}
					disabled={downloading || (requireTurnstile && !turnstileToken)}
				>
					{#if downloading && activeDownloadSource === 'r2'}
						<span class="spinner" aria-hidden="true"></span>
						正在连接 R2...
					{:else}
						备用下载（R2）
					{/if}
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		background: rgba(17, 8, 28, 0.35);
		backdrop-filter: blur(6px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10;
		padding: 1.5rem;
	}

	.modal-scrim {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		border: none;
		background: transparent;
		cursor: pointer;
	}

	.modal-card {
		box-sizing: border-box;
		width: 100%;
		max-width: 420px;
		background: rgba(255, 255, 255, 0.95);
		border-radius: 20px;
		padding: 1.5rem;
		box-shadow: 0 20px 50px rgba(107, 76, 154, 0.25);
		display: flex;
		flex-direction: column;
		gap: 1rem;
		position: relative;
		z-index: 1;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.modal-header h3 {
		margin: 0;
		font-family: 'Fredoka', sans-serif;
		color: #6b4c9a;
		font-size: 1.2rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.modal-close {
		border: none;
		background: rgba(107, 76, 154, 0.1);
		color: #6b4c9a;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		cursor: pointer;
		font-size: 1.2rem;
		transition: all 0.3s ease;
	}

	.modal-close:hover {
		background: rgba(107, 76, 154, 0.2);
		transform: translateY(-1px);
	}

	.modal-close:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		transform: none;
	}

	.modal-subtitle {
		margin: 0;
		color: #8b7ba8;
		font-size: 0.95rem;
	}

	.auth-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.auth-input {
		width: 100%;
		padding: 0.9rem 1.2rem;
		border: 2px solid #e8e0f0;
		border-radius: 14px;
		font-size: 1rem;
		font-family: inherit;
		background: rgba(255, 255, 255, 0.8);
		transition: all 0.3s ease;
		outline: none;
		box-sizing: border-box;
	}

	.auth-input:focus {
		border-color: #b8a5d0;
		box-shadow: 0 0 0 4px rgba(107, 76, 154, 0.1);
	}

	.auth-input::placeholder {
		color: #b8a5d0;
	}

	.auth-error {
		color: #ff6b9d;
		font-size: 0.9rem;
		margin: 0;
		text-align: left;
	}

	.turnstile-wrapper {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1rem;
		background: rgba(107, 76, 154, 0.05);
		border-radius: 12px;
		border: 2px dashed #e6e0f0;
	}

	.turnstile-hint {
		margin: 0;
		font-size: 0.85rem;
		color: #8b7ba8;
	}

	.turnstile-success {
		margin: 0;
		font-size: 0.85rem;
		color: #38ef7d;
		font-weight: 600;
	}

	.turnstile-retry {
		border: 1px solid rgba(107, 76, 154, 0.25);
		border-radius: 10px;
		padding: 0.5rem 0.85rem;
		background: white;
		color: #6b4c9a;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}

	.modal-btn {
		border: none;
		border-radius: 14px;
		padding: 0.8rem 1rem;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		transition:
			transform 0.3s ease,
			box-shadow 0.3s ease;
	}

	.modal-actions {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.backup-btn {
		background: rgba(107, 76, 154, 0.08);
		border: 2px solid rgba(107, 76, 154, 0.2);
		color: #6b4c9a;
	}

	.backup-btn:hover {
		box-shadow: 0 10px 25px rgba(107, 76, 154, 0.18);
	}

	.backup-btn .spinner {
		border-color: rgba(107, 76, 154, 0.25);
		border-top-color: #6b4c9a;
	}

	.modal-btn:hover {
		transform: translateY(-2px);
		box-shadow: 0 10px 25px rgba(102, 126, 234, 0.35);
	}

	.modal-btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 480px) {
		.modal-backdrop {
			padding: 0.5rem;
		}

		.modal-card {
			padding: 1rem;
			max-height: calc(100dvh - 1rem);
			overflow-y: auto;
		}

		.turnstile-wrapper {
			padding: 0.75rem 0.25rem;
			overflow-x: auto;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.modal-close,
		.modal-btn {
			transition: none;
		}

		.modal-close:hover,
		.modal-btn:hover {
			transform: none;
			box-shadow: none;
		}

		.spinner {
			animation: none;
		}
	}
</style>
