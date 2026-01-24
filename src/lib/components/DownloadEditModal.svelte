<script lang="ts">
	import type { DownloadItem, ApiResponse, Platform, Category } from '$lib/types';

	interface Props {
		item: DownloadItem;
		categories: Category[];
		onSave: (item: DownloadItem) => void;
		onClose: () => void;
	}

	let { item, categories, onSave, onClose }: Props = $props();

	let saving = $state(false);
	let error = $state('');

	// 表单状态 - 通过 $effect 初始化以避免警告
	let formPlatform = $state<Platform>('windows');
	let formTitle = $state('');
	let formDescription = $state('');
	let formConfigGuide = $state('');
	let formFilename = $state('');
	let formVersion = $state('');
	let formSize = $state('');
	let formCategoryId = $state<string | undefined>(undefined);

	// 当 item 变化时重新初始化表单
	$effect(() => {
		formPlatform = item.platform;
		formTitle = item.title || '';
		formDescription = item.description || '';
		formConfigGuide = item.configGuide || '';
		formFilename = item.filename || '';
		formVersion = item.version;
		formSize = item.size;
		formCategoryId = item.categoryId;
	});

	async function handleSave() {
		if (!formVersion || !formSize) {
			error = '请填写版本和大小';
			return;
		}

		saving = true;
		error = '';

		try {
			const token = localStorage.getItem('admin_token');
			const payload = {
				id: item.id,
				platform: formPlatform,
				categoryId: formCategoryId || '',
				title: formTitle.trim(),
				description: formDescription.trim(),
				configGuide: formConfigGuide.trim(),
				filename: formFilename.trim(),
				version: formVersion.trim(),
				size: formSize.trim()
			};

			const res = await fetch('/api/admin', {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {})
				},
				body: JSON.stringify(payload)
			});

			const data: ApiResponse<DownloadItem> = await res.json();
			if (data.success && data.data) {
				onSave(data.data);
				onClose();
			} else {
				error = data.error || '更新失败';
			}
		} catch {
			error = '网络错误';
		} finally {
			saving = false;
		}
	}
</script>

<div class="modal-backdrop" role="dialog" aria-modal="true">
	<button
		type="button"
		class="modal-scrim"
		onclick={onClose}
		onkeydown={(e) => (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') && onClose()}
		aria-label="关闭"
	></button>
	<div class="modal-card modal-lg">
		<div class="modal-header">
			<h3>编辑下载项</h3>
			<button type="button" class="modal-close" onclick={onClose}>×</button>
		</div>

		{#if error}
			<p class="auth-error">{error}</p>
		{/if}

		<div class="auth-form modal-form-grid">
			<div class="form-group full-width">
				<p class="field-hint">仅支持编辑文字信息，存储方式与下载链接请在重新添加时调整。</p>
			</div>
			<div class="form-group">
				<label for="editPlatform">平台</label>
				<select id="editPlatform" bind:value={formPlatform}>
					<option value="windows">🪟 Windows</option>
					<option value="macos">🍎 macOS</option>
					<option value="linux">🐧 Linux</option>
				</select>
			</div>

			<div class="form-group">
				<label for="editVersion">版本号</label>
				<input id="editVersion" type="text" bind:value={formVersion} placeholder="v1.0.0" />
			</div>

			<div class="form-group">
				<label for="editCategory">分类</label>
				<select id="editCategory" bind:value={formCategoryId}>
					<option value={undefined}>无分类</option>
					{#each categories as category (category.id)}
						<option value={category.id}>{category.icon || ''} {category.name}</option>
					{/each}
				</select>
			</div>

			<div class="form-group">
				<label for="editTitle">标题</label>
				<input
					id="editTitle"
					type="text"
					bind:value={formTitle}
					placeholder="例如：PlayDota2Win Windows 稳定版"
				/>
			</div>

			<div class="form-group full-width">
				<label for="editDescription">描述</label>
				<textarea
					id="editDescription"
					bind:value={formDescription}
					placeholder="简短描述这个版本的特性或用途"
				></textarea>
			</div>

			<div class="form-group full-width">
				<label for="editConfigGuide">配置指引</label>
				<textarea
					id="editConfigGuide"
					bind:value={formConfigGuide}
					placeholder="每行一条步骤，例如：复制 验证码123 或 打开 mumble://xxx"
				></textarea>
				<p class="field-hint">支持动作：复制 xxx / 打开 mumble://xxx 或 https://</p>
			</div>

			<div class="form-group">
				<label for="editFilename">文件名</label>
				<input
					id="editFilename"
					type="text"
					bind:value={formFilename}
					placeholder="例如：PlayDota2Win.exe"
				/>
			</div>

			<div class="form-group">
				<label for="editSize">文件大小</label>
				<input id="editSize" type="text" bind:value={formSize} placeholder="45MB" />
			</div>
		</div>

		<div class="modal-footer">
			<button type="button" class="btn btn-secondary" onclick={onClose}>取消</button>
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
		grid-template-columns: repeat(2, 1fr);
		gap: 1rem;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.form-group.full-width {
		grid-column: 1 / -1;
	}

	.form-group label {
		font-weight: 600;
		color: #6b4c9a;
		font-size: 0.9rem;
	}

	.form-group input,
	.form-group select,
	.form-group textarea {
		padding: 0.75rem 1rem;
		border: 2px solid #e6e0f0;
		border-radius: 12px;
		font-size: 1rem;
		font-family: inherit;
		transition: all 0.3s ease;
	}

	.form-group input:focus,
	.form-group select:focus,
	.form-group textarea:focus {
		outline: none;
		border-color: #6b4c9a;
		box-shadow: 0 0 0 3px rgba(107, 76, 154, 0.15);
	}

	.form-group textarea {
		min-height: 80px;
		resize: vertical;
	}

	.field-hint {
		font-size: 0.8rem;
		color: #a89bc4;
		margin: 0;
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

	.btn-primary {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
	}

	.btn-primary:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 8px 20px rgba(102, 126, 234, 0.35);
	}

	.btn-secondary {
		background: rgba(107, 76, 154, 0.1);
		color: #6b4c9a;
	}

	.btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
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
