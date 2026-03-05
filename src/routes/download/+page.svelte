<script lang="ts">
	import type {
		DownloadItem,
		DownloadList as DownloadListData,
		ApiResponse,
		Category,
		CategoryList
	} from '$lib/types';

	import MascotAnimation from '$lib/components/MascotAnimation.svelte';
	import BackgroundDecorations from '$lib/components/BackgroundDecorations.svelte';
	import CategoryTabs from '$lib/components/CategoryTabs.svelte';
	import DownloadCard from '$lib/components/DownloadCard.svelte';
	import PasswordModal from '$lib/components/PasswordModal.svelte';
	import GuideModal from '$lib/components/GuideModal.svelte';
	import GuidePanel from '$lib/components/GuidePanel.svelte';
	import { isGuideVerified, setGuideVerified } from '$lib/utils/auth-state';
	import AnnouncementList from '$lib/components/AnnouncementList.svelte';

	// 数据状态
	let downloadCount = $state(0);
	let downloads = $state<DownloadItem[]>([]);
	let categories = $state<Category[]>([]);
	let loading = $state(true);

	// 分类选择
	let selectedCategoryId = $state<string | null>(null);

	// 下载状态
	let downloading = $state(false);
	let showPasswordModal = $state(false);
	let pendingItem = $state<DownloadItem | null>(null);

	// 配置指引状态
	let selectedItem = $state<DownloadItem | null>(null);
	let activeTab = $state<'download' | 'guide'>('download');
	let guideMessage = $state('下载完成后请查看这里的配置指引～');

	// 指引弹窗状态
	let showGuideModal = $state(false);
	let guideItem = $state<DownloadItem | null>(null);

	// 指引密码验证状态
	let isGuidePasswordVerified = $state(false);
	let pendingGuideItem = $state<DownloadItem | null>(null);
	let showGuidePasswordModal = $state(false);

	// Turnstile 状态
	let requireTurnstile = $state(false);
	let turnstileSiteKey = $state('');

	// 加载分类列表
	async function loadCategories() {
		try {
			const res = await fetch('/api/categories');
			const data: ApiResponse<CategoryList> = await res.json();
			if (data.success && data.data) {
				categories = data.data.items;
			}
		} catch (e) {
			console.error('Failed to load categories:', e);
		}
	}

	// 加载下载列表
	async function loadDownloads() {
		try {
			const res = await fetch('/api/downloads');
			const data: ApiResponse<DownloadListData> = await res.json();
			if (data.success && data.data) {
				downloads = data.data.items;
				downloadCount = data.data.downloadCount;
			}
		} catch (e) {
			console.error('Failed to load downloads:', e);
		} finally {
			loading = false;
		}
	}

	// 检查是否需要 Turnstile
	async function checkTurnstileRequired() {
		try {
			const res = await fetch('/api/downloads/link');
			const data: ApiResponse<{
				requireTurnstile: boolean;
				siteKey: string;
				failureCount: number;
			}> = await res.json();
			if (data.success && data.data) {
				requireTurnstile = data.data.requireTurnstile;
				turnstileSiteKey = data.data.siteKey;
			}
		} catch (e) {
			console.error('Failed to check turnstile status:', e);
		}
	}

	// 打开密码弹窗
	function openPasswordModal(item: DownloadItem) {
		pendingItem = item;
		showPasswordModal = true;
		checkTurnstileRequired();
	}

	// 关闭密码弹窗
	function closePasswordModal() {
		showPasswordModal = false;
		pendingItem = null;
	}

	// 处理下载提交
	async function handleDownloadSubmit(password: string, turnstileToken: string) {
		if (!pendingItem) return;

		downloading = true;
		try {
			const res = await fetch('/api/downloads/link', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					itemId: pendingItem.id,
					password,
					turnstileToken: turnstileToken || undefined
				})
			});
			const data: ApiResponse<{
				url: string;
				filename?: string;
				count?: number;
				requireTurnstile?: boolean;
				siteKey?: string;
			}> = await res.json();

			if (data.success && data.data?.url) {
				if (typeof data.data.count === 'number') {
					downloadCount = data.data.count;
				}
				isGuidePasswordVerified = true;
				setGuideVerified();
				selectedItem = pendingItem;
				activeTab = 'guide';
				guideMessage = '下载已开始，下面是配置指引～';

				// 触发下载
				const link = document.createElement('a');
				link.href = data.data.url;
				link.target = '_blank';
				link.rel = 'noopener';
				if (data.data.filename) {
					link.download = data.data.filename;
				}
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				closePasswordModal();
			} else {
				// 检查是否需要启用 Turnstile
				if (data.data?.requireTurnstile && data.data?.siteKey) {
					requireTurnstile = true;
					turnstileSiteKey = data.data.siteKey;
				}
				throw new Error(data.error || '获取下载链接失败');
			}
		} finally {
			downloading = false;
		}
	}

	// 打开指引弹窗
	function openGuideModal(item: DownloadItem) {
		if (isGuidePasswordVerified || isGuideVerified()) {
			guideItem = item;
			showGuideModal = true;
		} else {
			pendingGuideItem = item;
			showGuidePasswordModal = true;
			checkTurnstileRequired();
		}
	}

	// 关闭指引密码弹窗
	function closeGuidePasswordModal() {
		showGuidePasswordModal = false;
		pendingGuideItem = null;
	}

	// 指引密码验证提交
	async function handleGuidePasswordSubmit(password: string, turnstileToken: string) {
		const res = await fetch('/api/downloads/link', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				password,
				turnstileToken: turnstileToken || undefined,
				action: 'guide'
			})
		});
		const data: ApiResponse<{ verified: boolean; requireTurnstile?: boolean; siteKey?: string }> =
			await res.json();

		if (data.success) {
			isGuidePasswordVerified = true;
			setGuideVerified();
			if (pendingGuideItem) {
				guideItem = pendingGuideItem;
				showGuideModal = true;
			}
			closeGuidePasswordModal();
		} else {
			if (data.data?.requireTurnstile && data.data?.siteKey) {
				requireTurnstile = true;
				turnstileSiteKey = data.data.siteKey;
			}
			throw new Error(data.error || '验证失败');
		}
	}

	// 关闭指引弹窗
	function closeGuideModal() {
		showGuideModal = false;
		guideItem = null;
	}

	// 选择分类
	function selectCategory(categoryId: string | null) {
		selectedCategoryId = categoryId;
	}

	// 选择标签
	function selectTab(tab: 'download' | 'guide') {
		activeTab = tab;
	}

	// 过滤下载项（根据选中的分类）
	function getFilteredDownloads(): DownloadItem[] {
		if (!selectedCategoryId) {
			return downloads.filter((item) => item.enabled);
		}
		return downloads.filter((item) => item.enabled && item.categoryId === selectedCategoryId);
	}

	// 初始加载
	$effect(() => {
		loadCategories();
		loadDownloads();
	});
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@300;400;500;600;700&display=swap"
		rel="stylesheet"
	/>
	<title>下载 - PlayDota2Win</title>
