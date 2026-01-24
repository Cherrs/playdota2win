<script lang="ts">
	import type {
		DownloadItem,
		ApiResponse,
		Platform,
		StorageType,
		S3Config,
		Category
	} from '$lib/types';

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
	let formS3Endpoint = $state('');
	let formS3Bucket = $state('');
	let formS3PresignedUrl = $state('');
	let formS3PublicUrl = $state('');
	let formS3Region = $state('auto');
	let formCategoryId = $state<string | undefined>(undefined);

	// 重置表单
	function resetForm() {
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
		formS3Endpoint = '';
		formS3Bucket = '';
		formS3PresignedUrl = '';
		formS3PublicUrl = '';
		formS3Region = 'auto';
		formCategoryId = undefined;
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
			const sizeMB = (input.files[0].size / (1024 * 1024)).toFixed(1);
			formSize = `${sizeMB}MB`;
		}
	}

	// 添加下载项
	async function handleAdd() {
		if (!formVersion || !formSize) {
			error = '请填写版本和大小';
			return;
		}

		saving = true;
		error = '';
		success = '';

		try {
			const formData = new FormData();
			formData.append('platform', formPlatform);
			if (formTitle) {
				formData.append('title', formTitle);
			}
			if (formDescription) {
				formData.append('description', formDescription);
			}
			if (formConfigGuide) {
				formData.append('configGuide', formConfigGuide);
			}
			if (formFilename) {
				formData.append('filename', formFilename);
			}
			formData.append('version', formVersion);
			formData.append('size', formSize);
			formData.append('storageType', formStorageType);

			if (formCategoryId) {
				formData.append('categoryId', formCategoryId);
			}

			if (formStorageType === 'link') {
				if (!formUrl) {
					error = '请填写下载链接';
					saving = false;
					return;
				}
				formData.append('url', formUrl);
			} else if (formStorageType === 'r2' || formStorageType === 's3') {
				if (!formFile) {
					error = '请选择文件';
					saving = false;
					return;
				}
				formData.append('file', formFile);
				if (!formFilename) {
					formFilename = formFile.name;
					formData.append('filename', formFilename);
				}

				if (formStorageType === 's3') {
					if (!formS3PresignedUrl || !formS3PublicUrl) {
						error = '请填写预签名上传 URL 和公开下载 URL';
						saving = false;
						return;
					}
					const s3Config: S3Config = {
						endpoint: formS3Endpoint || undefined,
						bucket: formS3Bucket || undefined,
						region: formS3Region || undefined,
						presignedUrl: formS3PresignedUrl,
						publicUrl: formS3PublicUrl
					};
					formData.append('s3Config', JSON.stringify(s3Config));
				}
			}

			const token = localStorage.getItem('admin_token');
			const res = await fetch('/api/admin', {
				method: 'POST',
				headers: token ? { Authorization: `Bearer ${token}` } : undefined,
				body: formData
			});

			const data: ApiResponse<DownloadItem> = await res.json();
			if (data.success && data.data) {
				onAdd(data.data);
				success = '添加成功！';
				resetForm();
			} else {
				error = data.error || '添加失败';
			}
		} catch {
			error = '网络错误';
		} finally {
			saving = false;
		}
	}
</script>

<section class="form-section">
	<h2>✨ 添加下载项</h2>

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
				placeholder="简短描述这个版本的特性或用途"
			></textarea>
		</div>

		<div class="form-group full-width">
			<label for="configGuide">配置指引</label>
			<textarea
				id="configGuide"
				bind:value={formConfigGuide}
				placeholder="每行一条步骤，例如：复制 验证码123 或 打开 mumble://xxx"
			></textarea>
			<p class="field-hint">支持动作：复制 xxx / 打开 mumble://xxx 或 https://</p>
		</div>

		<div class="form-group">
			<label for="filename">文件名</label>
			<input
				id="filename"
				type="text"
				bind:value={formFilename}
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
				placeholder="https://example.com/download.exe"
			/>
		</div>
	{/if}

	<!-- 文件上传 -->
	{#if formStorageType === 'r2' || formStorageType === 's3'}
		<div class="form-group full-width">
			<label for="file">选择文件</label>
			<input id="file" type="file" onchange={handleFileSelect} />
			{#if formFile}
				<span class="file-info">📄 {formFile.name}</span>
			{/if}
		</div>
	{/if}

	<!-- S3 配置 -->
	{#if formStorageType === 's3'}
		<div class="s3-config">
			<h3>🗄️ S3 配置</h3>
			<div class="form-grid">
				<div class="form-group">
					<label for="s3Endpoint">Endpoint</label>
					<input
						id="s3Endpoint"
						type="url"
						bind:value={formS3Endpoint}
						placeholder="https://s3.example.com"
					/>
				</div>
				<div class="form-group">
					<label for="s3Bucket">Bucket</label>
					<input id="s3Bucket" type="text" bind:value={formS3Bucket} placeholder="my-bucket" />
				</div>
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
				<div class="form-group">
					<label for="s3Region">Region</label>
					<input id="s3Region" type="text" bind:value={formS3Region} placeholder="auto" />
				</div>
			</div>
		</div>
	{/if}

	<div class="form-actions">
		<button class="btn btn-primary" onclick={handleAdd} disabled={saving}>
			{#if saving}
				<span class="spinner"></span> 保存中...
			{:else}
				💾 添加下载项
			{/if}
		</button>
		<button class="btn btn-secondary" onclick={resetForm}>🔄 重置</button>
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
</style>
