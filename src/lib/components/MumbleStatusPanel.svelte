<script lang="ts">
	import { onMount } from 'svelte';
	import {
		createInitialMumbleClientSnapshot,
		createMumbleClient,
		type MumbleClientSnapshot
	} from '$lib/mumble/client';
	import { createChannelNameMap, countUsersByChannel } from '$lib/mumble/utils';
	import type { ApiResponse, MumbleProxyConfig, MumbleProxyHealth } from '$lib/types';

	let loading = $state(true);
	let configError = $state('');
	let healthError = $state('');
	let refreshingHealth = $state(false);
	let clientState = $state<MumbleClientSnapshot>(createInitialMumbleClientSnapshot());
	let proxyHealth = $state<MumbleProxyHealth | null>(null);
	let healthUrl = $state<string | null>(null);

	let client: ReturnType<typeof createMumbleClient> | null = null;
	let unsubscribeClient: (() => void) | null = null;
	let healthInterval: ReturnType<typeof setInterval> | null = null;

	const channelNameMap = $derived(createChannelNameMap(clientState.channels));
	const visibleUsers = $derived(
		clientState.users.filter((user) => user.sessionId !== clientState.sessionId)
	);
	const usersByChannel = $derived(countUsersByChannel(visibleUsers));
	const recentMessages = $derived([...clientState.messages].slice(-16).reverse());
	const monitorStatusText = $derived.by(() => {
		if (clientState.reconnecting) {
			return '监控连接重连中';
		}
		if (clientState.status === 'connecting') {
			return '监控连接建立中';
		}
		if (clientState.connected) {
			return '监控连接已就绪';
		}
		if (configError) {
			return '监控不可用';
		}
		return '监控尚未连接';
	});

	async function fetchMumbleConfig(): Promise<MumbleProxyConfig | null> {
		try {
			const res = await fetch('/api/mumble/config');
			const data: ApiResponse<MumbleProxyConfig> = await res.json();
			if (data.success && data.data) {
				healthUrl = data.data.healthUrl;
				return data.data;
			}
			configError = data.error || 'Mumble 代理配置不可用';
		} catch {
			configError = '无法读取 Mumble 代理配置';
		}
		return null;
	}

	async function refreshHealth(): Promise<void> {
		if (!healthUrl) {
			healthError = 'Mumble 代理健康检查地址尚未配置';
			return;
		}
		refreshingHealth = true;
		healthError = '';
		const checkedAt = Date.now();
		try {
			const response = await fetch(healthUrl, { headers: { Accept: 'text/plain' } });
			const message = (await response.text()).trim() || response.statusText || 'unknown';
			proxyHealth = {
				healthy: response.ok && message.toLowerCase() === 'ok',
				status: response.status,
				message,
				checkedAt,
				url: healthUrl
			};
		} catch {
			healthError = '获取代理健康状态失败（代理可能未运行）';
		} finally {
			refreshingHealth = false;
		}
	}

	function handleReconnect(): void {
		client?.reconnect();
		void refreshHealth();
	}

	function formatTime(timestamp: number): string {
		return new Date(timestamp).toLocaleString('zh-CN', {
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	function getChannelName(channelId: number): string {
		return channelNameMap.get(channelId) ?? `频道 #${channelId}`;
	}

	function formatHealthEndpoint(url: string): string {
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	}

	onMount(() => {
		let cancelled = false;

		(async () => {
			const config = await fetchMumbleConfig();
			await refreshHealth();

			if (cancelled || !config) {
				loading = false;
				return;
			}

			client = createMumbleClient({
				config,
				nickname: `监控-${Math.floor(Math.random() * 9000 + 1000)}`,
				mode: 'monitor'
			});
			unsubscribeClient = client.state.subscribe((nextState) => {
				clientState = nextState;
			});
			client.connect();
			loading = false;
		})();

		healthInterval = setInterval(() => {
			void refreshHealth();
		}, 15000);

		return () => {
			cancelled = true;
			unsubscribeClient?.();
			client?.destroy();
			if (healthInterval) {
				clearInterval(healthInterval);
			}
		};
	});
</script>

<div class="mumble-status-panel">
	<div class="panel-header">
		<div>
			<h2>🎧 Mumble 状态面板</h2>
			<p>
				该页面会以只读监控身份连接 Mumble 代理，展示当前健康状态、频道、在线用户与最近文字消息。
			</p>
		</div>

		<div class="panel-actions">
			<button class="action-btn soft" type="button" onclick={() => void refreshHealth()}>
				{refreshingHealth ? '刷新中...' : '刷新健康'}
			</button>
			<button class="action-btn" type="button" onclick={handleReconnect}>重连监控</button>
		</div>
	</div>

	{#if configError}
		<div class="alert alert-error">❌ {configError}</div>
	{/if}

	{#if healthError}
		<div class="alert alert-error">❌ {healthError}</div>
	{/if}

	<div class="summary-grid">
		<section class="summary-card">
			<h3>代理健康</h3>
			{#if proxyHealth}
				<div class="status-line">
					<span class="status-dot" class:healthy={proxyHealth.healthy}></span>
					<strong>{proxyHealth.healthy ? '运行正常' : '状态异常'}</strong>
				</div>
				<p>目标：{formatHealthEndpoint(proxyHealth.url)}</p>
				<p>响应：{proxyHealth.message}</p>
				<p>更新时间：{formatTime(proxyHealth.checkedAt)}</p>
			{:else}
				<p>{loading ? '正在读取健康信息...' : '暂无健康数据'}</p>
			{/if}
		</section>

		<section class="summary-card">
			<h3>监控连接</h3>
			<div class="status-line">
				<span class="status-dot" class:healthy={clientState.connected}></span>
				<strong>{monitorStatusText}</strong>
			</div>
			<p>昵称：{clientState.username || '等待连接中...'}</p>
			<p>频道数：{clientState.channels.length}</p>
			<p>在线用户：{visibleUsers.length}</p>
		</section>

		<section class="summary-card">
			<h3>最近活动</h3>
			<p>最近文字消息：{clientState.messages.length}</p>
			<p>
				当前频道：{clientState.currentChannelId === null
					? '未加入'
					: getChannelName(clientState.currentChannelId)}
			</p>
			<p>断线原因：{clientState.disconnectReason || '—'}</p>
		</section>
	</div>

	<div class="content-grid">
		<section class="content-card">
			<h3>频道列表</h3>
			{#if clientState.channels.length === 0}
				<p class="empty-text">{loading ? '等待频道数据...' : '暂无频道数据'}</p>
			{:else}
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>频道</th>
								<th>在线人数</th>
								<th>描述</th>
							</tr>
						</thead>
						<tbody>
							{#each clientState.channels as channel (channel.id)}
								<tr>
									<td>{channel.name}</td>
									<td>{usersByChannel.get(channel.id) ?? 0}</td>
									<td>{channel.description || '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="content-card">
			<h3>在线用户</h3>
			{#if visibleUsers.length === 0}
				<p class="empty-text">{loading ? '等待在线用户...' : '暂无在线用户'}</p>
			{:else}
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>昵称</th>
								<th>所在频道</th>
								<th>静音</th>
								<th>耳聋</th>
							</tr>
						</thead>
						<tbody>
							{#each visibleUsers as user (user.sessionId)}
								<tr>
									<td>{user.name}</td>
									<td>{getChannelName(user.channelId)}</td>
									<td>{user.muted ? '是' : '否'}</td>
									<td>{user.deafened ? '是' : '否'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	</div>

	<section class="content-card messages-card">
		<h3>最近文字消息</h3>
		{#if recentMessages.length === 0}
			<p class="empty-text">{loading ? '等待文本消息...' : '当前会话尚未收到文字消息'}</p>
		{:else}
			<div class="message-list">
				{#each recentMessages as message (message.id)}
					<article class="message-item">
						<div class="message-meta">
							<strong>{message.sender}</strong>
							<span>{getChannelName(message.channelId)}</span>
							<time>{formatTime(message.timestamp)}</time>
						</div>
						<p>{message.message}</p>
					</article>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.mumble-status-panel {
		max-width: 1100px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.panel-header h2 {
		margin: 0 0 0.35rem;
		font-family: 'Fredoka', sans-serif;
		color: #6b4c9a;
		font-size: 1.6rem;
	}

	.panel-header p {
		margin: 0;
		max-width: 700px;
		color: #8b7ba8;
		line-height: 1.5;
	}

	.panel-actions {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.action-btn {
		border: none;
		border-radius: 12px;
		padding: 0.65rem 1rem;
		background: linear-gradient(135deg, #ff8fbe 0%, #bfa5ff 100%);
		color: #2f1a52;
		font-weight: 700;
		cursor: pointer;
	}

	.action-btn.soft {
		background: rgba(107, 76, 154, 0.12);
		color: #6b4c9a;
	}

	.alert {
		padding: 0.9rem 1rem;
		border-radius: 14px;
	}

	.alert-error {
		background: rgba(255, 107, 107, 0.15);
		color: #c8556b;
	}

	.summary-grid,
	.content-grid {
		display: grid;
		gap: 1rem;
	}

	.summary-grid {
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	}

	.content-grid {
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
	}

	.summary-card,
	.content-card {
		background: rgba(255, 255, 255, 0.78);
		backdrop-filter: blur(10px);
		border-radius: 18px;
		padding: 1rem 1.1rem;
		box-shadow: 0 8px 24px rgba(107, 76, 154, 0.08);
	}

	.summary-card h3,
	.content-card h3 {
		margin: 0 0 0.75rem;
		color: #6b4c9a;
		font-size: 1.05rem;
	}

	.summary-card p {
		margin: 0.35rem 0 0;
		color: #6a5b86;
		font-size: 0.9rem;
	}

	.status-line {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.status-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #ffc857;
	}

	.status-dot.healthy {
		background: #4caf50;
	}

	.table-wrap {
		overflow-x: auto;
		border-radius: 14px;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		background: rgba(255, 255, 255, 0.55);
	}

	th,
	td {
		padding: 0.7rem 0.75rem;
		text-align: left;
		border-bottom: 1px solid rgba(107, 76, 154, 0.08);
		font-size: 0.9rem;
		color: #554773;
	}

	th {
		color: #6b4c9a;
		font-weight: 700;
		background: rgba(107, 76, 154, 0.05);
	}

	.messages-card {
		padding-bottom: 1.15rem;
	}

	.message-list {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.message-item {
		background: rgba(244, 239, 255, 0.9);
		border-radius: 14px;
		padding: 0.8rem 0.9rem;
	}

	.message-meta {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		align-items: center;
		margin-bottom: 0.35rem;
		font-size: 0.78rem;
		color: #7b65a1;
	}

	.message-item p {
		margin: 0;
		color: #4d3a70;
		word-break: break-word;
	}

	.empty-text {
		margin: 0;
		color: #9787b8;
		font-size: 0.9rem;
	}

	@media (max-width: 768px) {
		.panel-header {
			flex-direction: column;
		}

		.panel-actions {
			width: 100%;
		}

		.action-btn {
			flex: 1;
		}
	}
</style>
