<script lang="ts">
	import type {
		DownloadItem,
		DownloadList,
		ApiResponse,
		Platform,
		StorageType,
		S3Config
	} from '$lib/types';

	// 认证状态
	let isAuthenticated = $state(false);
	let authPassword = $state('');
	let authError = $state('');
	let authLoading = $state(false);

	// Turnstile 状态
	let requireTurnstile = $state(false);
	let turnstileSiteKey = $state('');
	let turnstileToken = $state('');
	let turnstileWidgetId = $state<string | null>(null);
	let turnstileLoaded = $state(false);

	let downloads = $state<DownloadItem[]>([]);
	let downloadCount = $state(0);
	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');
	let success = $state('');

	// 表单状态
	let formPlatform = $state<Platform>('windows');
	let formTitle = $state('');
	let formDescription = $state('');
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

	// 编辑状态
	let editingId = $state<string | null>(null);

	// 检查是否需要 Turnstile
	async function checkTurnstileRequired() {
		try {
			const res = await fetch('/api/admin/auth');
			const data: ApiResponse<{
				requireTurnstile: boolean;
				siteKey: string;
				failureCount: number;
			}> = await res.json();
			if (data.success && data.data) {
				requireTurnstile = data.data.requireTurnstile;
				turnstileSiteKey = data.data.siteKey;
				if (requireTurnstile && turnstileSiteKey) {
					loadTurnstileScript();
				}
			}
		} catch (e) {
			console.error('Failed to check turnstile status:', e);
		}
	}

	// 加载 Turnstile 脚本
	function loadTurnstileScript() {
		if (turnstileLoaded || document.querySelector('script[src*="turnstile"]')) {
			turnstileLoaded = true;
			renderTurnstile();
			return;
		}

		const script = document.createElement('script');
		script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad';
		script.async = true;

		(window as unknown as Record<string, () => void>).onTurnstileLoad = () => {
			turnstileLoaded = true;
			renderTurnstile();
		};

		document.head.appendChild(script);
	}

	// 渲染 Turnstile 小部件
	function renderTurnstile() {
		if (!turnstileLoaded || !turnstileSiteKey) return;

		const container = document.getElementById('turnstile-container');
		if (!container) return;

		// 清理旧的 widget
		if (turnstileWidgetId) {
			try {
				(window as unknown as { turnstile: { remove: (id: string) => void } }).turnstile.remove(
					turnstileWidgetId
				);
			} catch {
				/* ignore */
			}
		}

		// 清空容器
		container.innerHTML = '';

		// 渲染新的 widget
		turnstileWidgetId = (
			window as unknown as { turnstile: { render: (el: HTMLElement, opts: unknown) => string } }
		).turnstile.render(container, {
			sitekey: turnstileSiteKey,
			theme: 'light',
			callback: (token: string) => {
				turnstileToken = token;
			},
			'expired-callback': () => {
				turnstileToken = '';
			},
			'error-callback': () => {
				turnstileToken = '';
				authError = '人机验证加载失败，请刷新页面重试';
			}
		});
	}

	// 重置 Turnstile
	function resetTurnstile() {
		if (turnstileWidgetId && turnstileLoaded) {
			try {
				(window as unknown as { turnstile: { reset: (id: string) => void } }).turnstile.reset(
					turnstileWidgetId
				);
			} catch {
				/* ignore */
			}
		}
		turnstileToken = '';
	}

	// 登录验证
	async function handleLogin() {
		if (!authPassword) {
			authError = '请输入密码';
			return;
		}

		if (requireTurnstile && !turnstileToken) {
			authError = '请完成人机验证';
			return;
		}

		authLoading = true;
		authError = '';

		try {
			const res = await fetch('/api/admin/auth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					password: authPassword,
					turnstileToken: turnstileToken || undefined
				})
			});

			const data: ApiResponse<{
				token?: string;
				requireTurnstile?: boolean;
				siteKey?: string;
				failureCount?: number;
			}> = await res.json();
			if (data.success && data.data?.token) {
				// 保存 token 到 sessionStorage
				sessionStorage.setItem('admin_token', data.data.token);
				isAuthenticated = true;
				loadDownloads();
			} else {
				authError = data.error || '密码错误';

				// 检查是否需要启用 Turnstile
				if (data.data?.requireTurnstile && data.data?.siteKey) {
					requireTurnstile = true;
					turnstileSiteKey = data.data.siteKey;
					loadTurnstileScript();
					// 等待 DOM 更新后渲染
					setTimeout(() => renderTurnstile(), 100);
				} else if (requireTurnstile) {
					// 已经有 Turnstile，重置它
					resetTurnstile();
				}
			}
		} catch (e) {
			authError = '网络错误';
			if (requireTurnstile) {
				resetTurnstile();
			}
		} finally {
			authLoading = false;
		}
	}

	// 登出
	function handleLogout() {
		sessionStorage.removeItem('admin_token');
		isAuthenticated = false;
		authPassword = '';
	}

	// 检查是否已登录
	async function checkAuth() {
		const token = sessionStorage.getItem('admin_token');
		if (token) {
			isAuthenticated = true;
			loadDownloads();
		} else {
			loading = false;
			// 未登录时检查是否需要 Turnstile
			await checkTurnstileRequired();
		}
	}

	// 加载下载列表
	async function loadDownloads() {
		loading = true;
		error = '';
		try {
			const token = sessionStorage.getItem('admin_token');
			const res = await fetch('/api/admin', {
				headers: { Authorization: `Bearer ${token}` }
			});
			const data: ApiResponse<DownloadList> = await res.json();
			if (data.success && data.data) {
				downloads = data.data.items;
				downloadCount = data.data.downloadCount;
			} else {
				if (res.status === 401) {
					handleLogout();
				}
				error = data.error || '加载失败';
			}
		} catch (e) {
			error = '网络错误';
		} finally {
			loading = false;
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
			if (formFilename) {
				formData.append('filename', formFilename);
			}
			formData.append('version', formVersion);
			formData.append('size', formSize);
			formData.append('storageType', formStorageType);

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

			const token = sessionStorage.getItem('admin_token');
			const res = await fetch('/api/admin', {
				method: 'POST',
				headers: token ? { Authorization: `Bearer ${token}` } : undefined,
				body: formData
			});

			const data: ApiResponse<DownloadItem> = await res.json();
			if (data.success && data.data) {
				downloads = [...downloads, data.data];
				success = '添加成功！';
				resetForm();
			} else {
				error = data.error || '添加失败';
			}
		} catch (e) {
			error = '网络错误';
		} finally {
			saving = false;
		}
	}

	// 切换启用状态
	async function toggleEnabled(item: DownloadItem) {
		try {
			const token = sessionStorage.getItem('admin_token');
			const res = await fetch('/api/admin', {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {})
				},
				body: JSON.stringify({ id: item.id, enabled: !item.enabled })
			});

			const data: ApiResponse<DownloadItem> = await res.json();
			if (data.success && data.data) {
				downloads = downloads.map((d) => (d.id === item.id ? data.data! : d));
			}
		} catch (e) {
			error = '更新失败';
		}
	}

	// 删除下载项
	async function handleDelete(id: string) {
		if (!confirm('确定要删除吗？')) return;

		try {
			const token = sessionStorage.getItem('admin_token');
			const res = await fetch('/api/admin', {
				method: 'DELETE',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {})
				},
				body: JSON.stringify({ id })
			});

			const data: ApiResponse = await res.json();
			if (data.success) {
				downloads = downloads.filter((d) => d.id !== id);
				success = '删除成功！';
			} else {
				error = data.error || '删除失败';
			}
		} catch (e) {
			error = '网络错误';
		}
	}

	// 重置表单
	function resetForm() {
		formPlatform = 'windows';
		formTitle = '';
		formDescription = '';
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
		editingId = null;
	}

	// 文件选择处理
	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files && input.files[0]) {
			formFile = input.files[0];
			if (!formFilename) {
				formFilename = input.files[0].name;
			}
			// 自动填充大小
			const sizeMB = (input.files[0].size / (1024 * 1024)).toFixed(1);
			formSize = `${sizeMB}MB`;
		}
	}

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

	function getAdminDownloadUrl(item: DownloadItem): string {
		return item.signedUrl || item.url;
	}

	// 初始加载 - 检查认证状态
	$effect(() => {
		checkAuth();
	});
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@300;400;500;600;700&display=swap"
		rel="stylesheet"
	/>
	<title>Admin - PlayDota2Win</title>
