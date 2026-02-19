<script lang="ts">
	import type { Category, ApiResponse } from '$lib/types';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import ColorPicker from '$lib/components/ColorPicker.svelte';
	import DraggableList from '$lib/components/DraggableList.svelte';
	import { trapFocus, focusFirstElement } from '$lib/utils/a11y';

	interface Props {
		categories: Category[];
		downloads: { categoryId?: string; enabled: boolean }[];
		onCategoriesChange: (categories: Category[]) => void;
		onReloadDownloads: () => void;
	}

	let {
		categories = $bindable(),
		downloads,
		onCategoriesChange,
		onReloadDownloads
	}: Props = $props();

	let loading = $state(false);
	let saving = $state(false);
	let error = $state('');
	let success = $state('');
	let showForm = $state(false);
	let editingId = $state<string | null>(null);
	let formName = $state('');
	let formIcon = $state('');
	let formColor = $state('');
	let formDescription = $state('');
	let formOrder = $state(0);
	let showEmojiPicker = $state(false);
	let showColorPicker = $state(false);
	let dialogRef = $state<HTMLDivElement | null>(null);
	let closeButtonRef = $state<HTMLButtonElement | null>(null);
	let lastFocusedElement: HTMLElement | null = null;
	const titleId = crypto.randomUUID();
	const errorId = crypto.randomUUID();

	// 计算每个分类的下载数量
	function getCategoryDownloadCount(categoryId: string): number {
		return downloads.filter((d) => d.enabled && d.categoryId === categoryId).length;
	}

	// 打开分类表单
	function openForm(category?: Category) {
		if (category) {
			editingId = category.id;
			formName = category.name;
			formIcon = category.icon || '';
			formColor = category.color || '';
			formDescription = category.description || '';
			formOrder = category.order;
		} else {
			editingId = null;
			formName = '';
			formIcon = '';
			formColor = '';
			formDescription = '';
			formOrder = categories.length;
		}
		showForm = true;
		showEmojiPicker = false;
		showColorPicker = false;
		success = '';
		error = '';
	}

	function closeForm() {
		showForm = false;
		editingId = null;
		formName = '';
		formIcon = '';
		formColor = '';
		formDescription = '';
		formOrder = 0;
		showEmojiPicker = false;
		showColorPicker = false;
	}

	$effect(() => {
		if (!showForm) return;
		lastFocusedElement =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		void focusFirstElement(dialogRef, closeButtonRef);
		const handleKeydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				closeForm();
			}
		};
		document.addEventListener('keydown', handleKeydown);
		return () => {
			document.removeEventListener('keydown', handleKeydown);
			lastFocusedElement?.focus();
		};
	});

	// 保存分类
	async function handleSave() {
		if (!formName.trim()) {
			error = '请输入分类名称';
			return;
		}

		saving = true;
		error = '';

		try {
			const token = localStorage.getItem('admin_token');
			const method = editingId ? 'PUT' : 'POST';
			const body = editingId
				? JSON.stringify({
						id: editingId,
						name: formName.trim(),
						icon: formIcon.trim() || undefined,
						color: formColor.trim() || undefined,
						description: formDescription.trim() || undefined,
						order: formOrder
					})
				: JSON.stringify({
						name: formName.trim(),
						icon: formIcon.trim() || undefined,
						color: formColor.trim() || undefined,
						description: formDescription.trim() || undefined,
						order: formOrder
					});

			const res = await fetch('/api/admin/categories', {
				method,
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {})
				},
				body
			});

			const data: ApiResponse<Category> = await res.json();
			if (data.success && data.data) {
				if (editingId) {
					categories = categories.map((c) => (c.id === editingId ? data.data! : c));
					success = '更新成功！';
				} else {
					categories = [...categories, data.data];
					success = '添加成功！';
				}
				onCategoriesChange(categories);
				closeForm();
				await loadCategories();
			} else {
				error = data.error || '保存失败';
			}
		} catch {
			error = '网络错误';
		} finally {
			saving = false;
		}
	}

	// 删除分类
	async function handleDelete(id: string) {
		const itemsInCategory = downloads.filter((d) => d.categoryId === id);
		const confirmMsg =
			itemsInCategory.length > 0
				? `该分类下有 ${itemsInCategory.length} 个下载项，确定要删除吗？删除后这些下载项将变为无分类。`
				: '确定要删除这个分类吗？';

		if (!confirm(confirmMsg)) return;

		try {
			const token = localStorage.getItem('admin_token');
			const res = await fetch('/api/admin/categories', {
				method: 'DELETE',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {})
				},
				body: JSON.stringify({ id })
			});

			const data: ApiResponse = await res.json();
			if (data.success) {
				categories = categories.filter((c) => c.id !== id);
				onCategoriesChange(categories);
				success = '删除成功！';
				if (itemsInCategory.length > 0) {
					onReloadDownloads();
				}
			} else {
				error = data.error || '删除失败';
			}
		} catch {
			error = '网络错误';
		}
	}

	// 处理分类拖放排序
	async function handleReorder(reorderedCategories: Category[]) {
		categories = reorderedCategories;
		onCategoriesChange(categories);

		try {
			const token = localStorage.getItem('admin_token');
			for (const category of reorderedCategories) {
				await fetch('/api/admin/categories', {
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json',
						...(token ? { Authorization: `Bearer ${token}` } : {})
					},
					body: JSON.stringify({
						id: category.id,
						name: category.name,
						icon: category.icon,
						color: category.color,
						description: category.description,
						order: category.order
					})
				});
			}
			success = '排序已更新！';
		} catch {
			error = '更新排序失败';
		}
	}

	// 加载分类列表
	async function loadCategories() {
		loading = true;
		error = '';
		try {
			const token = localStorage.getItem('admin_token');
			const res = await fetch('/api/admin/categories', {
				headers: { Authorization: `Bearer ${token}` }
			});
			const data: ApiResponse<{ items: Category[] }> = await res.json();
			if (data.success && data.data) {
				categories = data.data.items;
				onCategoriesChange(categories);
			} else {
				error = data.error || '加载分类失败';
			}
		} catch {
			error = '网络错误';
		} finally {
			loading = false;
		}
	}
