<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { DownloadItem, ApiResponse, Platform, Category } from '$lib/types';
	import { trapFocus, focusFirstElement } from '$lib/utils/a11y';
	import { parseDownloadFileInfo } from '$lib/utils/parseFilename';

	interface Props {
		item: DownloadItem;
		categories: Category[];
		onSave: (item: DownloadItem) => void;
		onClose: () => void;
	}

	let { item, categories, onSave, onClose }: Props = $props();
	let dialogRef = $state<HTMLDivElement | null>(null);
	let closeButtonRef = $state<HTMLButtonElement | null>(null);
	let lastFocusedElement: HTMLElement | null = null;
	const titleId = crypto.randomUUID();
	const errorId = crypto.randomUUID();

	let saving = $state(false);
	let error = $state('');
	let activeItemId = '';
	let saveController: AbortController | null = null;
	let closed = false;

	// 表单状态 - 通过 $effect 初始化以避免警告
	let formPlatform = $state<Platform>('windows');
	let formTitle = $state('');
	let formDescription = $state('');
	let formConfigGuide = $state('');
	let formFilename = $state('');
	let formVersion = $state('');
	let formSize = $state('');
	let formUrl = $state('');
	let formCategoryId = $state<string | undefined>(undefined);
	let formRustDeskEnabled = $state(false);
	let formRustDeskIdServer = $state('');
	let formRustDeskKey = $state('');

	// 当 item 变化时重新初始化表单
	$effect(() => {
		if (activeItemId !== item.id) {
			saveController?.abort();
			saveController = null;
			saving = false;
			error = '';
			closed = false;
			activeItemId = item.id;
		}
		formPlatform = item.platform;
		formTitle = item.title || '';
		formDescription = item.description || '';
		formConfigGuide = item.configGuide || '';
		formFilename = item.filename || '';
		formVersion = item.version;
		formSize = item.size;
		formUrl = item.url || '';
		formCategoryId = item.categoryId;
		formRustDeskEnabled = item.rustdeskConfig?.enabled === true;
		formRustDeskIdServer = item.rustdeskConfig?.idServer || '';
		formRustDeskKey = item.rustdeskConfig?.key || '';
	});

	function handleClose(): void {
		if (closed) return;
		closed = true;
		saveController?.abort();
		saveController = null;
		saving = false;
		onClose();
	}

	onDestroy(() => {
		closed = true;
		saveController?.abort();
	});

	function applyParsedFileInfo(input: string, updateFilename: boolean) {
		const parsed = parseDownloadFileInfo(input);

		if (updateFilename && parsed.filename) {
			formFilename = parsed.filename;
		}
		if (parsed.version) {
			formVersion = parsed.version;
		}
		if (parsed.platform) {
			formPlatform = parsed.platform;
		}
	}

	function handleUrlChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		applyParsedFileInfo(input.value, true);
	}

	function handleFilenameChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		applyParsedFileInfo(input.value, false);
	}

	async function handleSave() {
		if (saving) return;
		if (!formVersion || !formSize) {
			error = '请填写版本和大小';
			return;
		}
		if (!formUrl.trim()) {
			error = '请填写下载地址';
			return;
		}
		if (formRustDeskEnabled && (!formRustDeskIdServer.trim() || !formRustDeskKey.trim())) {
			error = '请填写 RustDesk ID 服务器和 key';
			return;
		}

		const itemId = item.id;
		const controller = new AbortController();
		saveController?.abort();
		saveController = controller;
		saving = true;
		error = '';

		try {
			const payload = {
				id: itemId,
				platform: formPlatform,
				categoryId: formCategoryId || '',
				title: formTitle.trim(),
				description: formDescription.trim(),
				configGuide: formConfigGuide.trim(),
				filename: formFilename.trim(),
				version: formVersion.trim(),
				size: formSize.trim(),
				...(item.storageType === 'r2' ? {} : { url: formUrl.trim() }),
				rustdeskConfig: {
					enabled: formRustDeskEnabled,
					idServer: formRustDeskIdServer.trim(),
					key: formRustDeskKey.trim()
				}
			};

			const res = await fetch('/api/admin', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				signal: controller.signal
			});

			const data: ApiResponse<DownloadItem> = await res.json();
			if (closed || controller.signal.aborted || item.id !== itemId) return;
			if (res.ok && data.success && data.data) {
				onSave(data.data);
				handleClose();
			} else {
				error = data.error || '更新失败';
			}
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			if (!closed && saveController === controller) error = '网络错误';
		} finally {
			if (!closed && saveController === controller) {
				saveController = null;
				saving = false;
			}
		}
	}
	$effect(() => {
		lastFocusedElement =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		void focusFirstElement(dialogRef, closeButtonRef);
		const handleKeydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				handleClose();
			}
		};
		document.addEventListener('keydown', handleKeydown);
		return () => {
			document.removeEventListener('keydown', handleKeydown);
			lastFocusedElement?.focus();
		};
	});
</script>

