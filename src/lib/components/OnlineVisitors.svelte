<script lang="ts">
	import type { OnlineVisitor, ApiResponse } from '$lib/types';
	import { onDestroy } from 'svelte';

	interface Props {
		token: string;
	}

	let { token }: Props = $props();

	let visitors = $state<OnlineVisitor[]>([]);
	let total = $state(0);
	let loading = $state(false);
	let error = $state('');
	let intervalId: ReturnType<typeof setInterval> | null = null;

	function authHeaders() {
		return { Authorization: `Bearer ${token}` };
	}

	async function loadVisitors() {
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/admin/online', { headers: authHeaders() });
			const data: ApiResponse<{ visitors: OnlineVisitor[]; total: number }> = await res.json();
			if (data.success && data.data) {
				visitors = data.data.visitors;
				total = data.data.total;
			} else {
				error = data.error || '加载失败';
			}
		} catch {
			error = '网络错误';
		} finally {
			loading = false;
		}
	}

	/** 将 User-Agent 字符串简化为可读的浏览器/设备信息 */
	function parseUA(ua: string): string {
		if (ua === 'unknown') return '未知';
		if (/iPhone|iPad|iPod/i.test(ua)) return '📱 iOS';
		if (/Android/i.test(ua)) return '📱 Android';
		if (/Edg\//i.test(ua)) return '🌐 Edge';
		if (/Chrome\//i.test(ua)) return '🌐 Chrome';
		if (/Firefox\//i.test(ua)) return '🦊 Firefox';
		if (/Safari\//i.test(ua)) return '🍎 Safari';
		if (/curl|bot|spider/i.test(ua)) return '🤖 Bot';
		return '🌐 浏览器';
	}

	function formatDuration(connectedAt: number): string {
		const seconds = Math.floor((Date.now() - connectedAt) / 1000);
		if (seconds < 60) return `${seconds}秒`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}分钟`;
		return `${Math.floor(minutes / 60)}小时${minutes % 60}分钟`;
	}

	$effect(() => {
		loadVisitors();
		intervalId = setInterval(loadVisitors, 5000);
		return () => {
			if (intervalId !== null) clearInterval(intervalId);
		};
	});

	onDestroy(() => {
		if (intervalId !== null) clearInterval(intervalId);
	});
</script>

<div class="online-visitors">
	<div class="section-header">
		<h2>👥 在线用户</h2>
		<span class="online-badge">{total} 人在线</span>
		{#if loading}
			<span class="refreshing">刷新中…</span>
		{/if}
	</div>

	{#if error}
		<div class="error-msg">❌ {error}</div>
	{/if}

	{#if visitors.length === 0 && !loading && !error}
		<div class="empty-msg">🌸 暂无在线用户</div>
	{:else}
		<div class="table-wrap">
			<table class="visitors-table">
				<thead>
					<tr>
						<th>#</th>
						<th>IP 地址</th>
						<th>浏览器</th>
						<th>昵称</th>
						<th>在线时长</th>
					</tr>
				</thead>
				<tbody>
					{#each visitors as visitor, i}
						<tr>
							<td class="num">{i + 1}</td>
							<td class="ip">{visitor.ip}</td>
							<td class="browser">{parseUA(visitor.userAgent)}</td>
							<td class="nickname">{visitor.nickname}</td>
							<td class="duration">{formatDuration(visitor.connectedAt)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.online-visitors {
		max-width: 1000px;
		margin: 0 auto;
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.section-header h2 {
		margin: 0;
		font-family: 'Fredoka', sans-serif;
		font-size: 1.5rem;
		color: #6b4c9a;
	}

	.online-badge {
		background: linear-gradient(135deg, #ff6b9d, #6b4c9a);
		color: white;
		padding: 0.3rem 0.8rem;
		border-radius: 20px;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.refreshing {
		font-size: 0.8rem;
		color: #aaa;
		font-style: italic;
	}

	.error-msg {
		background: rgba(255, 107, 107, 0.15);
		color: #c8556b;
		padding: 1rem 1.5rem;
		border-radius: 12px;
		margin-bottom: 1rem;
	}

	.empty-msg {
		text-align: center;
		color: #aaa;
		padding: 3rem;
		font-size: 1.1rem;
	}

	.table-wrap {
		overflow-x: auto;
		border-radius: 16px;
		box-shadow: 0 4px 20px rgba(107, 76, 154, 0.1);
	}

	.visitors-table {
		width: 100%;
		border-collapse: collapse;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(10px);
	}

	.visitors-table thead tr {
		background: linear-gradient(135deg, rgba(107, 76, 154, 0.08), rgba(255, 107, 157, 0.08));
	}

	.visitors-table th {
		padding: 0.8rem 1rem;
		text-align: left;
		font-size: 0.85rem;
		color: #6b4c9a;
		font-weight: 600;
		border-bottom: 1px solid rgba(107, 76, 154, 0.1);
	}

	.visitors-table td {
		padding: 0.75rem 1rem;
		font-size: 0.9rem;
		color: #444;
		border-bottom: 1px solid rgba(107, 76, 154, 0.06);
	}

	.visitors-table tbody tr:hover {
		background: rgba(107, 76, 154, 0.04);
	}

	.visitors-table tbody tr:last-child td {
		border-bottom: none;
	}

	.num {
		color: #aaa;
		font-size: 0.8rem;
		width: 2rem;
	}

	.ip {
		font-family: monospace;
		font-size: 0.85rem;
		color: #6b4c9a;
	}

	.browser {
		min-width: 100px;
	}

	.nickname {
		color: #ff6b9d;
		font-weight: 500;
	}

	.duration {
		color: #888;
		font-size: 0.85rem;
	}
</style>
