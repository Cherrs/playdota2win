<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { DownloadItem, ApiResponse, Platform, StorageType, Category } from '$lib/types';
	import { MAX_ADMIN_R2_UPLOAD_BYTES, formatMiB } from '$lib/upload-limits';
	import { parseDownloadFileInfo } from '$lib/utils/parseFilename';
	import { normalizePublicHttpsUrl } from '$lib/utils/public-url';

	interface Props {
		categories: Category[];
		onAdd: (item: DownloadItem) => void;
	}

	let { categories, onAdd }: Props = $props();

	let saving = $state(false);
	let error = $state('');
	let success = $state('');

	// 表单状态
	let formPlatform = $state<Platform>('windows');
	let formTitle = $state('');
	let formDescription = $state('');
	let formConfigGuide = $state('');
	let formFilename = $state('');
	let formVersion = $state('v1.0.0');
	let formSize = $state('');
	let formStorageType = $state<StorageType>('link');
	let formUrl = $state('');
	let formFile = $state<File | null>(null);
	let formS3PresignedUrl = $state('');
	let formS3PublicUrl = $state('');
	let formCategoryId = $state<string | undefined>(undefined);
	let formRustDeskEnabled = $state(false);
	let formRustDeskIdServer = $state('');
	let formRustDeskKey = $state('');
	let fileInputRef = $state<HTMLInputElement | null>(null);
	let submitController: AbortController | null = null;
	let submitRunId = 0;

	onDestroy(() => {
		submitRunId += 1;
		submitController?.abort();
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

	// 处理 URL 或文件名输入变化，自动提取文件名、版本号和平台
	function handleUrlChange(event: Event) {
		if (formStorageType === 'link') {
			const input = event.currentTarget as HTMLInputElement;
			applyParsedFileInfo(input.value, true);
		}
	}

	function handleFilenameChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		applyParsedFileInfo(input.value, false);
	}

	function clearFormFields(): void {
		formPlatform = 'windows';
		formTitle = '';
		formDescription = '';
		formConfigGuide = '';
		formFilename = '';
		formVersion = 'v1.0.0';
		formSize = '';
		formStorageType = 'link';
		formUrl = '';
		formFile = null;
		formS3PresignedUrl = '';
		formS3PublicUrl = '';
		formCategoryId = undefined;
		formRustDeskEnabled = false;
		formRustDeskIdServer = '';
		formRustDeskKey = '';
		if (fileInputRef) fileInputRef.value = '';
	}

	// 重置表单，并使仍在途的保存响应失效。
	function resetForm() {
		submitRunId += 1;
		submitController?.abort();
		submitController = null;
		saving = false;
		clearFormFields();
		error = '';
		success = '';
	}

	// 文件选择处理
	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files && input.files[0]) {
			formFile = input.files[0];
			if (!formFilename) {
				formFilename = input.files[0].name;
			}
			applyParsedFileInfo(input.files[0].name, false);
			const sizeMB = (input.files[0].size / (1024 * 1024)).toFixed(1);
			formSize = `${sizeMB}MB`;
		}
	}

	// 添加下载项
	async function handleAdd() {
		if (saving) return;
		if (!formVersion || !formSize) {
			error = '请填写版本和大小';
			return;
		}
		if (
			formVersion.length > 128 ||
			formSize.length > 128 ||
			formTitle.length > 200 ||
			formDescription.length > 4000 ||
			formConfigGuide.length > 20_000 ||
			formFilename.length > 512
		) {
			error = '表单字段过长，请缩短后重试';
			return;
		}
		if (formRustDeskEnabled && (!formRustDeskIdServer.trim() || !formRustDeskKey.trim())) {
			error = '请填写 RustDesk ID 服务器和 key';
			return;
		}
		if (formRustDeskIdServer.length > 255 || formRustDeskKey.length > 4096) {
			error = 'RustDesk 配置字段过长';
			return;
		}
		const submittedPlatform = formPlatform;
		const submittedStorageType = formStorageType;
		const submittedFile = formFile;
		const submittedFilename = formFilename;
		const submittedUrl = formUrl;
		const submittedTitle = formTitle;
		const submittedDescription = formDescription;
		const submittedConfigGuide = formConfigGuide;
		const submittedVersion = formVersion;
		const submittedSize = formSize;
		const submittedCategoryId = formCategoryId;
		const submittedRustDeskEnabled = formRustDeskEnabled;
		const submittedRustDeskIdServer = formRustDeskIdServer;
		const submittedRustDeskKey = formRustDeskKey;
		const submittedS3PresignedUrl = formS3PresignedUrl;
		const submittedS3PublicUrl = formS3PublicUrl;

		const runId = ++submitRunId;
		const controller = new AbortController();
		submitController = controller;
		saving = true;
		error = '';
		success = '';

		try {
			let downloadUrl: string;
			if (submittedStorageType === 'link') {
				if (!submittedUrl) {
					error = '请填写下载链接';
					return;
				}
				downloadUrl = submittedUrl;
			} else {
				if (!submittedFile) {
					error = '请选择文件';
					return;
				}
				if (submittedFile.size <= 0) {
					error = '文件不能为空';
					return;
				}
				const uploadFilename = submittedFilename.trim() || submittedFile.name;

				if (submittedStorageType === 'r2') {
					if (submittedFile.size > MAX_ADMIN_R2_UPLOAD_BYTES) {
						error = `R2 上传不能超过 ${formatMiB(MAX_ADMIN_R2_UPLOAD_BYTES)}`;
						return;
					}
					const params = new URLSearchParams({
						platform: submittedPlatform,
						filename: uploadFilename
					});
					const uploadResponse = await fetch(`/api/admin/uploads?${params}`, {
						method: 'PUT',
						headers: {
							'Content-Type': submittedFile.type || 'application/octet-stream'
						},
						body: submittedFile,
						signal: controller.signal
					});
					const uploadData = (await uploadResponse.json()) as ApiResponse<{ url: string }>;
					if (!uploadResponse.ok || !uploadData.success || !uploadData.data?.url) {
						error = uploadData.error || 'R2 上传失败';
						return;
					}
					downloadUrl = uploadData.data.url;
				} else {
					if (!submittedS3PresignedUrl || !submittedS3PublicUrl) {
						error = '请填写预签名上传 URL 和公开下载 URL';
						return;
					}
					let presignedUrl: string;
					let publicUrl: string;
					try {
						presignedUrl = normalizePublicHttpsUrl(submittedS3PresignedUrl);
						publicUrl = normalizePublicHttpsUrl(submittedS3PublicUrl);
					} catch (validationError) {
						error = validationError instanceof Error ? validationError.message : 'S3 URL 无效';
						return;
					}
					const uploadResponse = await fetch(presignedUrl, {
						method: 'PUT',
						headers: {
							'Content-Type': submittedFile.type || 'application/octet-stream'
						},
						body: submittedFile,
						signal: controller.signal
					});
					if (!uploadResponse.ok) {
						error = `S3 上传失败（HTTP ${uploadResponse.status}）`;
						return;
					}
					downloadUrl = publicUrl;
				}
			}

			const metadata = {
				platform: submittedPlatform,
				title: submittedTitle || undefined,
				description: submittedDescription || undefined,
				configGuide: submittedConfigGuide || undefined,
				filename: submittedFilename || submittedFile?.name || undefined,
				version: submittedVersion,
				size: submittedSize,
				storageType: submittedStorageType,
				url: downloadUrl,
				categoryId: submittedCategoryId,
				rustdeskConfig: {
					enabled: submittedRustDeskEnabled,
					idServer: submittedRustDeskIdServer.trim(),
					key: submittedRustDeskKey.trim()
				}
			};
			const res = await fetch('/api/admin', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(metadata),
				signal: controller.signal
			});

			const data: ApiResponse<DownloadItem> = await res.json();
			if (runId !== submitRunId || controller.signal.aborted) return;
			if (res.ok && data.success && data.data) {
				const addedStorageType = submittedStorageType;
				onAdd(data.data);
				clearFormFields();
				success =
					addedStorageType === 'link' && data.data.r2Backup?.status === 'failed'
						? '添加成功，但首次 R2 备份失败，请稍后重试同步。'
						: '添加成功！';
			} else {
				error = data.error || '添加失败';
			}
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			if (runId === submitRunId) error = '网络错误';
		} finally {
			if (runId === submitRunId && submitController === controller) {
				submitController = null;
				saving = false;
			}
		}
	}
