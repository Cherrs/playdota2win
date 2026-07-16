<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import type { ApiResponse, DownloadItem, Platform, StorageType, Category } from '$lib/types';

	interface Props {
		downloads: DownloadItem[];
		categories: Category[];
		loading: boolean;
		onEdit: (item: DownloadItem) => void;
		onToggleEnabled: (item: DownloadItem) => void;
		onDelete: (id: string) => void;
		onReload: (options?: { silent?: boolean }) => Promise<DownloadItem[] | undefined>;
	}

	interface SyncDownloadsResult {
		completed?: number;
		ready?: number;
		failed?: number;
		skipped?: number;
		total?: number;
	}

	interface BulkMutationResult {
		updated?: DownloadItem[];
		deletedIds?: string[];
	}

	let { downloads, categories, loading, onEdit, onToggleEnabled, onDelete, onReload }: Props =
		$props();

	let error = $state('');
	let success = $state('');
	let syncingLinks = $state(false);
	let bulkUpdating = $state(false);
	let showBulkActions = $state(false);
	let selectedIds = new SvelteSet<string>();
	let linkDownloadCount = $derived(downloads.filter((item) => item.storageType === 'link').length);

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

	function getR2BackupLabel(item: DownloadItem): string {
		switch (item.r2Backup?.status) {
			case 'pending':
				return 'R2 等待同步';
			case 'syncing':
				return 'R2 同步中';
			case 'ready':
				return item.r2Backup.error ? 'R2 已备份（刷新失败）' : 'R2 已备份';
			case 'failed':
				return 'R2 同步失败';
			default:
				return 'R2 未备份';
		}
	}

	function getBriefBackupError(message: string): string {
		const compact = message.replace(/\s+/g, ' ').trim();
		return compact.length > 72 ? `${compact.slice(0, 72)}…` : compact;
	}

	async function handleSyncLinks() {
		if (linkDownloadCount === 0 || syncingLinks) return;

		syncingLinks = true;
		error = '';
		success = '';

		try {
			const links = downloads.filter((item) => item.storageType === 'link');
			let nextIndex = 0;
			let ready = 0;
			let failed = 0;
			const failures: string[] = [];

			async function worker() {
				while (nextIndex < links.length) {
					const item = links[nextIndex++];
					try {
						const res = await fetch('/api/admin/downloads/sync', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ itemId: item.id })
						});
						const data: ApiResponse<SyncDownloadsResult> = await res.json();
						if (!res.ok || !data.success) throw new Error(data.error || '同步失败');
						ready += data.data?.ready ?? 0;
						failed += data.data?.failed ?? 0;
						if ((data.data?.failed ?? 0) > 0) {
							failures.push(`${item.title || item.filename || item.id} 同步失败`);
						}
					} catch (caught) {
						failed += 1;
						failures.push(caught instanceof Error ? caught.message : '同步失败');
					}
				}
			}

			await Promise.all(Array.from({ length: Math.min(3, links.length) }, () => worker()));
			await onReload({ silent: true });
			if (ready > 0) {
				success = `R2 同步完成：成功 ${ready} 个。`;
			} else {
				success = '';
			}
			if (failed > 0) {
				const firstFailure = failures[0];
				error = `R2 同步完成：失败 ${failed} 个。${firstFailure ? ` ${getBriefBackupError(firstFailure)}` : ''}`;
			}
		} catch (caught) {
			error = caught instanceof Error ? caught.message : '同步失败';
		} finally {
			syncingLinks = false;
		}
	}

	// 批量操作：全选/取消全选
	function toggleSelectAll() {
		if (bulkUpdating) return;
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
		if (bulkUpdating) return;
		if (selectedIds.size === 0) {
			error = '请先选择要移动的下载项';
			return;
		}

		bulkUpdating = true;
		error = '';
		success = '';
		const itemIds = [...selectedIds];

		try {
			const selectedItems = itemIds.map((itemId) => downloads.find((item) => item.id === itemId));
			if (selectedItems.some((item) => !item)) {
				throw new Error('部分下载项已不存在，请刷新列表后重试');
			}

			const response = await fetch('/api/admin', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					updates: selectedItems.map((item) => ({
						id: item!.id,
						categoryId
					}))
				})
			});
			const data: ApiResponse<BulkMutationResult> = await response.json();
			if (!response.ok || !data.success) {
				throw new Error(data.error || `批量移动失败（HTTP ${response.status}）`);
			}
			const updatedIds = new Set(data.data?.updated?.map((item) => item.id) || []);
			if (itemIds.some((itemId) => !updatedIds.has(itemId))) {
				throw new Error('服务器返回的批量移动结果不完整，请刷新确认');
			}

			success = `成功移动 ${itemIds.length} 个下载项。`;
			selectedIds.clear();
			showBulkActions = false;
			await onReload();
		} catch (caught) {
			error = caught instanceof Error ? `批量移动失败：${caught.message}` : '批量移动失败';
		} finally {
			bulkUpdating = false;
		}
	}

	// 批量操作：删除
	async function handleBulkDelete() {
		if (bulkUpdating) return;
		if (selectedIds.size === 0) {
			error = '请先选择要删除的下载项';
			return;
		}

		const itemIds = [...selectedIds];
		if (!confirm(`确定要删除选中的 ${itemIds.length} 个下载项吗？`)) return;

		bulkUpdating = true;
		error = '';
		success = '';

		try {
			const response = await fetch('/api/admin', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids: itemIds })
			});
			const data: ApiResponse<BulkMutationResult> = await response.json();
			if (!response.ok || !data.success) {
				throw new Error(data.error || `批量删除失败（HTTP ${response.status}）`);
			}
			const deletedIds = new Set(data.data?.deletedIds || []);
			if (itemIds.some((itemId) => !deletedIds.has(itemId))) {
				throw new Error('服务器返回的批量删除结果不完整，请刷新确认');
			}

			success = `成功删除 ${itemIds.length} 个下载项。`;
			selectedIds.clear();
			showBulkActions = false;
			await onReload();
		} catch (caught) {
			error = caught instanceof Error ? `批量删除失败：${caught.message}` : '批量删除失败';
		} finally {
			bulkUpdating = false;
		}
	}
