<script lang="ts">
	import type { DownloadItem, Platform } from '$lib/types';
	import { trapFocus, focusFirstElement } from '$lib/utils/a11y';
	import {
		loadTurnstileScript,
		renderTurnstile,
		resetTurnstile
	} from '$lib/utils/turnstile-client';

	interface Props {
		item: DownloadItem;
		requireTurnstile: boolean;
		turnstileSiteKey: string;
		onClose: () => void;
		onSubmit: (password: string, turnstileToken: string) => Promise<void>;
	}

	let { item, requireTurnstile, turnstileSiteKey, onClose, onSubmit }: Props = $props();

	let password = $state('');
	let error = $state('');
	let downloading = $state(false);
	let turnstileToken = $state('');
	let turnstileWidgetId = $state<string | null>(null);
	let turnstileLoaded = $state(false);
	let dialogRef = $state<HTMLDivElement | null>(null);
	let closeButtonRef = $state<HTMLButtonElement | null>(null);
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

	function initTurnstile() {
		if (!requireTurnstile || !turnstileSiteKey) return;

		loadTurnstileScript(() => {
			turnstileLoaded = true;
			renderWidget();
		});
	}

	function renderWidget() {
		if (!turnstileLoaded || !turnstileSiteKey) return;

		turnstileWidgetId = renderTurnstile(
			'password-modal-turnstile',
			turnstileSiteKey,
			{
				onSuccess: (token: string) => {
					turnstileToken = token;
				},
				onExpired: () => {
					turnstileToken = '';
				},
				onError: (message: string) => {
					turnstileToken = '';
					error = message;
				}
			},
			turnstileWidgetId
		);
	}

	async function handleSubmit() {
		if (!password.trim()) {
			error = '请输入下载密码';
			return;
		}

		if (requireTurnstile && !turnstileToken) {
			error = '请完成人机验证';
			return;
		}

		downloading = true;
		error = '';

		try {
			await onSubmit(password, turnstileToken);
		} catch (e) {
			error = e instanceof Error ? e.message : '下载失败';
			if (requireTurnstile && turnstileWidgetId) {
				resetTurnstile(turnstileWidgetId);
				turnstileToken = '';
			}
		} finally {
			downloading = false;
		}
	}

	$effect(() => {
		initTurnstile();
	});

	$effect(() => {
		lastFocusedElement =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		void focusFirstElement(dialogRef, closeButtonRef);
		const handleKeydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				onClose();
			}
		};
		document.addEventListener('keydown', handleKeydown);
		return () => {
			document.removeEventListener('keydown', handleKeydown);
			lastFocusedElement?.focus();
		};
	});
</script>

<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={titleId}>
	<button type="button" class="modal-scrim" onclick={onClose} aria-label="关闭"></button>
	<div class="modal-card" bind:this={dialogRef} use:trapFocus tabindex="-1">
		<div class="modal-header">
			<h3 id={titleId}>🔐 输入下载密码</h3>
			<button class="modal-close" onclick={onClose} type="button" bind:this={closeButtonRef}>
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
				bind:value={password}
				disabled={downloading}
				onkeydown={(e) => e.key === 'Enter' && handleSubmit()}
			/>

			{#if requireTurnstile}
				<div class="turnstile-wrapper">
					<div id="password-modal-turnstile"></div>
					{#if !turnstileToken}
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
		<button
			class="modal-btn"
			onclick={handleSubmit}
			disabled={downloading || (requireTurnstile && !turnstileToken)}
		>
			{#if downloading}
				<span class="spinner"></span>
				下载中...
			{:else}
				开始下载 →
			{/if}
		</button>
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