<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={titleId}>
	<button type="button" class="modal-scrim" onclick={handleClose} aria-label="关闭编辑表单"
	></button>
	<div
		class="modal-card modal-lg"
		bind:this={dialogRef}
		use:trapFocus
		tabindex="-1"
		aria-busy={saving}
		aria-describedby={error ? errorId : undefined}
	>
		<div class="modal-header">
			<h3 id={titleId}>编辑下载项</h3>
			<button
				type="button"
				class="modal-close"
				onclick={handleClose}
				bind:this={closeButtonRef}
				aria-label="关闭编辑表单"
			>
				×
			</button>
		</div>

		{#if error}
			<p class="auth-error" id={errorId} role="alert" aria-live="assertive">{error}</p>
		{/if}

		<div class="auth-form modal-form-grid">
			<div class="form-group full-width">
				<p class="field-hint">
					可修改展示信息和下载地址；外部链接变更后会重新同步 R2
					备份。如需更换存储方式或重新上传文件，请重新添加下载项。
				</p>
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
					placeholder="简短描述这个版本的特性或用途"></textarea>
			</div>

			<div class="form-group full-width">
				<label for="editConfigGuide">配置指引</label>
				<textarea
					id="editConfigGuide"
					bind:value={formConfigGuide}
					placeholder="每行一条步骤，例如：复制 验证码123 或 打开 mumble://xxx"></textarea>
				<p class="field-hint">支持动作：复制 xxx / 打开 mumble://xxx 或 https://</p>
			</div>

			<div class="form-group full-width">
				<label for="editUrl">下载地址</label>
				<input
					id="editUrl"
					type="text"
					bind:value={formUrl}
					oninput={handleUrlChange}
					readonly={item.storageType === 'r2'}
					placeholder="https://example.com/download.exe 或 /api/admin/download/..."
				/>
				<p class="field-hint">
					{item.storageType === 'r2'
						? 'R2 对象路径由上传流程生成且不可编辑；更换文件请重新添加下载项。'
						: '仅支持公网 HTTP(S) 地址；外部链接不可用时可手动选择 R2 备份。'}
				</p>
			</div>

			<div class="form-group">
				<label for="editFilename">文件名</label>
				<input
					id="editFilename"
					type="text"
					bind:value={formFilename}
					oninput={handleFilenameChange}
					placeholder="例如：PlayDota2Win.exe"
				/>
			</div>

			<div class="form-group">
				<label for="editSize">文件大小</label>
				<input id="editSize" type="text" bind:value={formSize} placeholder="45MB" />
			</div>

			<div class="rustdesk-config full-width">
				<label class="checkbox-label" for="editRustdeskEnabled">
					<input id="editRustdeskEnabled" type="checkbox" bind:checked={formRustDeskEnabled} />
					<span>作为 RustDesk 配置接口数据源</span>
				</label>
				<p class="field-hint">
					开启后，公开的 /api/rustdesk 接口会返回此下载项的下载链接、版本号、ID 服务器和
					key，调用时无需授权。
				</p>

				{#if formRustDeskEnabled}
					<div class="rustdesk-grid">
						<div class="form-group">
							<label for="editRustdeskIdServer">RustDesk ID 服务器</label>
							<input
								id="editRustdeskIdServer"
								type="text"
								bind:value={formRustDeskIdServer}
								placeholder="例如：rustdesk.example.com"
							/>
						</div>
						<div class="form-group">
							<label for="editRustdeskKey">RustDesk key</label>
							<input
								id="editRustdeskKey"
								type="text"
								bind:value={formRustDeskKey}
								placeholder="请输入 RustDesk key"
							/>
						</div>
					</div>
				{/if}
			</div>
		</div>

		<div class="modal-footer">
			<button type="button" class="btn btn-secondary" onclick={handleClose}>取消</button>
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
		box-sizing: border-box;
		min-width: 0;
		width: 100%;
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

	.rustdesk-config {
		background: rgba(0, 150, 136, 0.06);
		border: 1px solid rgba(0, 150, 136, 0.12);
		border-radius: 12px;
		padding: 1rem;
	}

	.rustdesk-config.full-width {
		grid-column: 1 / -1;
	}

	.checkbox-label {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 600;
		color: #2f7f77;
		cursor: pointer;
	}

	.checkbox-label input {
		width: 16px;
		height: 16px;
	}

	.rustdesk-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1rem;
		margin-top: 1rem;
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

	@media (max-width: 640px) {
		.modal-backdrop {
			align-items: flex-end;
			padding: 0.5rem;
		}

		.modal-card {
			box-sizing: border-box;
			max-height: calc(100dvh - 1rem);
			padding: 1rem;
		}

		.modal-form-grid,
		.rustdesk-grid {
			grid-template-columns: minmax(0, 1fr);
		}

		.modal-footer {
			flex-wrap: wrap;
		}

		.modal-footer .btn {
			flex: 1;
			justify-content: center;
		}

		.field-hint {
			overflow-wrap: anywhere;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.modal-close,
		.btn {
			transition: none;
		}

		.modal-close:hover,
		.btn-primary:hover:not(:disabled),
		.btn-secondary:hover {
			transform: none;
			box-shadow: none;
		}

		.spinner {
			animation: none;
		}
	}
</style>