</svelte:head>

{#if !isAuthenticated}
	<!-- 登录界面 -->
	<div class="login-container">
		<div class="login-card">
			<div class="login-icon">🔐</div>
			<h1>管理后台</h1>
			<p class="login-subtitle">请输入密码以继续</p>

			{#if authError}
				<div class="login-error">
					<span>❌</span>
					{authError}
				</div>
			{/if}

			<form
				class="login-form"
				onsubmit={(e) => {
					e.preventDefault();
					handleLogin();
				}}
			>
				<div class="login-input-group">
					<input
						type="password"
						bind:value={authPassword}
						placeholder="输入管理密码"
						autocomplete="current-password"
					/>
				</div>

				{#if requireTurnstile}
					<div class="turnstile-wrapper">
						<div id="turnstile-container"></div>
						{#if !turnstileToken}
							<p class="turnstile-hint">🤖 请完成人机验证</p>
						{:else}
							<p class="turnstile-success">✅ 验证通过</p>
						{/if}
					</div>
				{/if}

				<button
					type="submit"
					class="login-btn"
					disabled={authLoading || (requireTurnstile && !turnstileToken)}
				>
					{#if authLoading}
						<span class="spinner"></span> 验证中...
					{:else}
						🚀 进入后台
					{/if}
				</button>
			</form>

			<p class="login-hint">💡 忘记密码？请联系管理员</p>
		</div>
	</div>
{:else}
	<!-- 管理界面 -->
	<div class="admin-container">
		<header class="admin-header">
			<h1>🎮 PlayDota2Win 管理后台</h1>
			<div class="header-actions">
				<div class="stats">
					<span class="stat-item"
						>📥 总下载次数: <strong>{downloadCount.toLocaleString()}</strong></span
					>
					<span class="stat-item">📦 下载项: <strong>{downloads.length}</strong></span>
				</div>
				<button class="logout-btn" onclick={handleLogout}>🚪 退出登录</button>
			</div>
		</header>

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

		<!-- 添加表单 -->
		<section class="form-section">
			<h2>✨ 添加下载项</h2>

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

		<!-- 下载列表 -->
		<section class="list-section">
			<h2>📋 下载列表</h2>

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
							<div class="item-icon">{getPlatformIcon(item.platform)}</div>
							<div class="item-info">
								<div class="item-title">
									{item.title || `${item.platform.toUpperCase()} - ${item.version}`}
									<span class="badge badge-{item.storageType}"
										>{getStorageLabel(item.storageType)}</span
									>
								</div>
								<div class="item-meta">
									<span>📦 {item.size}</span>
									{#if item.description}
										<span>📝 {item.description}</span>
									{/if}
									{#if item.filename}
										<span>📝 {item.filename}</span>
									{/if}
									<span
										>🔗 <a href={getAdminDownloadUrl(item)} target="_blank" rel="noopener"
											>{item.url.slice(0, 50)}...</a
										></span
									>
								</div>
							</div>
							<div class="item-actions">
								<button
									class="btn btn-small"
									class:btn-success={!item.enabled}
									class:btn-warning={item.enabled}
									onclick={() => toggleEnabled(item)}
								>
									{item.enabled ? '禁用' : '启用'}
								</button>
								<button class="btn btn-small btn-danger" onclick={() => handleDelete(item.id)}>
									删除
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	</div>
{/if}

<style>
	:global(body) {
		margin: 0;
		padding: 0;
	}

	/* 登录页面样式 */
	.login-container {
		min-height: 100vh;
		background: linear-gradient(135deg, #fff5f7 0%, #f0e6ff 50%, #e6f0ff 100%);
		font-family: 'Nunito', 'PingFang SC', 'Microsoft YaHei', sans-serif;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
	}

	.login-card {
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(10px);
		border-radius: 20px;
		padding: 3rem;
		width: 100%;
		max-width: 400px;
		text-align: center;
		box-shadow: 0 8px 25px rgba(107, 76, 154, 0.12);
	}

	.login-icon {
		font-size: 4rem;
		margin-bottom: 1rem;
	}

	.login-card h1 {
		font-family: 'Fredoka', sans-serif;
		color: #6b4c9a;
		margin: 0 0 0.5rem;
		font-size: 2rem;
	}

	.login-subtitle {
		color: #8b7ba8;
		margin: 0 0 1.5rem;
	}

	.login-error {
		background: rgba(255, 107, 107, 0.15);
		color: #dc3545;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		margin-bottom: 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: center;
	}

	.login-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.login-input-group input {
		width: 100%;
		padding: 1rem 1.25rem;
		border: 2px solid #e6e0f0;
		border-radius: 12px;
		font-size: 1rem;
		font-family: inherit;
		transition: all 0.3s ease;
		box-sizing: border-box;
	}

	.login-input-group input:focus {
		outline: none;
		border-color: #6b4c9a;
		box-shadow: 0 0 0 3px rgba(107, 76, 154, 0.2);
	}

	.login-btn {
		padding: 1rem 2rem;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		border: none;
		border-radius: 20px;
		font-size: 1.1rem;
		font-family: inherit;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s ease;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		position: relative;
		overflow: hidden;
	}

	.login-btn:hover:not(:disabled) {
		transform: translateY(-3px) scale(1.02);
		box-shadow: 0 12px 30px rgba(102, 126, 234, 0.45);
	}

	.login-btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.login-hint {
		margin-top: 1.5rem;
		font-size: 0.85rem;
		color: #a89bc4;
	}

	/* Turnstile 样式 */
	.turnstile-wrapper {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1rem;
		background: rgba(107, 76, 154, 0.05);
		border-radius: 12px;
		border: 2px dashed #e6e0f0;
	}

	.turnstile-hint {
		margin: 0;
		font-size: 0.85rem;
		color: #8b7ba8;
	}

	.turnstile-success {
		margin: 0;
		font-size: 0.85rem;
		color: #38ef7d;
		font-weight: 600;
	}

	/* 管理页面样式 */
	.admin-container {
		min-height: 100vh;
		background: linear-gradient(135deg, #fff5f7 0%, #f0e6ff 50%, #e6f0ff 100%);
		font-family: 'Nunito', 'PingFang SC', 'Microsoft YaHei', sans-serif;
		padding: 2rem;
	}

	.admin-header {
		max-width: 1000px;
		margin: 0 auto 2rem;
		text-align: center;
		color: #6b4c9a;
	}

	.admin-header h1 {
		font-family: 'Fredoka', sans-serif;
		font-size: 2.5rem;
		margin: 0 0 1rem;
		text-shadow: 2px 2px 0 #ffe4ec;
	}

	.header-actions {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.logout-btn {
		background: rgba(255, 255, 255, 0.7);
		color: #6b4c9a;
		border: 1px solid rgba(107, 76, 154, 0.2);
		padding: 0.6rem 1.2rem;
		border-radius: 20px;
		font-family: inherit;
		font-size: 0.9rem;
		cursor: pointer;
		transition: all 0.3s ease;
		backdrop-filter: blur(10px);
	}

	.logout-btn:hover {
		transform: translateY(-2px);
		background: rgba(255, 255, 255, 0.85);
		box-shadow: 0 8px 20px rgba(107, 76, 154, 0.15);
	}

	.stats {
		display: flex;
		justify-content: center;
		gap: 2rem;
		flex-wrap: wrap;
	}

	.stat-item {
		background: rgba(255, 255, 255, 0.7);
		padding: 0.6rem 1.2rem;
		border-radius: 20px;
		color: #6b4c9a;
		box-shadow: 0 4px 15px rgba(107, 76, 154, 0.1);
		backdrop-filter: blur(10px);
	}

	.stat-item strong {
		color: #ff6b9d;
	}

	/* 提示框 */
	.alert {
		max-width: 1000px;
		margin: 0 auto 1rem;
		padding: 1rem 1.5rem;
		border-radius: 12px;
		display: flex;
		align-items: center;
		gap: 0.5rem;
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

	/* 表单区域 */
	.form-section,
	.list-section {
		max-width: 1000px;
		margin: 0 auto 2rem;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(10px);
		border-radius: 20px;
		padding: 2rem;
		box-shadow: 0 8px 25px rgba(107, 76, 154, 0.12);
	}

	.form-section h2,
	.list-section h2 {
		font-family: 'Fredoka', sans-serif;
		color: #6b4c9a;
		margin: 0 0 1.5rem;
		font-size: 1.5rem;
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
		box-shadow: 0 0 0 3px rgba(107, 76, 154, 0.2);
	}

	.form-group textarea {
		min-height: 90px;
		resize: vertical;
	}

	.file-info {
		font-size: 0.85rem;
		color: #8b7ba8;
	}

	.s3-config {
		background: rgba(255, 255, 255, 0.7);
		border-radius: 16px;
		padding: 1.5rem;
		margin: 1rem 0;
		box-shadow: inset 0 0 0 1px rgba(107, 76, 154, 0.08);
	}

	.s3-config h3 {
		font-family: 'Fredoka', sans-serif;
		color: #6b4c9a;
		margin: 0 0 1rem;
		font-size: 1.1rem;
	}

	.form-actions {
		display: flex;
		gap: 1rem;
		margin-top: 1.5rem;
	}

	/* 按钮 */
	.btn {
		padding: 0.75rem 1.5rem;
		border: none;
		border-radius: 12px;
		font-size: 1rem;
		font-family: inherit;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s ease;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-primary {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		box-shadow: 0 8px 25px rgba(102, 126, 234, 0.35);
		border-radius: 20px;
	}

	.btn-primary:hover:not(:disabled) {
		transform: translateY(-3px) scale(1.02);
		box-shadow: 0 12px 30px rgba(102, 126, 234, 0.45);
	}

	.btn-secondary {
		background: rgba(255, 255, 255, 0.8);
		color: #6b4c9a;
		border: 1px solid rgba(107, 76, 154, 0.15);
		border-radius: 20px;
	}

	.btn-secondary:hover {
		background: rgba(255, 255, 255, 0.95);
		transform: translateY(-2px);
		box-shadow: 0 8px 20px rgba(107, 76, 154, 0.12);
	}

	.btn-small {
		padding: 0.5rem 1rem;
		font-size: 0.85rem;
	}

	.btn-success {
		background: rgba(107, 203, 119, 0.2);
		color: #2e8b57;
		border: 1px solid rgba(46, 139, 87, 0.2);
	}

	.btn-warning {
		background: rgba(255, 179, 71, 0.2);
		color: #b4691f;
		border: 1px solid rgba(180, 105, 31, 0.2);
	}

	.btn-danger {
		background: rgba(255, 107, 107, 0.2);
		color: #c8556b;
		border: 1px solid rgba(200, 85, 107, 0.2);
	}

	/* 加载和空状态 */
	.loading,
	.empty-state {
		text-align: center;
		padding: 3rem;
		color: #8b7ba8;
	}

	.empty-icon {
		font-size: 4rem;
		display: block;
		margin-bottom: 1rem;
	}

	.empty-hint {
		font-size: 0.9rem;
		opacity: 0.7;
	}

	.spinner {
		display: inline-block;
		width: 20px;
		height: 20px;
		border: 3px solid rgba(107, 76, 154, 0.2);
		border-top-color: #6b4c9a;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	.spinner.large {
		width: 40px;
		height: 40px;
		border-color: rgba(107, 76, 154, 0.2);
		border-top-color: #6b4c9a;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* 下载列表 */
	.download-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.download-item {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.5rem;
		background: rgba(255, 255, 255, 0.8);
		backdrop-filter: blur(8px);
		border-radius: 16px;
		transition: all 0.3s ease;
		box-shadow: 0 8px 20px rgba(107, 76, 154, 0.08);
	}

	.download-item:hover {
		transform: translateY(-3px);
		box-shadow: 0 12px 28px rgba(107, 76, 154, 0.12);
	}

	.download-item.disabled {
		opacity: 0.5;
	}

	.item-icon {
		font-size: 2rem;
		flex-shrink: 0;
	}

	.item-info {
		flex: 1;
		min-width: 0;
	}

	.item-title {
		font-weight: 600;
		color: #6b4c9a;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.item-meta {
		font-size: 0.85rem;
		color: #8b7ba8;
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		margin-top: 0.25rem;
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

	.badge {
		font-size: 0.75rem;
		padding: 0.2rem 0.5rem;
		border-radius: 8px;
		font-weight: 500;
	}

	.badge-link {
		background: #e0f2fe;
		color: #0284c7;
	}

	.badge-r2 {
		background: #fef3c7;
		color: #d97706;
	}

	.badge-s3 {
		background: #dcfce7;
		color: #16a34a;
	}

	/* 响应式 */
	@media (max-width: 768px) {
		.admin-container {
			padding: 1rem;
		}

		.admin-header h1 {
			font-size: 1.8rem;
		}

		.form-section,
		.list-section {
			padding: 1.5rem;
		}

		.download-item {
			flex-direction: column;
			align-items: flex-start;
			text-align: left;
		}

		.item-actions {
			width: 100%;
			justify-content: flex-end;
		}
	}
</style>
