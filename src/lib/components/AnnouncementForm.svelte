<script lang="ts">
	import type {
		Announcement,
		AnnouncementList,
		AnnouncementFormData,
		ApiResponse
	} from '$lib/types';
	import '$lib/styles/admin-form.css';

	interface Props {
		token: string;
	}

	let { token }: Props = $props();

	let announcements = $state<Announcement[]>([]);
	let loading = $state(true);
	let error = $state('');
	let success = $state('');

	// 表单状态
	let editingId = $state<string | null>(null);
	let formTitle = $state('');
	let formContent = $state('');
	let formVisible = $state(true);
	let formPinned = $state(false);
	let submitting = $state(false);

	const authHeaders = $derived({
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json'
	});

	async function loadAnnouncements() {
		loading = true;
		try {
			const res = await fetch('/api/admin/announcements', {
				headers: { Authorization: `Bearer ${token}` }
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data: ApiResponse<AnnouncementList> = await res.json();
			if (data.success && data.data) {
				announcements = data.data.items;
			} else {
				error = data.error || '加载失败';
			}
		} catch {
			error = '网络错误';
		} finally {
			loading = false;
		}
	}

	function startEdit(item: Announcement) {
		editingId = item.id;
		formTitle = item.title;
		formContent = item.content;
		formVisible = item.visible;
		formPinned = item.pinned;
	}

	function cancelEdit() {
		editingId = null;
		formTitle = '';
		formContent = '';
		formVisible = true;
		formPinned = false;
	}

	async function handleSubmit() {
		if (!formTitle.trim() || !formContent.trim()) {
			error = '标题和内容不能为空';
			return;
		}
		submitting = true;
		error = '';
		success = '';
		try {
			const body: AnnouncementFormData & { id?: string } = {
				title: formTitle,
				content: formContent,
				visible: formVisible,
				pinned: formPinned,
				...(editingId && { id: editingId })
			};
			const method = editingId ? 'PUT' : 'POST';
			const res = await fetch('/api/admin/announcements', {
				method,
				headers: authHeaders,
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data: ApiResponse<Announcement> = await res.json();
			if (data.success) {
				success = editingId ? '更新成功' : '创建成功';
				setTimeout(() => {
					success = '';
				}, 3000);
				cancelEdit();
				await loadAnnouncements();
			} else {
				error = data.error || '操作失败';
			}
		} catch {
			error = '网络错误';
		} finally {
			submitting = false;
		}
	}

	async function toggleVisible(item: Announcement) {
		try {
			const res = await fetch('/api/admin/announcements', {
				method: 'PUT',
				headers: authHeaders,
				body: JSON.stringify({ id: item.id, visible: !item.visible })
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data: ApiResponse = await res.json();
			if (data.success) {
				error = '';
				await loadAnnouncements();
			}
		} catch {
			error = '操作失败';
		}
	}

	async function togglePinned(item: Announcement) {
		try {
			const res = await fetch('/api/admin/announcements', {
				method: 'PUT',
				headers: authHeaders,
				body: JSON.stringify({ id: item.id, pinned: !item.pinned })
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data: ApiResponse = await res.json();
			if (data.success) {
				error = '';
				await loadAnnouncements();
			}
		} catch {
			error = '操作失败';
		}
	}

	async function deleteAnnouncement(id: string) {
		if (!confirm('确定删除这条公告吗？')) return;
		try {
			const res = await fetch('/api/admin/announcements', {
				method: 'DELETE',
				headers: authHeaders,
				body: JSON.stringify({ id })
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data: ApiResponse = await res.json();
			if (data.success) {
				success = '删除成功';
				setTimeout(() => {
					success = '';
				}, 3000);
				await loadAnnouncements();
			} else {
				error = data.error || '删除失败';
			}
		} catch {
			error = '网络错误';
		}
	}

	$effect(() => {
		if (token) loadAnnouncements();
	});
</script>

<div class="announcement-manager">
	<h3 class="section-title">公告管理</h3>

	{#if error}
		<div class="alert alert-error">{error}</div>
	{/if}
	{#if success}
		<div class="alert alert-success">{success}</div>
	{/if}

	<!-- 新增/编辑表单 -->
	<div class="form-card">
		<h4 class="form-title">{editingId ? '编辑公告' : '新增公告'}</h4>
		<div class="form-field">
			<label for="ann-title" class="admin-label">标题</label>
			<input
				id="ann-title"
				type="text"
				bind:value={formTitle}
				placeholder="公告标题"
				class="form-input admin-input"
			/>
		</div>
		<div class="form-field">
			<label for="ann-content" class="admin-label">内容（Markdown）</label>
			<textarea
				id="ann-content"
				bind:value={formContent}
				placeholder="支持 **加粗**、[链接](url)、- 列表等 Markdown 格式"
				class="form-textarea admin-input"
				rows="5"
			></textarea>
		</div>
		<div class="form-row">
			<label class="checkbox-label">
				<input type="checkbox" class="admin-checkbox" bind:checked={formVisible} />
				<span>显示</span>
			</label>
			<label class="checkbox-label">
				<input type="checkbox" class="admin-checkbox" bind:checked={formPinned} />
				<span>置顶</span>
			</label>
		</div>
		<div class="form-actions">
			<button
				class="btn admin-btn admin-btn-primary"
				onclick={handleSubmit}
				disabled={submitting}
				type="button"
			>
				{submitting ? '提交中...' : editingId ? '保存修改' : '发布公告'}
			</button>
			{#if editingId}
				<button class="btn admin-btn admin-btn-ghost" onclick={cancelEdit} type="button"
					>取消</button
				>
			{/if}
		</div>
	</div>

	<!-- 公告列表 -->
	{#if loading}
		<p class="loading-text">加载中...</p>
	{:else if announcements.length === 0}
		<p class="empty-text">暂无公告</p>
	{:else}
		<div class="list">
			{#each announcements as item (item.id)}
				<div class="list-item">
					<div class="item-info">
						<span class="item-title">{item.pinned ? '📌 ' : ''}{item.title}</span>
						<span class="item-status" class:hidden={!item.visible}
							>{item.visible ? '显示' : '隐藏'}</span
						>
					</div>
					<div class="item-actions">
						<button class="btn-sm" onclick={() => togglePinned(item)} type="button">
							{item.pinned ? '取消置顶' : '置顶'}
						</button>
						<button class="btn-sm" onclick={() => toggleVisible(item)} type="button">
							{item.visible ? '隐藏' : '显示'}
						</button>
						<button class="btn-sm" onclick={() => startEdit(item)} type="button">编辑</button>
						<button
							class="btn-sm btn-danger"
							onclick={() => deleteAnnouncement(item.id)}
							type="button">删除</button
						>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.announcement-manager {
		padding: 1rem 0;
	}

	.section-title {
		font-family: 'Fredoka', 'Nunito', sans-serif;
		font-size: 1.2rem;
		color: #6b4c9a;
		margin: 0 0 1rem;
	}

	.alert {
		padding: 0.75rem 1rem;
		border-radius: 12px;
		margin-bottom: 1rem;
		font-size: 0.9rem;
	}

	.alert-error {
		background: #fff0f0;
		color: #c0392b;
		border: 1px solid #fcc;
	}

	.alert-success {
		background: #f0fff4;
		color: #27ae60;
		border: 1px solid #aed6b8;
	}

	.form-card {
		background: rgba(255, 255, 255, 0.8);
		border: 1px solid rgba(107, 76, 154, 0.2);
		border-radius: 20px;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.form-title {
		font-size: 1rem;
		font-weight: 600;
		color: #6b4c9a;
		margin: 0 0 1rem;
	}

	.form-field {
		margin-bottom: 0.75rem;
	}

	.form-field label {
		margin-bottom: 0.35rem;
	}

	.form-input,
	.form-textarea {
		resize: vertical;
	}

	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.form-row {
		display: flex;
		gap: 1.5rem;
		margin-bottom: 1rem;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.form-actions {
		display: flex;
		gap: 0.75rem;
	}

	.loading-text,
	.empty-text {
		color: #999;
		font-size: 0.9rem;
		text-align: center;
		padding: 1rem;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.list-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: rgba(255, 255, 255, 0.7);
		border: 1px solid rgba(107, 76, 154, 0.15);
		border-radius: 14px;
		padding: 0.75rem 1rem;
		gap: 1rem;
	}

	.item-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex: 1;
		min-width: 0;
	}

	.item-title {
		font-size: 0.9rem;
		color: #333;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-status {
		font-size: 0.75rem;
		padding: 0.15rem 0.5rem;
		border-radius: 8px;
		background: #e8f5e9;
		color: #27ae60;
		flex-shrink: 0;
	}

	.item-status.hidden {
		background: #f5f5f5;
		color: #999;
	}

	.item-actions {
		display: flex;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.btn-sm {
		padding: 0.3rem 0.65rem;
		border-radius: 8px;
		border: 1px solid rgba(107, 76, 154, 0.3);
		background: transparent;
		color: #6b4c9a;
		font-size: 0.8rem;
		cursor: pointer;
		transition: background 0.2s;
	}

	.btn-sm:hover {
		background: rgba(107, 76, 154, 0.08);
	}

	.btn-sm.btn-danger {
		border-color: rgba(192, 57, 43, 0.3);
		color: #c0392b;
	}

	.btn-sm.btn-danger:hover {
		background: rgba(192, 57, 43, 0.08);
	}
</style>
