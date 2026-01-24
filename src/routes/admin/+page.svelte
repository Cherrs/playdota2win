<script lang="ts">
	import type {
		DownloadItem,
		DownloadList as DownloadListData,
		ApiResponse,
		Category,
		CategoryList
	} from '$lib/types';
	import AdminLogin from '$lib/components/AdminLogin.svelte';
	import AdminHeader from '$lib/components/AdminHeader.svelte';
	import CategoryManager from '$lib/components/CategoryManager.svelte';
	import DownloadForm from '$lib/components/DownloadForm.svelte';
	import DownloadListComponent from '$lib/components/DownloadList.svelte';
	import DownloadEditModal from '$lib/components/DownloadEditModal.svelte';

	// 认证状态
	let isAuthenticated = $state(false);

	// 数据状态
	let downloads = $state<DownloadItem[]>([]);
	let categories = $state<Category[]>([]);
	let downloadCount = $state(0);
	let loading = $state(true);
	let error = $state('');
	let success = $state('');

	// 编辑状态
	let editingItem = $state<DownloadItem | null>(null);

	// 登出
	function handleLogout() {
		localStorage.removeItem('admin_token');
		isAuthenticated = false;
	}

	// 检查是否已登录
	async function checkAuth() {
		const token = localStorage.getItem('admin_token');
		if (token) {
			isAuthenticated = true;
			await Promise.all([loadDownloads(), loadCategories()]);
		} else {
			loading = false;
		}
	}

	// 处理登录成功
	function handleLoginSuccess() {
		isAuthenticated = true;
		loadDownloads();
		loadCategories();
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
			const data: ApiResponse<DownloadListData> = await res.json();
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

	// 加载分类列表
	async function loadCategories() {
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
			}
		} catch {
			console.error('Failed to load categories');
		}
	}

	// 切换启用状态
	async function handleToggleEnabled(item: DownloadItem) {
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

	// 处理编辑保存
	function handleEditSave(item: DownloadItem) {
		downloads = downloads.map((d) => (d.id === item.id ? item : d));
		success = '更新成功！';
		editingItem = null;
	}

	// 处理添加成功
	function handleAddSuccess(item: DownloadItem) {
		downloads = [...downloads, item];
	}

	// 处理分类变化
	function handleCategoriesChange(newCategories: Category[]) {
		categories = newCategories;
	}

	// 初始加载
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
	<AdminLogin onLoginSuccess={handleLoginSuccess} />
{:else}
	<div class="admin-container">
		<AdminHeader {downloadCount} itemCount={downloads.length} onLogout={handleLogout} />

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

		<CategoryManager
			bind:categories
			{downloads}
			onCategoriesChange={handleCategoriesChange}
			onReloadDownloads={loadDownloads}
		/>

		<DownloadForm {categories} onAdd={handleAddSuccess} />

		<DownloadListComponent
			{downloads}
			{categories}
			{loading}
			onEdit={(item: DownloadItem) => (editingItem = item)}
			onToggleEnabled={handleToggleEnabled}
			onDelete={handleDelete}
			onReload={loadDownloads}
		/>

		{#if editingItem}
			<DownloadEditModal
				item={editingItem}
				{categories}
				onSave={handleEditSave}
				onClose={() => (editingItem = null)}
			/>
		{/if}
	</div>
{/if}

<style>
	:global(body) {
		margin: 0;
		padding: 0;
	}

	.admin-container {
		min-height: 100vh;
		background: linear-gradient(135deg, #fff5f7 0%, #f0e6ff 50%, #e6f0ff 100%);
		font-family: 'Nunito', 'PingFang SC', 'Microsoft YaHei', sans-serif;
		padding: 2rem;
	}

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

	@media (max-width: 768px) {
		.admin-container {
			padding: 1rem;
		}
	}
</style>
