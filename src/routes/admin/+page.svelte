<script lang="ts">
	import type {
		DownloadItem,
		DownloadList,
		ApiResponse,
		Platform,
		StorageType,
		S3Config,
		Category,
		CategoryList
	} from '$lib/types';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import ColorPicker from '$lib/components/ColorPicker.svelte';
	import DraggableList from '$lib/components/DraggableList.svelte';

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

	// 分类相关
	let categories = $state<Category[]>([]);
	let categoryLoading = $state(false);
	let categorySaving = $state(false);
	let categoryError = $state('');
	let categorySuccess = $state('');
	let showCategoryForm = $state(false);
	let editingCategoryId = $state<string | null>(null);
	let formCategoryName = $state('');
	let formCategoryIcon = $state('');
	let formCategoryColor = $state('');
	let formCategoryDescription = $state('');
	let formCategoryOrder = $state(0);
	let showEmojiPicker = $state(false);
	let showColorPicker = $state(false);

	// 批量操作
	let selectedDownloadIds = new SvelteSet<string>();
	let showBulkActions = $state(false);

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

	// 下载项分类字段
	let formCategoryId = $state<string | undefined>(undefined);

	// 编辑状态（移除未使用的 editingId）

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
		} catch (error) {
			console.error('Failed to check turnstile status:', error);
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
				// 保存 token 到 localStorage
				localStorage.setItem('admin_token', data.data.token);
				isAuthenticated = true;
				loadDownloads();
				loadCategories();
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
		} catch {
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
		localStorage.removeItem('admin_token');
		isAuthenticated = false;
		authPassword = '';
	}

	// 检查是否已登录
	async function checkAuth() {
		const token = localStorage.getItem('admin_token');
		if (token) {
			isAuthenticated = true;
			loadDownloads();
			loadCategories();
		} else {
			loading = false;
			// 未登录时检查是否需要 Turnstile
			await checkTurnstileRequired();
		}
	}

	// 加载分类列表
	async function loadCategories() {
		categoryLoading = true;
		categoryError = '';
		try {
			const token = localStorage.getItem('admin_token');
			const res = await fetch('/api/admin/categories', {
				headers: { Authorization: `Bearer ${token}` }
			});
			const data: ApiResponse<CategoryList> = await res.json();
			if (data.success && data.data) {
				categories = data.data.items;
			} else {
				if (res.status === 401) {
					handleLogout();
				}
				categoryError = data.error || '加载分类失败';
			}
		} catch {
			categoryError = '网络错误';
		} finally {
			categoryLoading = false;
		}
	}

	// 打开分类表单
	function openCategoryForm(category?: Category) {
		if (category) {
			editingCategoryId = category.id;
			formCategoryName = category.name;
			formCategoryIcon = category.icon || '';
			formCategoryColor = category.color || '';
			formCategoryDescription = category.description || '';
			formCategoryOrder = category.order;
		} else {
			editingCategoryId = null;
			formCategoryName = '';
			formCategoryIcon = '';
			formCategoryColor = '';
			formCategoryDescription = '';
			formCategoryOrder = categories.length;
		}
		showCategoryForm = true;
		showEmojiPicker = false;
		showColorPicker = false;
		categorySuccess = '';
		categoryError = '';
	}

	function closeCategoryForm() {
		showCategoryForm = false;
		editingCategoryId = null;
		formCategoryName = '';
		formCategoryIcon = '';
		formCategoryColor = '';
		formCategoryDescription = '';
		formCategoryOrder = 0;
		showEmojiPicker = false;
		showColorPicker = false;
	}

	// 保存分类
	async function handleSaveCategory() {
		if (!formCategoryName.trim()) {
			categoryError = '请输入分类名称';
			return;
		}

		categorySaving = true;
		categoryError = '';

		try {
			const token = localStorage.getItem('admin_token');
			const url = editingCategoryId ? '/api/admin/categories' : '/api/admin/categories';
			const method = editingCategoryId ? 'PUT' : 'POST';
			const body = editingCategoryId
				? JSON.stringify({
						id: editingCategoryId,
						name: formCategoryName.trim(),
						icon: formCategoryIcon.trim() || undefined,
						color: formCategoryColor.trim() || undefined,
						description: formCategoryDescription.trim() || undefined,
						order: formCategoryOrder
					})
				: JSON.stringify({
						name: formCategoryName.trim(),
						icon: formCategoryIcon.trim() || undefined,
						color: formCategoryColor.trim() || undefined,
						description: formCategoryDescription.trim() || undefined,
						order: formCategoryOrder
					});

			const res = await fetch(url, {
				method,
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {})
				},
				body
			});

			const data: ApiResponse<Category> = await res.json();
			if (data.success && data.data) {
				if (editingCategoryId) {
					categories = categories.map((c) => (c.id === editingCategoryId ? data.data! : c));
					categorySuccess = '更新成功！';
				} else {
					categories = [...categories, data.data];
					categorySuccess = '添加成功！';
				}
				closeCategoryForm();
				await loadCategories(); // 重新加载以确保排序正确
			} else {
				categoryError = data.error || '保存失败';
			}
		} catch {
			categoryError = '网络错误';
		} finally {
			categorySaving = false;
		}
	}

	// 删除分类
	async function handleDeleteCategory(id: string) {
		// 检查是否有下载项使用该分类
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
				categorySuccess = '删除成功！';
				// 如果有下载项使用该分类，重新加载下载列表
				if (itemsInCategory.length > 0) {
					await loadDownloads();
				}
			} else {
				categoryError = data.error || '删除失败';
			}
		} catch {
			categoryError = '网络错误';
		}
	}

	// 处理分类拖放排序
	async function handleCategoryReorder(reorderedCategories: Category[]) {
		categories = reorderedCategories;

		// 批量更新分类顺序
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
			categorySuccess = '排序已更新！';
		} catch {
			categoryError = '更新排序失败';
		}
	}

	// 计算每个分类的下载数量
	function getCategoryDownloadCount(categoryId: string): number {
		return downloads.filter((d) => d.enabled && d.categoryId === categoryId).length;
	}

	// 批量操作：全选/取消全选
	function toggleSelectAll() {
		if (selectedDownloadIds.size === downloads.length) {
			selectedDownloadIds.clear();
		} else {
			selectedDownloadIds.clear();
			for (const download of downloads) {
				selectedDownloadIds.add(download.id);
			}
		}
	}

	// 批量操作：移动到分类
	async function handleBulkMoveToCategory(categoryId: string | null) {
		if (selectedDownloadIds.size === 0) {
			error = '请先选择要移动的下载项';
			return;
		}

		try {
			const token = localStorage.getItem('admin_token');
			for (const itemId of selectedDownloadIds) {
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

			success = `成功移动 ${selectedDownloadIds.size} 个下载项！`;
			selectedDownloadIds.clear();
			showBulkActions = false;
			await loadDownloads();
		} catch {
			error = '批量移动失败';
		}
	}

	// 批量操作：删除
	async function handleBulkDelete() {
		if (selectedDownloadIds.size === 0) {
			error = '请先选择要删除的下载项';
			return;
		}

		if (!confirm(`确定要删除选中的 ${selectedDownloadIds.size} 个下载项吗？`)) return;

		try {
			const token = localStorage.getItem('admin_token');
			for (const itemId of selectedDownloadIds) {
				await fetch('/api/admin', {
					method: 'DELETE',
					headers: {
						'Content-Type': 'application/json',
						...(token ? { Authorization: `Bearer ${token}` } : {})
					},
					body: JSON.stringify({ id: itemId })
				});
			}

			success = `成功删除 ${selectedDownloadIds.size} 个下载项！`;
			selectedDownloadIds.clear();
			showBulkActions = false;
			await loadDownloads();
		} catch {
			error = '批量删除失败';
		}
	}

	// 加载下载列表
	async function loadDownloads() {
		loading = true;
		error = '';
		try {
			const token = localStorage.getItem('admin_token');
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
		} catch {
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
				downloads = [...downloads, data.data];
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

	// 切换启用状态
	async function toggleEnabled(item: DownloadItem) {
		try {
			const token = localStorage.getItem('admin_token');
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
		} catch {
			error = '更新失败';
		}
	}

	// 删除下载项
	async function handleDelete(id: string) {
		if (!confirm('确定要删除吗？')) return;

		try {
			const token = localStorage.getItem('admin_token');
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
		} catch {
			error = '网络错误';
		}
	}

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

	function resolveAdminDownloadUrl(item: DownloadItem): string {
		if (item.storageType === 'link') {
			return item.url; // link类型的URL已经是完整的外部URL，直接返回
		}
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

		<!-- 分类管理区 -->
		<section class="form-section">
			<div class="section-header">
				<h2>🗂️ 分类管理</h2>
				<button class="btn btn-primary btn-small" onclick={() => openCategoryForm()}>
					+ 添加分类
				</button>
			</div>

			{#if categoryError}
				<div class="alert alert-error">
					<span>❌</span>
					{categoryError}
					<button class="alert-close" onclick={() => (categoryError = '')}>×</button>
				</div>
			{/if}

			{#if categorySuccess}
				<div class="alert alert-success">
					<span>✅</span>
					{categorySuccess}
					<button class="alert-close" onclick={() => (categorySuccess = '')}>×</button>
				</div>
			{/if}

			{#if categoryLoading}
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
				<DraggableList items={categories} onreorder={handleCategoryReorder}>
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
							<button class="btn btn-small" onclick={() => openCategoryForm(category)}>
								编辑
							</button>
							<button
								class="btn btn-small btn-danger"
								onclick={() => handleDeleteCategory(category.id)}
							>
								删除
							</button>
						</div>
					{/snippet}
				</DraggableList>
			{/if}
		</section>

		{#if showCategoryForm}
			<div class="modal-backdrop" role="dialog" aria-modal="true">
				<button
					type="button"
					class="modal-scrim"
					onclick={closeCategoryForm}
					onkeydown={(e) =>
						(e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') && closeCategoryForm()}
					aria-label="关闭"
				></button>
				<div class="modal-card modal-lg">
					<div class="modal-header">
						<h3>{editingCategoryId ? '编辑分类' : '添加分类'}</h3>
						<button class="modal-close" onclick={closeCategoryForm}>×</button>
					</div>

					{#if categoryError}
						<p class="auth-error">{categoryError}</p>
					{/if}

					<div class="auth-form modal-form-grid">
						<div class="form-group">
							<label for="categoryName">分类名称</label>
							<input
								id="categoryName"
								type="text"
								bind:value={formCategoryName}
								placeholder="例如：工具"
							/>
						</div>

						<div class="form-group">
							<label for="categoryDesc">描述（可选）</label>
							<textarea
								id="categoryDesc"
								bind:value={formCategoryDescription}
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
									bind:value={formCategoryIcon}
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
										value={formCategoryIcon}
										onselect={(emoji) => {
											formCategoryIcon = emoji;
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
									bind:value={formCategoryColor}
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
								{#if formCategoryColor}
									<div class="color-indicator" style:background-color={formCategoryColor}></div>
								{/if}
							</div>
							{#if showColorPicker}
								<div class="picker-container">
									<ColorPicker
										value={formCategoryColor}
										onselect={(color) => {
											formCategoryColor = color;
										}}
									/>
								</div>
							{/if}
						</div>

						<div class="form-group">
							<label for="categoryOrder">排序</label>
							<input
								id="categoryOrder"
								type="number"
								bind:value={formCategoryOrder}
								placeholder="0"
							/>
							<p class="field-hint">数字越小越靠前，支持拖放排序</p>
						</div>
					</div>

					<div class="modal-footer">
						<button class="btn btn-secondary" onclick={closeCategoryForm}> 取消 </button>
						<button class="btn btn-primary" onclick={handleSaveCategory} disabled={categorySaving}>
							{#if categorySaving}
								<span class="spinner"></span> 保存中...
							{:else}
								保存
							{/if}
						</button>
					</div>
				</div>
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

		<!-- 下载列表 -->
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
								selectedDownloadIds.clear();
							}
						}}
					>
						{showBulkActions ? '取消批量操作' : '批量操作'}
					</button>
				{/if}
			</div>

			{#if showBulkActions && downloads.length > 0}
				<div class="bulk-actions-bar">
					<label class="checkbox-label">
						<input
							type="checkbox"
							checked={selectedDownloadIds.size === downloads.length}
							onchange={toggleSelectAll}
						/>
						<span>全选 ({selectedDownloadIds.size} / {downloads.length})</span>
					</label>

					{#if selectedDownloadIds.size > 0}
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
								删除选中 ({selectedDownloadIds.size})
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
										checked={selectedDownloadIds.has(item.id)}
										onchange={() => {
											if (selectedDownloadIds.has(item.id)) {
												selectedDownloadIds.delete(item.id);
											} else {
												selectedDownloadIds.add(item.id);
											}
										}}
									/>
								</label>
							{/if}
							<div class="item-icon">{getPlatformIcon(item.platform)}</div>
							<div class="item-info">
								<div class="item-title">
									{item.title || `${item.platform.toUpperCase()} - ${item.version}`}
									<span class="badge badge-{item.storageType}"
										>{getStorageLabel(item.storageType)}</span
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
									<span
										>🔗 <a
											href={resolveAdminDownloadUrl(item)}
											target="_blank"
											rel="noopener"
											onclick={(event) => event.stopPropagation()}>{item.url.slice(0, 50)}...</a
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

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.section-header h2 {
		margin: 0;
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

	.field-hint {
		margin: 0;
		font-size: 0.85rem;
		color: #a89bc4;
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

	/* 分类列表 */
	.category-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.category-item {
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

	.category-item:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 20px rgba(107, 76, 154, 0.1);
	}

	.category-icon {
		font-size: 1.8rem;
		flex-shrink: 0;
	}

	.category-info {
		flex: 1;
		min-width: 0;
	}

	.category-name {
		font-weight: 600;
		color: #6b4c9a;
		font-size: 1.05rem;
	}

	.category-meta {
		font-size: 0.85rem;
		color: #8b7ba8;
		margin-top: 0.2rem;
	}

	.category-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.modal-backdrop {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		background: rgba(17, 8, 28, 0.4);
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
		max-width: 480px;
		background: rgba(255, 255, 255, 0.95);
		border-radius: 20px;
		padding: 1.75rem;
		box-shadow: 0 20px 50px rgba(107, 76, 154, 0.25);
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		position: relative;
		z-index: 1;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
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
		width: 34px;
		height: 34px;
		border-radius: 50%;
		cursor: pointer;
		font-size: 1.3rem;
		line-height: 1;
		transition: all 0.3s ease;
	}

	.modal-close:hover {
		background: rgba(107, 76, 154, 0.2);
		transform: translateY(-1px);
	}

	.modal-footer {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
		margin-top: 0.5rem;
	}

	.auth-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.auth-error {
		color: #ff6b9d;
		font-size: 0.9rem;
		margin: 0;
		text-align: left;
		background: rgba(255, 107, 157, 0.1);
		padding: 0.75rem;
		border-radius: 8px;
	}

	/* 新增样式 */

	/* 分类拖放列表增强 */
	.category-icon-wrapper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		position: relative;
		flex-shrink: 0;
	}

	.category-color-dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
	}

	.category-name-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.category-count-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		height: 20px;
		padding: 0 0.4rem;
		background: linear-gradient(135deg, #ff6b9d 0%, #6b4c9a 100%);
		color: white;
		border-radius: 10px;
		font-size: 0.75rem;
		font-weight: 600;
	}

	.category-desc {
		font-size: 0.85rem;
		color: #8b7ba8;
		margin-top: 0.2rem;
		line-height: 1.4;
	}

	.color-preview {
		display: inline-block;
		padding: 0.15rem 0.5rem;
		border-radius: 6px;
		font-size: 0.75rem;
		font-family: monospace;
		border: 1px solid rgba(107, 76, 154, 0.2);
		background: rgba(255, 255, 255, 0.8);
	}

	/* 模态框增强 */
	.modal-lg {
		max-width: 680px;
	}

	.modal-form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	.modal-form-grid .form-group:first-child,
	.modal-form-grid .form-group:nth-child(2) {
		grid-column: 1 / -1;
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
		cursor: pointer;
	}

	.color-indicator {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		border: 2px solid rgba(255, 255, 255, 0.8);
		flex-shrink: 0;
	}

	.picker-container {
		margin-top: 0.75rem;
	}

	.field-hint {
		margin: 0.25rem 0 0;
		font-size: 0.8rem;
		color: #a89bc4;
	}

	/* 批量操作样式 */
	.bulk-actions-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.5rem;
		background: rgba(255, 240, 247, 0.6);
		border-radius: 14px;
		margin-bottom: 1rem;
		border: 2px dashed rgba(107, 76, 154, 0.15);
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		font-weight: 500;
		color: #6b4c9a;
		user-select: none;
	}

	.checkbox-label input[type='checkbox'] {
		width: 18px;
		height: 18px;
		cursor: pointer;
	}

	.bulk-action-buttons {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.bulk-category-select {
		padding: 0.5rem 1rem;
		border: 2px solid rgba(107, 76, 154, 0.2);
		border-radius: 10px;
		font-size: 0.9rem;
		font-family: inherit;
		background: white;
		color: #6b4c9a;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.bulk-category-select:hover {
		border-color: #6b4c9a;
	}

	.item-checkbox {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		padding: 0 0.5rem;
	}

	.item-checkbox input[type='checkbox'] {
		width: 18px;
		height: 18px;
		cursor: pointer;
	}

	.badge-category {
		background: rgba(107, 76, 154, 0.08);
		color: #6b4c9a;
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

		.modal-form-grid {
			grid-template-columns: 1fr;
		}

		.bulk-actions-bar {
			flex-direction: column;
			align-items: flex-start;
		}

		.bulk-action-buttons {
			width: 100%;
			flex-direction: column;
		}

		.bulk-category-select {
			width: 100%;
		}
	}
</style>