</script>

<section class="form-section">
	<h2>✨ 添加下载项</h2>

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

	<div class="form-grid">
		<div class="form-group">
			<label for="platform">平台</label>
			<select id="platform" bind:value={formPlatform}>
				<option value="windows">🪟 Windows</option>
				<option value="macos">🍎 macOS</option>
				<option value="linux">🐧 Linux</option>
			</select>
		</div>

		<div class="form-group">
			<label for="version">版本号</label>
			<input id="version" type="text" bind:value={formVersion} placeholder="v1.0.0" />
		</div>

		<div class="form-group">
			<label for="category">分类</label>
			<select id="category" bind:value={formCategoryId}>
				<option value={undefined}>无分类</option>
				{#each categories as category (category.id)}
					<option value={category.id}>{category.icon || ''} {category.name}</option>
				{/each}
			</select>
		</div>

		<div class="form-group">
			<label for="title">标题</label>
			<input
				id="title"
				type="text"
				bind:value={formTitle}
				placeholder="例如：PlayDota2Win Windows 稳定版"
			/>
		</div>

		<div class="form-group full-width">
			<label for="description">描述</label>
			<textarea
				id="description"
				bind:value={formDescription}
				placeholder="简短描述这个版本的特性或用途"></textarea>
		</div>

		<div class="form-group full-width">
			<label for="configGuide">配置指引</label>
			<textarea
				id="configGuide"
				bind:value={formConfigGuide}
				placeholder="每行一条步骤，例如：复制 验证码123 或 打开 mumble://xxx"></textarea>
			<p class="field-hint">支持动作：复制 xxx / 打开 mumble://xxx 或 https://</p>
		</div>

		<div class="form-group">
			<label for="filename">文件名</label>
			<input
				id="filename"
				type="text"
				bind:value={formFilename}
				oninput={handleFilenameChange}
				placeholder="例如：PlayDota2Win.exe"
			/>
		</div>

		<div class="form-group">
			<label for="size">文件大小</label>
			<input id="size" type="text" bind:value={formSize} placeholder="45MB" />
		</div>

		<div class="form-group">
			<label for="storageType">存储方式</label>
			<select id="storageType" bind:value={formStorageType}>
				<option value="link">🔗 外部链接</option>
				<option value="r2">☁️ Cloudflare R2</option>
				<option value="s3">🗄️ 自定义 S3</option>
			</select>
		</div>
	</div>

	<!-- 链接输入 -->
	{#if formStorageType === 'link'}
		<div class="form-group full-width">
			<label for="url">下载链接</label>
			<input
				id="url"
				type="url"
				bind:value={formUrl}
				oninput={handleUrlChange}
				placeholder="https://example.com/download.exe"
			/>
			<p class="field-hint">添加时会同步备份到 Cloudflare R2；原链接不可用时会自动使用备份下载。</p>
		</div>
	{/if}

	<!-- 文件上传 -->
	{#if formStorageType === 'r2' || formStorageType === 's3'}
		<div class="form-group full-width">
			<label for="file">选择文件</label>
			<input id="file" type="file" onchange={handleFileSelect} bind:this={fileInputRef} />
			{#if formFile}
				<span class="file-info">📄 {formFile.name}</span>
			{/if}
			{#if formStorageType === 'r2'}
				<p class="field-hint">
					文件会以原始请求体流式上传，最大 {formatMiB(MAX_ADMIN_R2_UPLOAD_BYTES)}。
				</p>
			{/if}
		</div>
	{/if}

	<!-- S3 配置 -->
	{#if formStorageType === 's3'}
		<div class="s3-config">
			<h3>🗄️ S3 配置</h3>
			<div class="form-grid">
				<div class="form-group">
					<label for="s3PresignedUrl">预签名上传 URL</label>
					<input
						id="s3PresignedUrl"
						type="url"
						bind:value={formS3PresignedUrl}
						placeholder="https://...presigned-url"
					/>
				</div>
				<div class="form-group">
					<label for="s3PublicUrl">公开下载 URL</label>
					<input
						id="s3PublicUrl"
						type="url"
						bind:value={formS3PublicUrl}
						placeholder="https://cdn.example.com/file"
					/>
				</div>
			</div>
			<p class="field-hint">
				文件由浏览器直接 PUT 到预签名 URL；S3 服务必须允许本站来源的 PUT、Content-Type 跨域请求。
			</p>
		</div>
	{/if}

	<div class="rustdesk-config">
		<label class="checkbox-label" for="rustdeskEnabled">
			<input id="rustdeskEnabled" type="checkbox" bind:checked={formRustDeskEnabled} />
			<span>作为 RustDesk 配置接口数据源</span>
		</label>
		<p class="field-hint">
			开启后，公开的 /api/rustdesk 接口会返回此下载项的下载链接、版本号、ID 服务器和
			key，调用时无需授权。
		</p>

		{#if formRustDeskEnabled}
			<div class="form-grid rustdesk-grid">
				<div class="form-group">
					<label for="rustdeskIdServer">RustDesk ID 服务器</label>
					<input
						id="rustdeskIdServer"
						type="text"
						bind:value={formRustDeskIdServer}
						placeholder="例如：rustdesk.example.com"
					/>
				</div>
				<div class="form-group">
					<label for="rustdeskKey">RustDesk key</label>
					<input
						id="rustdeskKey"
						type="text"
						bind:value={formRustDeskKey}
						placeholder="请输入 RustDesk key"
					/>
				</div>
			</div>
		{/if}
	</div>

	<div class="form-actions">
		<button class="btn btn-primary" type="button" onclick={handleAdd} disabled={saving}>
			{#if saving}
				<span class="spinner"></span> 保存中...
			{:else}
				💾 添加下载项
			{/if}
		</button>
		<button class="btn btn-secondary" type="button" onclick={resetForm}
			>{saving ? '取消并重置' : '🔄 重置'}</button
		>
	</div>
</section>

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

	.form-section h2 {
		font-family: 'Fredoka', sans-serif;
		color: #6b4c9a;
		margin: 0 0 1.5rem;
		font-size: 1.5rem;
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

	.form-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-bottom: 1rem;
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

	.file-info {
		font-size: 0.9rem;
		color: #6b4c9a;
		margin-top: 0.5rem;
		overflow-wrap: anywhere;
	}

	.s3-config {
		background: rgba(107, 76, 154, 0.05);
		border-radius: 12px;
		padding: 1.5rem;
		margin: 1rem 0;
	}

	.s3-config h3 {
		margin: 0 0 1rem;
		font-size: 1.1rem;
		color: #6b4c9a;
	}

	.rustdesk-config {
		background: rgba(0, 150, 136, 0.06);
		border: 1px solid rgba(0, 150, 136, 0.12);
		border-radius: 12px;
		padding: 1rem;
		margin: 1rem 0;
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
		margin: 1rem 0 0;
	}

	.form-actions {
		display: flex;
		gap: 1rem;
		margin-top: 1.5rem;
	}

	.btn {
		padding: 0.75rem 1.5rem;
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

	.btn-secondary:hover {
		background: rgba(107, 76, 154, 0.2);
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
		.form-section {
			padding: 1rem;
			border-radius: 16px;
		}

		.form-grid {
			grid-template-columns: minmax(0, 1fr);
		}

		.s3-config {
			padding: 1rem;
		}

		.form-actions {
			flex-wrap: wrap;
		}

		.form-actions .btn {
			flex: 1 1 9rem;
			justify-content: center;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.btn,
		.form-group input,
		.form-group select,
		.form-group textarea {
			transition: none;
		}

		.btn-primary:hover:not(:disabled) {
			transform: none;
			box-shadow: none;
		}

		.spinner {
			animation: none;
		}
	}
</style>