</script>

<section class="list-section">
	<div class="section-header">
		<h2>📋 下载列表</h2>
		{#if downloads.length > 0}
			<div class="section-header-actions">
				<button
					class="btn btn-small btn-sync"
					type="button"
					onclick={handleSyncLinks}
					disabled={syncingLinks || linkDownloadCount === 0}
					title={linkDownloadCount === 0 ? '没有可同步的外部链接' : '将所有外部链接备份到 R2'}
				>
					{#if syncingLinks}
						<span class="button-spinner" aria-hidden="true"></span>
						正在同步...
					{:else}
						☁️ 同步到 R2 ({linkDownloadCount})
					{/if}
				</button>
				<button
					class="btn btn-small"
					class:btn-primary={!showBulkActions}
					type="button"
					onclick={() => {
						showBulkActions = !showBulkActions;
						if (!showBulkActions) {
							selectedIds.clear();
						}
					}}
				>
					{showBulkActions ? '取消批量操作' : '批量操作'}
				</button>
			</div>
		{/if}
	</div>

	{#if error}
		<div class="alert alert-error" role="alert">
			<span>❌</span>
			{error}
			<button
				class="alert-close"
				type="button"
				aria-label="关闭错误提示"
				onclick={() => (error = '')}>×</button
			>
		</div>
	{/if}

	{#if success}
		<div class="alert alert-success" role="status" aria-live="polite">
			<span>✅</span>
			{success}
			<button
				class="alert-close"
				type="button"
				aria-label="关闭成功提示"
				onclick={() => (success = '')}>×</button
			>
		</div>
	{/if}

	{#if showBulkActions && downloads.length > 0}
		<div class="bulk-actions-bar">
			<label class="checkbox-label">
				<input
					type="checkbox"
					checked={selectedIds.size === downloads.length}
					disabled={bulkUpdating}
					onchange={toggleSelectAll}
				/>
				<span>全选 ({selectedIds.size} / {downloads.length})</span>
			</label>

			{#if selectedIds.size > 0}
				<div class="bulk-action-buttons">
					<select
						class="bulk-category-select"
						disabled={bulkUpdating}
						aria-label="批量移动到分类"
						onchange={(e) => {
							const select = e.target as HTMLSelectElement;
							if (!select.value) return;
							const value = select.value === '__none__' ? null : select.value;
							void handleBulkMoveToCategory(value);
							select.value = '';
						}}
					>
						<option value="">移动到分类...</option>
						<option value="__none__">（无分类）</option>
						{#each categories as category (category.id)}
							<option value={category.id}>{category.icon || ''} {category.name}</option>
						{/each}
					</select>
					<button
						class="btn btn-small btn-danger"
						type="button"
						onclick={handleBulkDelete}
						disabled={bulkUpdating}
					>
						{bulkUpdating ? '处理中...' : `删除选中 (${selectedIds.size})`}
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
								disabled={bulkUpdating}
								aria-label={`选择 ${item.title || item.filename || item.version}`}
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
							{#if item.storageType === 'link'}
								<span
									class="badge badge-backup badge-backup-{item.r2Backup?.status || 'missing'}"
									title={item.r2Backup?.error || getR2BackupLabel(item)}
								>
									{#if item.r2Backup?.status === 'pending' || item.r2Backup?.status === 'syncing'}
										<span class="backup-spinner" aria-hidden="true"></span>
									{/if}
									{getR2BackupLabel(item)}
								</span>
							{/if}
							{#if item.rustdeskConfig?.enabled}
								<span class="badge badge-rustdesk">RustDesk 接口</span>
							{/if}
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
								<a
									href={resolveDownloadUrl(item)}
									target="_blank"
									rel="noopener"
									onclick={(event) => event.stopPropagation()}
								>
									{item.url.slice(0, 50)}...
								</a>
							</span>
							{#if item.storageType === 'link' && item.r2Backup?.error}
								<span class="backup-error" title={item.r2Backup.error}>
									⚠️ R2：{getBriefBackupError(item.r2Backup.error)}
								</span>
							{/if}
						</div>
					</div>
					<div class="item-actions">
						<button
							class="btn btn-small"
							class:btn-success={!item.enabled}
							class:btn-warning={item.enabled}
							type="button"
							onclick={() => onToggleEnabled(item)}
						>
							{item.enabled ? '禁用' : '启用'}
						</button>
						<button class="btn btn-small" type="button" onclick={() => onEdit(item)}>编辑</button>
						<button class="btn btn-small btn-danger" type="button" onclick={() => onDelete(item.id)}
							>删除</button
						>
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

	.section-header-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.alert {
		padding: 1rem 1.5rem;
		border-radius: 12px;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
		overflow-wrap: anywhere;
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
		flex-wrap: wrap;
		min-width: 0;
	}

	.bulk-category-select {
		padding: 0.4rem 0.8rem;
		border: 2px solid #e6e0f0;
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.85rem;
		background: white;
		max-width: 100%;
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
		overflow-wrap: anywhere;
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

	.badge-rustdesk {
		background: rgba(0, 150, 136, 0.12);
		color: #16847b;
	}

	.badge-backup {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.badge-backup-missing {
		background: rgba(139, 123, 168, 0.1);
		color: #77698f;
	}

	.badge-backup-pending,
	.badge-backup-syncing {
		background: rgba(255, 193, 7, 0.16);
		color: #9b6c00;
	}

	.badge-backup-ready {
		background: rgba(76, 175, 80, 0.14);
		color: #287d3c;
	}

	.badge-backup-failed {
		background: rgba(220, 53, 69, 0.12);
		color: #b72d3b;
	}

	.backup-spinner,
	.button-spinner {
		display: inline-block;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.backup-spinner {
		width: 8px;
		height: 8px;
		border: 1.5px solid rgba(155, 108, 0, 0.25);
		border-top-color: currentColor;
	}

	.button-spinner {
		width: 12px;
		height: 12px;
		border: 2px solid rgba(255, 255, 255, 0.35);
		border-top-color: currentColor;
	}

	.item-meta {
		font-size: 0.8rem;
		color: #8b7ba8;
		margin-top: 0.35rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		overflow-wrap: anywhere;
	}

	.item-meta a {
		color: #667eea;
		text-decoration: none;
	}

	.item-meta a:hover {
		text-decoration: underline;
	}

	.backup-error {
		flex-basis: 100%;
		color: #b72d3b;
		line-height: 1.4;
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

	.btn-sync {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		background: linear-gradient(135deg, #5f8ee6 0%, #7568c8 100%);
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

	.btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		transform: none;
	}

	.btn:focus-visible {
		outline: 3px solid rgba(102, 126, 234, 0.28);
		outline-offset: 2px;
	}

	@media (max-width: 640px) {
		.list-section {
			padding: 1rem;
			border-radius: 16px;
		}

		.section-header {
			align-items: flex-start;
			flex-direction: column;
		}

		.section-header-actions {
			width: 100%;
			justify-content: flex-start;
		}

		.bulk-actions-bar,
		.bulk-action-buttons {
			align-items: stretch;
			flex-direction: column;
			width: 100%;
		}

		.bulk-category-select,
		.bulk-action-buttons .btn {
			box-sizing: border-box;
			width: 100%;
		}

		.download-item {
			align-items: flex-start;
			flex-wrap: wrap;
			padding: 0.9rem;
		}

		.item-info {
			flex: 1 1 calc(100% - 4.5rem);
		}

		.item-actions {
			width: 100%;
			flex-wrap: wrap;
		}

		.item-actions .btn {
			flex: 1 1 5rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.backup-spinner,
		.button-spinner {
			animation: none;
		}

		.download-item,
		.btn {
			transition: none;
		}

		.download-item:hover,
		.btn:hover {
			transform: none;
			box-shadow: none;
		}
	}
</style>
