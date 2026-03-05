<script lang="ts">
	import type { ChatMessage, ApiResponse, NicknameKeywordList } from '$lib/types';
	import { SvelteSet } from 'svelte/reactivity';
	import '$lib/styles/admin-form.css';

	interface Props {
		token: string;
	}

	let { token }: Props = $props();

	let messages = $state<ChatMessage[]>([]);
	let loading = $state(false);
	let error = $state('');
	let success = $state('');
	let selectedIds = new SvelteSet<string>();
	let hasMore = $state(false);
	let deleting = $state(false);

	// 昵称关键字配置
	let keywords = $state<string[]>([]);
	let newKeyword = $state('');
	let keywordsLoading = $state(false);
	let keywordsSaving = $state(false);
	let keywordsError = $state('');
	let keywordsSuccess = $state('');

	function authHeaders() {
		return { Authorization: `Bearer ${token}` };
	}

	async function loadMessages(append = false) {
		loading = true;
		error = '';
		try {
			let url = '/api/admin/chat?limit=100';
			if (append && messages.length > 0) {
				const oldest = messages[messages.length - 1];
				url += `&before=${oldest.timestamp}:${oldest.id}`;
			}
			const res = await fetch(url, { headers: authHeaders() });
			const data: ApiResponse<{ messages: ChatMessage[]; hasMore: boolean }> = await res.json();
			if (data.success && data.data) {
				if (append) {
					messages = [...messages, ...data.data.messages];
				} else {
					messages = data.data.messages;
				}
				hasMore = data.data.hasMore;
			} else {
				error = data.error || '加载失败';
			}
		} catch {
			error = '网络错误';
		} finally {
			loading = false;
		}
	}

	async function deleteSelected() {
		if (selectedIds.size === 0) return;
		if (!confirm(`确定要删除选中的 ${selectedIds.size} 条消息吗？`)) return;

		deleting = true;
		error = '';
		try {
			const res = await fetch('/api/admin/chat', {
				method: 'DELETE',
				headers: { ...authHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids: Array.from(selectedIds) })
			});
			const data: ApiResponse<{ deleted: number }> = await res.json();
			if (data.success) {
				messages = messages.filter((m) => !selectedIds.has(m.id));
				success = `已删除 ${data.data?.deleted ?? selectedIds.size} 条消息`;
				selectedIds.clear();
			} else {
				error = data.error || '删除失败';
			}
		} catch {
			error = '网络错误';
		} finally {
			deleting = false;
		}
	}

	async function clearAll() {
		if (!confirm('⚠️ 确定要清空所有聊天记录吗？此操作不可撤销！')) return;

		deleting = true;
		error = '';
		try {
			const res = await fetch('/api/admin/chat', {
				method: 'POST',
				headers: authHeaders()
			});
			const data: ApiResponse<{ deleted: number }> = await res.json();
			if (data.success) {
				messages = [];
				selectedIds.clear();
				success = `已清空 ${data.data?.deleted ?? 0} 条聊天记录`;
				hasMore = false;
			} else {
				error = data.error || '清空失败';
			}
		} catch {
			error = '网络错误';
		} finally {
			deleting = false;
		}
	}

	async function loadKeywords() {
		keywordsLoading = true;
		keywordsError = '';
		try {
			const res = await fetch('/api/admin/chat/nicknames', { headers: authHeaders() });
			const data: ApiResponse<NicknameKeywordList> = await res.json();
			if (data.success && data.data) {
				keywords = data.data.keywords;
			} else {
				keywordsError = data.error || '加载关键字失败';
			}
		} catch {
			keywordsError = '网络错误';
		} finally {
			keywordsLoading = false;
		}
	}

	async function saveKeywords() {
		keywordsSaving = true;
		keywordsError = '';
		keywordsSuccess = '';
		try {
			const res = await fetch('/api/admin/chat/nicknames', {
				method: 'PUT',
				headers: { ...authHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify({ keywords })
			});
			const data: ApiResponse<NicknameKeywordList> = await res.json();
			if (data.success && data.data) {
				keywords = data.data.keywords;
				keywordsSuccess = '关键字已保存';
			} else {
				keywordsError = data.error || '保存失败';
			}
		} catch {
			keywordsError = '网络错误';
		} finally {
			keywordsSaving = false;
		}
	}

	function addKeyword() {
		const trimmed = newKeyword.trim();
		if (!trimmed) return;
		if (keywords.includes(trimmed)) {
			keywordsError = '关键字已存在';
			return;
		}
		keywords = [...keywords, trimmed];
		newKeyword = '';
		keywordsError = '';
	}

	function removeKeyword(index: number) {
		keywords = keywords.filter((_, i) => i !== index);
	}

	function toggleSelect(id: string) {
		if (selectedIds.has(id)) {
			selectedIds.delete(id);
		} else {
			selectedIds.add(id);
		}
	}

	function toggleSelectAll() {
		if (selectedIds.size === messages.length) {
			selectedIds.clear();
		} else {
			selectedIds.clear();
			for (const m of messages) selectedIds.add(m.id);
		}
	}

	function formatTime(ts: number): string {
		const d = new Date(ts);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	}

	$effect(() => {
		loadMessages();
		loadKeywords();
	});
</script>

<div class="chat-manager">
	<div class="keywords-section">
		<div class="keywords-header">
			<h2>🏷️ 昵称关键字配置</h2>
			<p class="keywords-hint">
				配置后，聊天用户将获得 Dota 2 主题的随机昵称（如"超神的大飞"、"青铜小明"）
			</p>
		</div>

		{#if keywordsError}
			<div class="alert alert-error">
				❌ {keywordsError}
				<button class="alert-close" onclick={() => (keywordsError = '')}>×</button>
			</div>
		{/if}

		{#if keywordsSuccess}
			<div class="alert alert-success">
				✅ {keywordsSuccess}
				<button class="alert-close" onclick={() => (keywordsSuccess = '')}>×</button>
			</div>
		{/if}

		{#if keywordsLoading}
			<div class="loading">加载中...</div>
		{:else}
			<div class="keywords-input-row">
				<input
					type="text"
					class="keyword-input admin-input"
					placeholder="输入关键字（如：大飞）"
					maxlength={10}
					bind:value={newKeyword}
					onkeydown={(e) => {
						if (e.key === 'Enter') addKeyword();
					}}
				/>
				<button
					class="btn btn-add admin-btn admin-btn-soft"
					onclick={addKeyword}
					disabled={!newKeyword.trim()}
				>
					➕ 添加
				</button>
			</div>

			<div class="keywords-tags">
				{#if keywords.length === 0}
					<span class="keywords-empty">暂未配置关键字，将使用默认"游客+随机数"昵称</span>
				{/if}
				{#each keywords as keyword, index (keyword)}
					<span class="keyword-tag">
						{keyword}
						<button class="tag-remove" onclick={() => removeKeyword(index)} title="删除">×</button>
					</span>
				{/each}
			</div>

			<div class="keywords-actions">
				<button
					class="btn btn-save admin-btn admin-btn-primary"
					onclick={saveKeywords}
					disabled={keywordsSaving}
				>
					{keywordsSaving ? '保存中...' : '💾 保存关键字'}
				</button>
			</div>
		{/if}
	</div>

	<div class="manager-header">
		<h2>💬 聊天记录管理</h2>
		<div class="header-actions">
			<button
				class="btn btn-refresh admin-btn admin-btn-soft"
				onclick={() => loadMessages()}
				disabled={loading}
			>
				🔄 刷新
			</button>
			<button
				class="btn btn-delete admin-btn admin-btn-danger"
				onclick={deleteSelected}
				disabled={selectedIds.size === 0 || deleting}
			>
				🗑️ 删除选中 ({selectedIds.size})
			</button>
			<button
				class="btn btn-danger admin-btn admin-btn-danger"
				onclick={clearAll}
				disabled={deleting}
			>
				⚠️ 清空所有
			</button>
		</div>
	</div>

	{#if error}
		<div class="alert alert-error">
			❌ {error}
			<button class="alert-close" onclick={() => (error = '')}>×</button>
		</div>
	{/if}

	{#if success}
		<div class="alert alert-success">
			✅ {success}
			<button class="alert-close" onclick={() => (success = '')}>×</button>
		</div>
	{/if}

	{#if loading && messages.length === 0}
		<div class="loading">加载中...</div>
	{:else if messages.length === 0}
		<div class="empty">暂无聊天记录</div>
	{:else}
		<div class="table-container">
			<table>
				<thead>
					<tr>
						<th class="col-check">
							<input
								type="checkbox"
								checked={selectedIds.size === messages.length && messages.length > 0}
								onchange={toggleSelectAll}
							/>
						</th>
						<th class="col-time">时间</th>
						<th class="col-nick">昵称</th>
						<th class="col-text">消息内容</th>
						<th class="col-actions">操作</th>
					</tr>
				</thead>
				<tbody>
					{#each messages as msg (msg.id)}
						<tr class:selected={selectedIds.has(msg.id)}>
							<td class="col-check">
								<input
									type="checkbox"
									checked={selectedIds.has(msg.id)}
									onchange={() => toggleSelect(msg.id)}
								/>
							</td>
							<td class="col-time">{formatTime(msg.timestamp)}</td>
							<td class="col-nick">{msg.nickname}</td>
							<td class="col-text">{msg.text}</td>
							<td class="col-actions">
								<button
									class="btn-icon"
									title="删除"
									disabled={deleting}
									onclick={() => {
										selectedIds.clear();
										selectedIds.add(msg.id);
										deleteSelected();
									}}
								>
									🗑️
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if hasMore}
			<div class="load-more">
				<button
					class="btn btn-secondary admin-btn admin-btn-soft"
					onclick={() => loadMessages(true)}
					disabled={loading}
				>
					{loading ? '加载中...' : '加载更多'}
				</button>
			</div>
		{/if}

		<div class="stats">
			已加载 {messages.length} 条消息
		</div>
	{/if}
</div>

<style>
	.chat-manager {
		max-width: 1000px;
		margin: 0 auto;
	}

	.manager-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.manager-header h2 {
		margin: 0;
		font-family: 'Fredoka', sans-serif;
		color: #6b4c9a;
		font-size: 1.5rem;
	}

	.header-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.btn {
		font-size: 0.85rem;
	}

	.alert {
		padding: 0.8rem 1.2rem;
		border-radius: 12px;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.alert-error {
		background: rgba(255, 107, 107, 0.15);
		color: #c8556b;
	}

	.alert-success {
		background: rgba(107, 203, 119, 0.2);
		color: #2e8b57;
	}

	.alert-close {
		margin-left: auto;
		background: none;
		border: none;
		font-size: 1.3rem;
		cursor: pointer;
		color: inherit;
		padding: 0;
		line-height: 1;
	}

	.loading,
	.empty {
		text-align: center;
		padding: 3rem;
		color: #8b7ba8;
		font-size: 1.1rem;
	}

	.table-container {
		background: rgba(255, 255, 255, 0.7);
		border-radius: 16px;
		overflow: hidden;
		box-shadow: 0 4px 15px rgba(107, 76, 154, 0.1);
		backdrop-filter: blur(10px);
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}

	thead {
		background: rgba(107, 76, 154, 0.08);
	}

	th {
		padding: 0.8rem 1rem;
		text-align: left;
		color: #6b4c9a;
		font-weight: 600;
		white-space: nowrap;
	}

	td {
		padding: 0.7rem 1rem;
		border-top: 1px solid rgba(107, 76, 154, 0.08);
		color: #5a4a6a;
	}

	tr.selected {
		background: rgba(255, 107, 157, 0.08);
	}

	tr:hover {
		background: rgba(107, 76, 154, 0.04);
	}

	.col-check {
		width: 40px;
		text-align: center;
	}

	.col-time {
		width: 170px;
		white-space: nowrap;
		font-size: 0.82rem;
		color: #8b7ba8;
	}

	.col-nick {
		width: 120px;
		font-weight: 600;
		color: #6b4c9a;
	}

	.col-text {
		word-break: break-word;
	}

	.col-actions {
		width: 60px;
		text-align: center;
	}

	.btn-icon {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 1rem;
		padding: 0.2rem;
		transition: transform 0.2s;
	}

	.btn-icon:hover:not(:disabled) {
		transform: scale(1.2);
	}

	.btn-icon:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.load-more {
		text-align: center;
		padding: 1rem;
	}

	.stats {
		text-align: center;
		padding: 0.8rem;
		color: #8b7ba8;
		font-size: 0.85rem;
	}

	input[type='checkbox'] {
		accent-color: #6b4c9a;
		width: 16px;
		height: 16px;
		cursor: pointer;
	}

	@media (max-width: 768px) {
		.manager-header {
			flex-direction: column;
			align-items: flex-start;
		}

		.col-time {
			font-size: 0.75rem;
		}

		th,
		td {
			padding: 0.5rem 0.6rem;
		}
	}

	.keywords-section {
		background: rgba(255, 255, 255, 0.7);
		border-radius: 16px;
		padding: 1.5rem;
		margin-bottom: 2rem;
		box-shadow: 0 4px 15px rgba(107, 76, 154, 0.1);
		backdrop-filter: blur(10px);
	}

	.keywords-header h2 {
		margin: 0 0 0.3rem;
		font-family: 'Fredoka', sans-serif;
		color: #6b4c9a;
		font-size: 1.3rem;
	}

	.keywords-hint {
		margin: 0 0 1rem;
		font-size: 0.85rem;
		color: #8b7ba8;
	}

	.keywords-input-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.keyword-input {
		flex: 1;
		max-width: 240px;
	}

	.keywords-actions {
		display: flex;
		gap: 0.5rem;
	}

	.keywords-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1rem;
		min-height: 36px;
		align-items: center;
	}

	.keywords-empty {
		font-size: 0.85rem;
		color: #9787b8;
		font-style: italic;
	}

	.keyword-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		background: linear-gradient(
			135deg,
			rgba(255, 158, 196, 0.25) 0%,
			rgba(200, 178, 255, 0.25) 100%
		);
		color: #6b4c9a;
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		font-size: 0.88rem;
		font-weight: 600;
	}

	.tag-remove {
		background: none;
		border: none;
		color: #9787b8;
		cursor: pointer;
		font-size: 1.1rem;
		padding: 0;
		line-height: 1;
		transition: color 0.2s;
	}

	.tag-remove:hover {
		color: #ff6b9d;
	}
</style>