</svelte:head>

<div class="page-container">
	<!-- 背景装饰 -->
	<BackgroundDecorations />

	<!-- 主内容区 -->
	<main class="main-content">
		<!-- 可爱的角色/图标区域 -->
		<MascotAnimation />

		<!-- 标题区 -->
		<div class="title-section">
			<h1 class="main-title">
				<span class="title-text">PlayDota2Win</span>
				<span class="title-emoji">🎮</span>
			</h1>
			<p class="subtitle">下载下载下载</p>
			<div class="download-stats">
				<span class="stats-icon">💝</span>
				<span class="stats-text"
					>已有 <strong>{downloadCount.toLocaleString()}</strong> 位小伙伴下载</span
				>
			</div>
		</div>

		<!-- 分类选项卡 -->
		<CategoryTabs {categories} {downloads} {selectedCategoryId} onSelect={selectCategory} />

		<!-- 公告列表 -->
		<AnnouncementList />

		<!-- 下载按钮区 -->
		<div class="download-section">
			<div class="tab-bar" role="tablist">
				<button
					class="tab-btn"
					class:active={activeTab === 'download'}
					type="button"
					role="tab"
					aria-selected={activeTab === 'download'}
					onclick={() => selectTab('download')}
				>
					下载
				</button>
				<button
					class="tab-btn"
					class:active={activeTab === 'guide'}
					type="button"
					role="tab"
					aria-selected={activeTab === 'guide'}
					onclick={() => selectTab('guide')}
				>
					配置指引
				</button>
			</div>

			{#if activeTab === 'download'}
				{#if loading}
					<div class="loading-downloads">
						<div class="spinner"></div>
						<span>加载中...</span>
					</div>
				{:else if downloads.length === 0}
					<div class="no-downloads">
						<span>📦</span>
						<p>暂无可用的下载</p>
						<p class="hint">请稍后再来看看～</p>
					</div>
				{:else if getFilteredDownloads().length === 0}
					<div class="no-downloads">
						<span>🔍</span>
						<p>该分类暂无下载</p>
						<p class="hint">试试其他分类吧～</p>
					</div>
				{:else}
					<div class="download-list">
						{#each getFilteredDownloads() as item (item.id)}
							<DownloadCard
								{item}
								{downloading}
								onDownload={openPasswordModal}
								onGuide={openGuideModal}
							/>
						{/each}
					</div>
				{/if}
			{:else}
				<GuidePanel item={selectedItem} message={guideMessage} />
			{/if}
		</div>

		<!-- 密码弹窗 -->
		{#if showPasswordModal && pendingItem}
			<PasswordModal
				item={pendingItem}
				{requireTurnstile}
				{turnstileSiteKey}
				onClose={closePasswordModal}
				onSubmit={handleDownloadSubmit}
			/>
		{/if}

		<!-- 配置指引弹窗 -->
		{#if showGuideModal && guideItem}
			<GuideModal item={guideItem} onClose={closeGuideModal} />
		{/if}

		<!-- 指引密码弹窗 -->
		{#if showGuidePasswordModal && pendingGuideItem}
			<PasswordModal
				item={pendingGuideItem}
				{requireTurnstile}
				{turnstileSiteKey}
				onClose={closeGuidePasswordModal}
				onSubmit={handleGuidePasswordSubmit}
			/>
		{/if}

		<!-- 底部提示 -->
		<footer class="footer">
			<p>Windows 10+</p>
			<p class="footer-love">playdota2.win</p>
		</footer>
	</main>
</div>

<style>
	/* 基础变量 */
	:global(body) {
		margin: 0;
		padding: 0;
	}

	.page-container {
		min-height: 100vh;
		background: linear-gradient(135deg, #fff5f7 0%, #f0e6ff 50%, #e6f0ff 100%);
		font-family: 'Nunito', 'PingFang SC', 'Microsoft YaHei', sans-serif;
		position: relative;
		overflow-x: hidden;
	}

	/* 主内容 */
	.main-content {
		position: relative;
		z-index: 1;
		max-width: 600px;
		margin: 0 auto;
		padding: 3rem 1.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2rem;
	}

	/* 标题区 */
	.title-section {
		text-align: center;
	}

	.main-title {
		font-family: 'Fredoka', sans-serif;
		font-size: 2.8rem;
		font-weight: 700;
		color: #6b4c9a;
		margin: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		text-shadow: 2px 2px 0 #ffe4ec;
	}

	.title-emoji {
		animation: wiggle 2s ease-in-out infinite;
	}

	@keyframes wiggle {
		0%,
		100% {
			transform: rotate(-5deg);
		}
		50% {
			transform: rotate(5deg);
		}
	}

	.subtitle {
		font-size: 1.2rem;
		color: #8b7ba8;
		margin: 0.8rem 0;
		font-weight: 500;
	}

	.download-stats {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: rgba(255, 255, 255, 0.7);
		padding: 0.6rem 1.2rem;
		border-radius: 50px;
		font-size: 0.95rem;
		color: #6b4c9a;
		box-shadow: 0 4px 15px rgba(107, 76, 154, 0.1);
		backdrop-filter: blur(10px);
	}

	.download-stats strong {
		color: #ff6b9d;
		font-weight: 700;
	}

	/* 下载区域 */
	.download-section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
		max-width: 720px;
	}

	.tab-bar {
		display: flex;
		gap: 0.75rem;
		padding: 0.4rem;
		background: rgba(255, 255, 255, 0.7);
		border-radius: 999px;
		box-shadow: 0 8px 20px rgba(107, 76, 154, 0.12);
		backdrop-filter: blur(10px);
	}

	.tab-btn {
		flex: 1;
		border: none;
		background: transparent;
		color: #8b7ba8;
		font-weight: 600;
		font-family: inherit;
		padding: 0.6rem 1rem;
		border-radius: 999px;
		cursor: pointer;
		transition:
			transform 0.3s ease,
			box-shadow 0.3s ease,
			background 0.3s ease,
			color 0.3s ease;
	}

	.tab-btn:hover {
		transform: translateY(-1px);
		color: #6b4c9a;
	}

	.tab-btn.active {
		background: linear-gradient(135deg, #ff9ec4 0%, #c8b2ff 100%);
		color: #2d1b4e;
		box-shadow: 0 8px 20px rgba(255, 107, 157, 0.35);
	}

	.download-list {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 1rem;
	}

	/* 加载状态 */
	.loading-downloads {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 2rem;
		color: #8b7ba8;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid rgba(107, 76, 154, 0.2);
		border-top-color: #6b4c9a;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.no-downloads {
		text-align: center;
		padding: 3rem 2rem;
		color: #8b7ba8;
		background: rgba(255, 255, 255, 0.6);
		border-radius: 20px;
		backdrop-filter: blur(10px);
	}

	.no-downloads span {
		font-size: 4rem;
		display: block;
		margin-bottom: 1rem;
		animation: float 3s ease-in-out infinite;
	}

	@keyframes float {
		0%,
		100% {
			transform: translateY(0) rotate(0deg);
		}
		50% {
			transform: translateY(-20px) rotate(10deg);
		}
	}

	.no-downloads p {
		margin: 0.5rem 0;
		font-size: 1.1rem;
		font-weight: 600;
		color: #6b4c9a;
	}

	.no-downloads .hint {
		font-size: 0.9rem;
		font-weight: 400;
		color: #a89bc4;
	}

	/* 底部 */
	.footer {
		text-align: center;
		margin-top: 2rem;
		color: #a89bc4;
		font-size: 0.9rem;
	}

	.footer p {
		margin: 0.3rem 0;
	}

	.footer-love {
		font-size: 0.85rem;
	}

	/* 响应式 */
	@media (max-width: 600px) {
		.main-title {
			font-size: 2rem;
		}

		.download-list {
			grid-template-columns: 1fr;
		}
	}
</style>
