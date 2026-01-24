<script lang="ts">
	import {
		loadTurnstileScript,
		renderTurnstile,
		resetTurnstile
	} from '$lib/utils/turnstile-client';
	import type { ApiResponse } from '$lib/types';

	interface Props {
		onLoginSuccess: () => void;
	}

	interface TurnstileCheckResponse {
		requireTurnstile: boolean;
		siteKey: string;
		failureCount: number;
	}

	interface LoginResponse {
		token?: string;
		requireTurnstile?: boolean;
		siteKey?: string;
		failureCount?: number;
	}

	let { onLoginSuccess }: Props = $props();

	// 认证状态
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	// Turnstile 状态
	let requireTurnstile = $state(false);
	let turnstileSiteKey = $state('');
	let turnstileToken = $state('');
	let turnstileWidgetId = $state<string | null>(null);
	let turnstileLoaded = $state(false);

	// 检查是否需要 Turnstile
	async function checkTurnstileRequired() {
		try {
			const res = await fetch('/api/admin/auth');
			const data: ApiResponse<TurnstileCheckResponse> = await res.json();
			if (data.success && data.data) {
				requireTurnstile = data.data.requireTurnstile;
				turnstileSiteKey = data.data.siteKey;
				if (requireTurnstile && turnstileSiteKey) {
					loadTurnstileScript(() => {
						turnstileLoaded = true;
						doRenderTurnstile();
					});
				}
			}
		} catch (e) {
			console.error('Failed to check turnstile status:', e);
		}
	}

	function doRenderTurnstile() {
		if (!turnstileLoaded || !turnstileSiteKey) return;

		turnstileWidgetId = renderTurnstile(
			'turnstile-container',
			turnstileSiteKey,
			{
				onSuccess: (token) => {
					turnstileToken = token;
				},
				onExpired: () => {
					turnstileToken = '';
				},
				onError: (message) => {
					turnstileToken = '';
					error = message;
				}
			},
			turnstileWidgetId
		);
	}

	function doResetTurnstile() {
		resetTurnstile(turnstileWidgetId);
		turnstileToken = '';
	}

	// 登录验证
	async function handleLogin() {
		if (!password) {
			error = '请输入密码';
			return;
		}

		if (requireTurnstile && !turnstileToken) {
			error = '请完成人机验证';
			return;
		}

		loading = true;
		error = '';

		try {
			const res = await fetch('/api/admin/auth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					password,
					turnstileToken: turnstileToken || undefined
				})
			});

			const data: ApiResponse<LoginResponse> = await res.json();
			if (data.success && data.data?.token) {
				localStorage.setItem('admin_token', data.data.token);
				onLoginSuccess();
			} else {
				error = data.error || '密码错误';

				// 检查是否需要启用 Turnstile
				if (data.data?.requireTurnstile && data.data?.siteKey) {
					requireTurnstile = true;
					turnstileSiteKey = data.data.siteKey;
					loadTurnstileScript(() => {
						turnstileLoaded = true;
						setTimeout(() => doRenderTurnstile(), 100);
					});
				} else if (requireTurnstile) {
					doResetTurnstile();
				}
			}
		} catch {
			error = '网络错误';
			if (requireTurnstile) {
				doResetTurnstile();
			}
		} finally {
			loading = false;
		}
	}

	// 初始化时检查 Turnstile 状态
	$effect(() => {
		checkTurnstileRequired();
	});
</script>

<div class="login-container">
	<div class="login-card">
		<div class="login-icon">🔐</div>
		<h1>管理后台</h1>
		<p class="login-subtitle">请输入密码以继续</p>

		{#if error}
			<div class="login-error">
				<span>❌</span>
				{error}
			</div>
		{/if}

		<form
			class="login-form"
			onsubmit={(e) => {
				e.preventDefault();
				handleLogin();
			}}
		>
			<div class="login-input-group">
				<input
					type="password"
					bind:value={password}
					placeholder="输入管理密码"
					autocomplete="current-password"
				/>
			</div>

			{#if requireTurnstile}
				<div class="turnstile-wrapper">
					<div id="turnstile-container"></div>
					{#if !turnstileToken}
						<p class="turnstile-hint">🤖 请完成人机验证</p>
					{:else}
						<p class="turnstile-success">✅ 验证通过</p>
					{/if}
				</div>
			{/if}

			<button
				type="submit"
				class="login-btn"
				disabled={loading || (requireTurnstile && !turnstileToken)}
			>
				{#if loading}
					<span class="spinner"></span> 验证中...
				{:else}
					🚀 进入后台
				{/if}
			</button>
		</form>

		<p class="login-hint">💡 忘记密码？请联系管理员</p>
	</div>
</div>

<style>
	.login-container {
		min-height: 100vh;
		background: linear-gradient(135deg, #fff5f7 0%, #f0e6ff 50%, #e6f0ff 100%);
		font-family: 'Nunito', 'PingFang SC', 'Microsoft YaHei', sans-serif;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
	}

	.login-card {
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(10px);
		border-radius: 20px;
		padding: 3rem;
		width: 100%;
		max-width: 400px;
		text-align: center;
		box-shadow: 0 8px 25px rgba(107, 76, 154, 0.12);
	}

	.login-icon {
		font-size: 4rem;
		margin-bottom: 1rem;
	}

	.login-card h1 {
		font-family: 'Fredoka', sans-serif;
		color: #6b4c9a;
		margin: 0 0 0.5rem;
		font-size: 2rem;
	}

	.login-subtitle {
		color: #8b7ba8;
		margin: 0 0 1.5rem;
	}

	.login-error {
		background: rgba(255, 107, 107, 0.15);
		color: #dc3545;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		margin-bottom: 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: center;
	}

	.login-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.login-input-group input {
		width: 100%;
		padding: 1rem 1.25rem;
		border: 2px solid #e6e0f0;
		border-radius: 12px;
		font-size: 1rem;
		font-family: inherit;
		transition: all 0.3s ease;
		box-sizing: border-box;
	}

	.login-input-group input:focus {
		outline: none;
		border-color: #6b4c9a;
		box-shadow: 0 0 0 3px rgba(107, 76, 154, 0.2);
	}

	.login-btn {
		padding: 1rem 2rem;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		border: none;
		border-radius: 20px;
		font-size: 1.1rem;
		font-family: inherit;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s ease;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		position: relative;
		overflow: hidden;
	}

	.login-btn:hover:not(:disabled) {
		transform: translateY(-3px) scale(1.02);
		box-shadow: 0 12px 30px rgba(102, 126, 234, 0.45);
	}

	.login-btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.login-hint {
		margin-top: 1.5rem;
		font-size: 0.85rem;
		color: #a89bc4;
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

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 1s linear infinite;
		display: inline-block;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