</script>

<section class="form-section">
	<div class="section-header">
		<h2>🗂️ 分类管理</h2>
		<button class="btn btn-primary btn-small" onclick={() => openForm()}>+ 添加分类</button>
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

	{#if loading}
		<div class="loading">
			<div class="spinner large"></div>
			<p>加载中...</p>
		</div>
	{:else if categories.length === 0}
		<div class="empty-state">
			<span class="empty-icon">📂</span>
			<p>暂无分类</p>
			<p class="empty-hint">点击上方按钮添加第一个分类～</p>
		</div>
	{:else}
		<DraggableList items={categories} onreorder={handleReorder}>
			{#snippet children(category: Category)}
				<div class="category-icon-wrapper">
					{#if category.color}
						<div class="category-color-dot" style:background-color={category.color}></div>
					{/if}
					<div class="category-icon">{category.icon || '📁'}</div>
				</div>
				<div class="category-info">
					<div class="category-name-row">
						<span class="category-name">{category.name}</span>
						<span class="category-count-badge">{getCategoryDownloadCount(category.id)}</span>
					</div>
					{#if category.description}
						<div class="category-desc">{category.description}</div>
					{/if}
					<div class="category-meta">
						排序: {category.order}
						{#if category.color}
							<span class="color-preview" style:background-color={category.color}
								>{category.color}</span
							>
						{/if}
					</div>
				</div>
				<div class="category-actions">
					<button class="btn btn-small" onclick={() => openForm(category)}>编辑</button>
					<button class="btn btn-small btn-danger" onclick={() => handleDelete(category.id)}>
						删除
					</button>
				</div>
			{/snippet}
		</DraggableList>
	{/if}
</section>

{#if showForm}
	<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={titleId}>
		<button type="button" class="modal-scrim" onclick={closeForm} aria-label="关闭"></button>
		<div class="modal-card modal-lg" bind:this={dialogRef} use:trapFocus tabindex="-1">
			<div class="modal-header">
				<h3 id={titleId}>{editingId ? '编辑分类' : '添加分类'}</h3>
				<button type="button" class="modal-close" onclick={closeForm} bind:this={closeButtonRef}>
					×
				</button>
			</div>

			{#if error}
				<p class="auth-error" id={errorId} role="alert" aria-live="assertive">{error}</p>
			{/if}

			<div class="auth-form modal-form-grid">
				<div class="form-group">
					<label for="categoryName">分类名称</label>
					<input id="categoryName" type="text" bind:value={formName} placeholder="例如：工具" />
				</div>

				<div class="form-group">
					<label for="categoryDesc">描述（可选）</label>
					<textarea
						id="categoryDesc"
						bind:value={formDescription}
						placeholder="简单描述这个分类"
						rows="2"
					></textarea>
				</div>

				<div class="form-group">
					<label for="categoryIcon">图标（emoji）</label>
					<div class="icon-input-group">
						<input
							id="categoryIcon"
							type="text"
							bind:value={formIcon}
							placeholder="🔧"
							readonly
							onclick={() => (showEmojiPicker = !showEmojiPicker)}
						/>
						<button
							type="button"
							class="btn btn-small"
							onclick={() => (showEmojiPicker = !showEmojiPicker)}
						>
							{showEmojiPicker ? '收起' : '选择'}
						</button>
					</div>
					{#if showEmojiPicker}
						<div class="picker-container">
							<EmojiPicker
								value={formIcon}
								onselect={(emoji) => {
									formIcon = emoji;
									showEmojiPicker = false;
								}}
							/>
						</div>
					{/if}
				</div>

				<div class="form-group">
					<label for="categoryColor">分类颜色（可选）</label>
					<div class="color-input-group">
						<input
							id="categoryColor"
							type="text"
							bind:value={formColor}
							placeholder="#667EEA"
							readonly
							onclick={() => (showColorPicker = !showColorPicker)}
						/>
						<button
							type="button"
							class="btn btn-small"
							onclick={() => (showColorPicker = !showColorPicker)}
						>
							{showColorPicker ? '收起' : '选择'}
						</button>
						{#if formColor}
							<div class="color-indicator" style:background-color={formColor}></div>
						{/if}
					</div>
					{#if showColorPicker}
						<div class="picker-container">
							<ColorPicker
								value={formColor}
								onselect={(color) => {
									formColor = color;
								}}
							/>
						</div>
					{/if}
				</div>

				<div class="form-group">
					<label for="categoryOrder">排序</label>
					<input id="categoryOrder" type="number" bind:value={formOrder} placeholder="0" />
					<p class="field-hint">数字越小越靠前，支持拖放排序</p>
				</div>
			</div>

			<div class="modal-footer">
				<button type="button" class="btn btn-secondary" onclick={closeForm}>取消</button>
				<button type="button" class="btn btn-primary" onclick={handleSave} disabled={saving}>
					{#if saving}
						<span class="spinner"></span> 保存中...
					{:else}
						保存
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.form-section {
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

	.category-icon-wrapper {
		position: relative;
		flex-shrink: 0;
	}

	.category-color-dot {
		position: absolute;
		top: -4px;
		right: -4px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid white;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	.category-icon {
		font-size: 1.5rem;
	}

	.category-info {
		flex: 1;
		min-width: 0;
	}

	.category-name-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.category-name {
		font-weight: 600;
		color: #2d1b4e;
	}

	.category-count-badge {
		background: rgba(107, 76, 154, 0.1);
		color: #6b4c9a;
		font-size: 0.75rem;
		padding: 0.15rem 0.5rem;
		border-radius: 10px;
		font-weight: 600;
	}

	.category-desc {
		font-size: 0.85rem;
		color: #8b7ba8;
		margin-top: 0.25rem;
	}

	.category-meta {
		font-size: 0.75rem;
		color: #a89bc4;
		margin-top: 0.25rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.color-preview {
		display: inline-block;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		font-size: 0.7rem;
		color: white;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
	}

	.category-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.btn {
		padding: 0.6rem 1.2rem;
		border: none;
		border-radius: 12px;
		font-family: inherit;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s ease;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.btn-small {
		padding: 0.4rem 0.8rem;
		font-size: 0.85rem;
	}

	.btn-primary {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
	}

	.btn-primary:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 20px rgba(102, 126, 234, 0.35);
	}

	.btn-secondary {
		background: rgba(107, 76, 154, 0.1);
		color: #6b4c9a;
	}

	.btn-danger {
		background: rgba(255, 107, 107, 0.15);
		color: #dc3545;
	}

	.btn-danger:hover {
		background: rgba(255, 107, 107, 0.25);
	}

	.btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	/* Modal */
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
		z-index: 100;
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
		max-width: 500px;
		background: rgba(255, 255, 255, 0.98);
		border-radius: 20px;
		padding: 1.5rem;
		box-shadow: 0 20px 50px rgba(107, 76, 154, 0.25);
		position: relative;
		z-index: 1;
		max-height: 90vh;
		overflow-y: auto;
	}

	.modal-lg {
		max-width: 600px;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.modal-header h3 {
		margin: 0;
		font-family: 'Fredoka', sans-serif;
		color: #6b4c9a;
		font-size: 1.3rem;
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
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}

	.auth-error {
		color: #dc3545;
		font-size: 0.9rem;
		margin: 0 0 1rem;
	}

	.auth-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.modal-form-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.form-group label {
		font-weight: 600;
		color: #6b4c9a;
		font-size: 0.9rem;
	}

	.form-group input,
	.form-group textarea {
		padding: 0.75rem 1rem;
		border: 2px solid #e6e0f0;
		border-radius: 12px;
		font-size: 1rem;
		font-family: inherit;
		transition: all 0.3s ease;
	}

	.form-group input:focus,
	.form-group textarea:focus {
		outline: none;
		border-color: #6b4c9a;
		box-shadow: 0 0 0 3px rgba(107, 76, 154, 0.15);
	}

	.field-hint {
		font-size: 0.8rem;
		color: #a89bc4;
		margin: 0;
	}

	.icon-input-group,
	.color-input-group {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.icon-input-group input,
	.color-input-group input {
		flex: 1;
	}

	.color-indicator {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		border: 2px solid white;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.picker-container {
		margin-top: 0.5rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.btn,
		.modal-close {
			transition: none;
		}

		.btn:hover,
		.modal-close:hover {
			transform: none;
			box-shadow: none;
		}

		.spinner {
			animation: none;
		}
	}
</style>
