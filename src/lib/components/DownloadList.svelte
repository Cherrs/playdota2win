<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import type { DownloadItem, Platform, StorageType, Category } from '$lib/types';

	interface Props {
		downloads: DownloadItem[];
		categories: Category[];
		loading: boolean;
		onEdit: (item: DownloadItem) => void;
		onToggleEnabled: (item: DownloadItem) => void;
		onDelete: (id: string) => void;
		onReload: () => void;
	}

	let { downloads, categories, loading, onEdit, onToggleEnabled, onDelete, onReload }: Props =
		$props();

	let error = $state('');
	let success = $state('');
	let showBulkActions = $state(false);
	let selectedIds = new SvelteSet<string>();

	// 平台图标
	function getPlatformIcon(platform: Platform): string {
		switch (platform) {
			case 'windows':
				return '🪟';
			case 'macos':
				return '🍎';
			case 'linux':
				return '🐧';
			default:
				return '📦';
		}
	}

	// 存储类型标签
	function getStorageLabel(type: StorageType): string {
		switch (type) {
			case 'link':
				return '外部链接';
			case 'r2':
				return 'Cloudflare R2';
			case 's3':
				return '自定义 S3';
			default:
				return type;
		}
	}

	function resolveDownloadUrl(item: DownloadItem): string {
		if (item.storageType === 'link') {
			return item.url;
		}
		return item.signedUrl || item.url;
	}

	// 批量操作：全选/取消全选
	function toggleSelectAll() {
		if (selectedIds.size === downloads.length) {
			selectedIds.clear();
		} else {
			selectedIds.clear();
			for (const download of downloads) {
				selectedIds.add(download.id);
			}
		}
	}

	// 批量操作：移动到分类
	async function handleBulkMoveToCategory(categoryId: string | null) {
		if (selectedIds.size === 0) {
			error = '请先选择要移动的下载项';
			return;
		}

		try {
			const token = localStorage.getItem('admin_token');
			for (const itemId of selectedIds) {
				const item = downloads.find((d) => d.id === itemId);
				if (!item) continue;

				await fetch('/api/admin', {
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json',
						...(token ? { Authorization: `Bearer ${token}` } : {})
					},
					body: JSON.stringify({
						id: itemId,
						categoryId,
						enabled: item.enabled
					})
				});
			}

			success = `成功移动 ${selectedIds.size} 个下载项！`;
			selectedIds.clear();
			showBulkActions = false;
			onReload();
		} catch {
			error = '批量移动失败';
		}
	}

	// 批量操作：删除
	async function handleBulkDelete() {
		if (selectedIds.size === 0) {
			error = '请先选择要删除的下载项';
			return;
		}

		if (!confirm(`确定要删除选中的 ${selectedIds.size} 个下载项吗？`)) return;

		try {
			const token = localStorage.getItem('admin_token');
			for (const itemId of selectedIds) {
				await fetch('/api/admin', {
					method: 'DELETE',
					headers: {
						'Content-Type': 'application/json',
						...(token ? { Authorization: `Bearer ${token}` } : {})
					},
					body: JSON.stringify({ id: itemId })
				});
			}

			success = `成功删除 ${selectedIds.size} 个下载项！`;
			selectedIds.clear();
			showBulkActions = false;
			onReload();
		} catch {
			error = '批量删除失败';
		}
	}
</script>

