<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import {
		loadTurnstileScript,
		preloadTurnstileScript,
		removeTurnstile,
		renderTurnstile,
		resetTurnstile
	} from '$lib/utils/turnstile-client';
	import type { ApiResponse } from '$lib/types';
	import '$lib/styles/admin-form.css';

	interface Props {
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

	let {
		onLoginSuccess,
		initialTurnstileRequired = false,
		initialTurnstileSiteKey = ''
	}: Props = $props();

	// 认证状态
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	// Turnstile 状态
	let requireTurnstile = $state(false);
	let turnstileSiteKey = $state('');
	let turnstileToken = $state('');
	let turnstileLoadFailed = $state(false);
	let turnstileContainerRef = $state<HTMLDivElement | null>(null);
	let turnstileWidgetId: string | null = null;
	let renderedTurnstileSiteKey = '';
	let turnstileGeneration = 0;

	function destroyTurnstileWidget() {
		const widgetId = turnstileWidgetId;
		turnstileWidgetId = null;
		renderedTurnstileSiteKey = '';
		turnstileToken = '';
		removeTurnstile(widgetId);
	}

	async function ensureTurnstileWidget() {
		const siteKey = turnstileSiteKey;
		if (
			requireTurnstile &&
			turnstileWidgetId &&
			renderedTurnstileSiteKey === siteKey &&
			turnstileContainerRef?.isConnected
		) {
			return;
		}
		const generation = ++turnstileGeneration;
		turnstileLoadFailed = false;
		if (!requireTurnstile || !siteKey) {
			destroyTurnstileWidget();
			turnstileToken = '';
			return;
		}

		try {
			await loadTurnstileScript();
			await tick();
			const container = turnstileContainerRef;
			if (
				generation !== turnstileGeneration ||
				!requireTurnstile ||
				turnstileSiteKey !== siteKey ||
				!container?.isConnected
			) {
				return;
			}
			if (turnstileWidgetId && renderedTurnstileSiteKey === siteKey) return;

			destroyTurnstileWidget();
			const widgetId = renderTurnstile(
				container,
				siteKey,
				{
					onSuccess: (token) => {
						if (generation !== turnstileGeneration) return;
						turnstileToken = token;
						error = '';
					},
					onExpired: () => {
						if (generation === turnstileGeneration) turnstileToken = '';
					},
					onError: (message) => {
						if (generation !== turnstileGeneration) return;
						turnstileToken = '';
						error = message;
					}
				},
				'admin-auth'
			);
			if (!widgetId) throw new Error('Failed to render Turnstile');
			if (generation !== turnstileGeneration) {
				removeTurnstile(widgetId);
				return;
			}
			turnstileWidgetId = widgetId;
			renderedTurnstileSiteKey = siteKey;
		} catch {
			if (generation === turnstileGeneration) turnstileLoadFailed = true;
		}
	}

	function doResetTurnstile() {
		resetTurnstile(turnstileWidgetId);
		turnstileToken = '';
	}

	function applyTurnstileState(
		state: { requireTurnstile?: boolean; siteKey?: string } | undefined,
		resetExistingWidget = false
	) {
		if (typeof state?.requireTurnstile !== 'boolean') return;
		const nextSiteKey = state.requireTurnstile ? state.siteKey || '' : '';
		const canResetExistingWidget =
			resetExistingWidget &&
			state.requireTurnstile &&
			Boolean(turnstileWidgetId) &&
			renderedTurnstileSiteKey === nextSiteKey;

		requireTurnstile = state.requireTurnstile;
		turnstileSiteKey = nextSiteKey;
		if (canResetExistingWidget) {
			doResetTurnstile();
		} else if (requireTurnstile) {
			void ensureTurnstileWidget();
		} else {
			turnstileGeneration += 1;
			destroyTurnstileWidget();
			turnstileToken = '';
		}
	}

	// 登录验证
	async function handleLogin() {
		if (loading) return;
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
			if (data.success && data.data?.authenticated === true) {
				onLoginSuccess();
			} else {
				error = data.error || '密码错误';
				if (typeof data.data?.requireTurnstile === 'boolean') {
					applyTurnstileState(data.data, true);
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

	// 页面打开时先预加载脚本；只有失败阈值已达到时才创建 widget。
	$effect(() => {
		preloadTurnstileScript();
	});

	// 如果该 IP 进入页面前已经达到阈值，复用状态检查结果，避免再提交一次才显示验证。
	$effect(() => {
		if (
			initialTurnstileRequired &&
			initialTurnstileSiteKey &&
			(!requireTurnstile || turnstileSiteKey !== initialTurnstileSiteKey)
		) {
			applyTurnstileState({
				requireTurnstile: true,
				siteKey: initialTurnstileSiteKey
			});
		}
	});

	onDestroy(() => {
		turnstileGeneration += 1;
		destroyTurnstileWidget();
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
					class="admin-input"
					bind:value={password}
					placeholder="输入管理密码"
					autocomplete="current-password"
					oninput={() => {
						if (error) error = '';
					}}
				/>
			</div>

			{#if requireTurnstile}
				<div class="turnstile-wrapper">
					<div bind:this={turnstileContainerRef}></div>
					{#if turnstileLoadFailed}
						<p class="turnstile-hint">人机验证暂时无法加载</p>
						<button type="button" class="admin-btn" onclick={() => void ensureTurnstileWidget()}>
							重新加载验证
						</button>
					{:else if !turnstileToken}
						<p class="turnstile-hint">🤖 请完成人机验证</p>
					{:else}
						<p class="turnstile-success">✅ 验证通过</p>
					{/if}
				</div>
			{/if}

			<button
				type="submit"
				class="login-btn admin-btn admin-btn-primary"
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

	.login-btn {
		/* admin-btn: padding, radius, font, cursor, transition
		   admin-btn-primary: background gradient, color, hover transform+shadow */
		font-size: 1rem;
		width: 100%;
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