<section class="list-section">
	<div class="section-header">
		<h2>📋 下载列表</h2>
		{#if downloads.length > 0}
			<button
				class="btn btn-small"
				class:btn-primary={!showBulkActions}
				onclick={() => {
					showBulkActions = !showBulkActions;
					if (!showBulkActions) {
						selectedIds.clear();
					}
				}}
			>
				{showBulkActions ? '取消批量操作' : '批量操作'}
			</button>
		{/if}
	</div>

	{#if error}
		<div class="alert alert-error">
			<span>❌</span>
			{error}
			<button class="alert-close" onclick={() => (error = '')}>×</button>
		</div>
	{/if}

	{#if success}
		<div class="alert alert-success">
			<span>✅</span>
			{success}
			<button class="alert-close" onclick={() => (success = '')}>×</button>
		</div>
	{/if}

	{#if showBulkActions && downloads.length > 0}
		<div class="bulk-actions-bar">
			<label class="checkbox-label">
				<input
					type="checkbox"
					checked={selectedIds.size === downloads.length}
					onchange={toggleSelectAll}
				/>
				<span>全选 ({selectedIds.size} / {downloads.length})</span>
			</label>

			{#if selectedIds.size > 0}
				<div class="bulk-action-buttons">
					<select
						class="bulk-category-select"
						onchange={(e) => {
							const select = e.target as HTMLSelectElement;
							if (!select.value) return;
							const value = select.value === '__none__' ? null : select.value;
							handleBulkMoveToCategory(value);
							select.value = '';
						}}
					>
						<option value="">移动到分类...</option>
						<option value="__none__">（无分类）</option>
						{#each categories as category (category.id)}
							<option value={category.id}>{category.icon || ''} {category.name}</option>
						{/each}
					</select>
					<button class="btn btn-small btn-danger" onclick={handleBulkDelete}>
						删除选中 ({selectedIds.size})
					</button>
				</div>
			{/if}
		</div>
	{/if}

	{#if loading}
		<div class="loading">
			<div class="spinner large"></div>
			<p>加载中...</p>
		</div>
	{:else if downloads.length === 0}
		<div class="empty-state">
			<span class="empty-icon">📦</span>
			<p>暂无下载项</p>
			<p class="empty-hint">使用上方表单添加第一个下载项吧！</p>
		</div>
	{:else}
		<div class="download-list">
			{#each downloads as item (item.id)}
				<div class="download-item" class:disabled={!item.enabled}>
					{#if showBulkActions}
						<label class="item-checkbox">
							<input
								type="checkbox"
								checked={selectedIds.has(item.id)}
								onchange={() => {
									if (selectedIds.has(item.id)) {
										selectedIds.delete(item.id);
									} else {
										selectedIds.add(item.id);
									}
								}}
							/>
						</label>
					{/if}
					<div class="item-icon">{getPlatformIcon(item.platform)}</div>
					<div class="item-info">
						<div class="item-title">
							{item.title || `${item.platform.toUpperCase()} - ${item.version}`}
							<span class="badge badge-{item.storageType}">{getStorageLabel(item.storageType)}</span
							>
							{#if item.categoryId}
								{@const cat = categories.find((c) => c.id === item.categoryId)}
								{#if cat}
									<span
										class="badge badge-category"
										style:background-color={cat.color
											? `${cat.color}15`
											: 'rgba(107, 76, 154, 0.08)'}
										style:color={cat.color || '#6b4c9a'}
									>
										{cat.icon || ''}
										{cat.name}
									</span>
								{/if}
							{/if}
						</div>
						<div class="item-meta">
							<span>📦 {item.size}</span>
							{#if item.description}
								<span>📝 {item.description}</span>
							{/if}
							{#if item.filename}
								<span>📝 {item.filename}</span>
							{/if}
							{#if item.configGuide}
								<span>
									🧭 指引
									{item.configGuide.split(/\r?\n/).filter(Boolean).length}
									步
								</span>
							{/if}
							<span>
								🔗
								<!-- eslint-disable svelte/no-navigation-without-resolve -->
								<a
									href={resolveDownloadUrl(item)}
									target="_blank"
									rel="noopener"
									onclick={(event) => event.stopPropagation()}
								>
									{item.url.slice(0, 50)}...
								</a>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							</span>
						</div>
					</div>
					<div class="item-actions">
						<button
							class="btn btn-small"
							class:btn-success={!item.enabled}
							class:btn-warning={item.enabled}
							onclick={() => onToggleEnabled(item)}
						>
							{item.enabled ? '禁用' : '启用'}
						</button>
						<button class="btn btn-small" onclick={() => onEdit(item)}>编辑</button>
						<button class="btn btn-small btn-danger" onclick={() => onDelete(item.id)}>删除</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</section>

<style>
	.list-section {
		max-width: 1000px;
		margin: 0 auto 2rem;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(10px);
		border-radius: 20px;
		padding: 2rem;
		box-shadow: 0 8px 25px rgba(107, 76, 154, 0.12);
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.section-header h2 {
		margin: 0;
		font-family: 'Fredoka', sans-serif;
		color: #6b4c9a;
		font-size: 1.5rem;
	}

	.alert {
		padding: 1rem 1.5rem;
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
		color: #8b7ba8;
		font-size: 1.5rem;
		cursor: pointer;
		padding: 0;
		line-height: 1;
	}

	.loading {
		text-align: center;
		padding: 2rem;
		color: #8b7ba8;
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid rgba(107, 76, 154, 0.2);
		border-top-color: #6b4c9a;
		border-radius: 50%;
		animation: spin 1s linear infinite;
		display: inline-block;
	}

	.spinner.large {
		width: 32px;
		height: 32px;
		border-width: 3px;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.empty-state {
		text-align: center;
		padding: 3rem 2rem;
		color: #8b7ba8;
	}

	.empty-icon {
		font-size: 3rem;
		display: block;
		margin-bottom: 1rem;
	}

	.empty-hint {
		font-size: 0.9rem;
		color: #a89bc4;
		margin-top: 0.5rem;
	}

	.bulk-actions-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 1rem;
		padding: 1rem;
		background: rgba(107, 76, 154, 0.05);
		border-radius: 12px;
		margin-bottom: 1rem;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		color: #6b4c9a;
		font-weight: 500;
	}

	.bulk-action-buttons {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.bulk-category-select {
		padding: 0.4rem 0.8rem;
		border: 2px solid #e6e0f0;
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.85rem;
		background: white;
	}

	.download-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.download-item {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.25rem;
		background: rgba(255, 255, 255, 0.8);
		backdrop-filter: blur(8px);
		border-radius: 14px;
		transition: all 0.3s ease;
		box-shadow: 0 4px 12px rgba(107, 76, 154, 0.06);
	}

	.download-item:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 20px rgba(107, 76, 154, 0.1);
	}

	.download-item.disabled {
		opacity: 0.6;
		background: rgba(200, 200, 200, 0.3);
	}

	.item-checkbox {
		flex-shrink: 0;
	}

	.item-icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.item-info {
		flex: 1;
		min-width: 0;
	}

	.item-title {
		font-weight: 600;
		color: #2d1b4e;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.badge {
		font-size: 0.7rem;
		padding: 0.2rem 0.5rem;
		border-radius: 6px;
		font-weight: 600;
	}

	.badge-link {
		background: rgba(107, 76, 154, 0.1);
		color: #6b4c9a;
	}

	.badge-r2 {
		background: rgba(255, 165, 0, 0.15);
		color: #e67e00;
	}

	.badge-s3 {
		background: rgba(0, 150, 136, 0.15);
		color: #009688;
	}

	.badge-category {
		font-size: 0.7rem;
		padding: 0.15rem 0.5rem;
		border-radius: 6px;
	}

	.item-meta {
		font-size: 0.8rem;
		color: #8b7ba8;
		margin-top: 0.35rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.item-meta a {
		color: #667eea;
		text-decoration: none;
	}

	.item-meta a:hover {
		text-decoration: underline;
	}

	.item-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.btn {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 10px;
		font-family: inherit;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s ease;
	}

	.btn-small {
		padding: 0.4rem 0.8rem;
		font-size: 0.85rem;
	}

	.btn-primary {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
	}

	.btn-success {
		background: rgba(107, 203, 119, 0.2);
		color: #2e8b57;
	}

	.btn-warning {
		background: rgba(255, 193, 7, 0.2);
		color: #b8860b;
	}

	.btn-danger {
		background: rgba(255, 107, 107, 0.15);
		color: #dc3545;
	}

	.btn:hover {
		transform: translateY(-1px);
	}
</style>
