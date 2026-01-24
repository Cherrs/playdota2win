<script lang="ts">
	import type {
		DownloadItem,
		DownloadList,
		ApiResponse,
		Platform,
		Category,
		CategoryList
	} from '$lib/types';

	let isHovering = $state(false);
	let downloadCount = $state(0);
	let downloads = $state<DownloadItem[]>([]);
	let loading = $state(true);

	// 分类相关
	let categories = $state<Category[]>([]);
	let selectedCategoryId = $state<string | null>(null);

	// 下载密码
	let password = $state('');
	let downloadError = $state('');
	let downloading = $state(false);
	let showPasswordModal = $state(false);
	let pendingItem = $state<DownloadItem | null>(null);
	let selectedItem = $state<DownloadItem | null>(null);
	let activeTab = $state<'download' | 'guide'>('download');
	let guideMessage = $state('下载完成后请查看这里的配置指引～');

	// 指引弹窗状态
	let showGuideModal = $state(false);
	let guideItem = $state<DownloadItem | null>(null);

	function openGuideModal(item: DownloadItem) {
		guideItem = item;
		showGuideModal = true;
	}

	function closeGuideModal() {
		showGuideModal = false;
		guideItem = null;
	}

	function parseMarkdown(text: string): string {
		if (!text) return '';

		// Escape HTML
		const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

		const lines = escaped.split(/\r?\n/);
		let output = '';
		let inList = false;

		const parseInline = (t: string) =>
			t
				.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
				.replace(/\*(.*?)\*/g, '<em>$1</em>')
				.replace(/`(.*?)`/g, '<code>$1</code>')
				.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

		for (let line of lines) {
			// Headers
			if (line.startsWith('#')) {
				if (inList) {
					output += '</ul>';
					inList = false;
				}
				const levelMatch = line.match(/^#+/);
				const level = levelMatch ? levelMatch[0].length : 1;
				const content = line.substring(level).trim();
				// Shift header levels: # -> h3, ## -> h4
				const tagName = 'h' + Math.min(level + 2, 6);
				output += `<${tagName}>${parseInline(content)}</${tagName}>`;
				continue;
			}

			// List items
			if (line.match(/^\s*-\s/)) {
				if (!inList) {
					output += '<ul>';
					inList = true;
				}
				const content = line.replace(/^\s*-\s/, '');
				output += `<li>${parseInline(content)}</li>`;
				continue;
			}

			// End list if needed
			if (inList && line.trim() === '') {
				output += '</ul>';
				inList = false;
				continue;
			}
			if (inList && !line.match(/^\s*-\s/) && line.trim()) {
				output += '</ul>';
				inList = false;
			}

			// Regular lines
			if (line.trim()) {
				output += `<p>${parseInline(line)}</p>`;
			}
		}
		if (inList) output += '</ul>';
		return output;
	}

	function stripHtmlTags(markup: string): string {
		return markup.replace(/<[^>]*>/g, '');
	}

	// Turnstile 状态
	let requireTurnstile = $state(false);
	let turnstileSiteKey = $state('');
	let turnstileToken = $state('');
	let turnstileWidgetId = $state<string | null>(null);
	let turnstileLoaded = $state(false);

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
			const data: ApiResponse<DownloadList> = await res.json();
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

	function getPlatformLabel(platform: Platform): string {
		switch (platform) {
			case 'windows':
				return 'Windows';
			case 'macos':
				return 'macOS';
			case 'linux':
				return 'Linux';
			default:
				return platform;
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

		const container = document.getElementById('download-turnstile-container');
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
				downloadError = '人机验证加载失败，请刷新页面重试';
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

	function openPasswordModal(item: DownloadItem) {
		pendingItem = item;
		password = '';
		downloadError = '';
		turnstileToken = '';
		showPasswordModal = true;
		checkTurnstileRequired();
	}

	function selectTab(tab: 'download' | 'guide') {
		activeTab = tab;
	}

	function parseGuideSteps(guide?: string): string[] {
		if (!guide) return [];
		return guide
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
	}

	function getGuideAction(step: string): { type: 'copy' | 'open'; value: string } | null {
		const copyMatch = step.match(/^\s*(?:复制|copy)\s*[:：]?\s*(.+)$/i);
		if (copyMatch?.[1]) {
			return { type: 'copy', value: copyMatch[1].trim() };
		}
		const openMatch = step.match(/^\s*(?:打开|open)\s*[:：]?\s*(\S+)\s*$/i);
		if (openMatch?.[1]) {
			return { type: 'open', value: openMatch[1].trim() };
		}
		const urlMatch = step.match(/\b(?:mumble|https?):\/\/[^\s]+/i);
		if (urlMatch) {
			return { type: 'open', value: urlMatch[0] };
		}
		return null;
	}

	async function handleGuideAction(action: { type: 'copy' | 'open'; value: string }) {
		if (action.type === 'copy') {
			try {
				await navigator.clipboard.writeText(action.value);
				guideMessage = `已复制：${action.value}`;
			} catch (e) {
				console.error('Failed to copy text:', e);
				guideMessage = '复制失败，请手动复制。';
			}
			return;
		}

		if (action.type === 'open') {
			window.open(action.value, '_blank', 'noopener');
			guideMessage = `已打开：${action.value}`;
		}
	}

	function closePasswordModal() {
		showPasswordModal = false;
		pendingItem = null;
		password = '';
		downloadError = '';
		turnstileToken = '';
	}

	async function handleDownloadItem(item: DownloadItem) {
		if (!password.trim()) {
			downloadError = '请输入下载密码';
			return;
		}

		if (requireTurnstile && !turnstileToken) {
			downloadError = '请完成人机验证';
			return;
		}

		downloading = true;
		downloadError = '';
		try {
			const res = await fetch('/api/downloads/link', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					itemId: item.id,
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
			console.log('[Download] API Response:', data);
			console.log('[Download] URL from API:', data.data?.url);
			if (data.success && data.data?.url) {
				if (typeof data.data.count === 'number') {
					downloadCount = data.data.count;
				}
				selectedItem = item;
				activeTab = 'guide';
				guideMessage = '下载已开始，下面是配置指引～';
				console.log('[Download] Creating download link with URL:', data.data.url);
				const link = document.createElement('a');
				link.href = data.data.url;
				console.log('[Download] Link href after assignment:', link.href);
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
				downloadError = data.error || '获取下载链接失败';

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
			console.error('Failed to get download link:', e);
			downloadError = '获取下载链接失败';
			if (requireTurnstile) {
				resetTurnstile();
			}
		} finally {
			downloading = false;
		}
	}

	// 初始加载
	$effect(() => {
		loadCategories();
		loadDownloads();
	});

	// 过滤下载项（根据选中的分类）
	function getFilteredDownloads(): DownloadItem[] {
		if (!selectedCategoryId) {
			return downloads.filter((item) => item.enabled);
		}
		return downloads.filter((item) => item.enabled && item.categoryId === selectedCategoryId);
	}

	function selectCategory(categoryId: string | null) {
		selectedCategoryId = categoryId;
	}
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
	<div class="bg-decorations">
		<div class="floating-star star-1">✦</div>
		<div class="floating-star star-2">★</div>
		<div class="floating-star star-3">✧</div>
		<div class="floating-star star-4">❋</div>
		<div class="floating-cloud cloud-1">☁</div>
		<div class="floating-cloud cloud-2">☁</div>
	</div>

	<!-- 主内容区 -->
	<main class="main-content">
		<!-- 可爱的角色/图标区域 -->
		<div class="mascot-area">
			<div
				class="mascot-container"
				onmouseenter={() => (isHovering = true)}
				onmouseleave={() => (isHovering = false)}
				role="img"
				aria-label="可爱的吉祥物"
			>
				<div class="mascot" class:bouncing={isHovering}>
					<svg viewBox="0 0 120 120" class="mascot-svg">
						<!-- 身体 -->
						<circle cx="60" cy="65" r="45" fill="#FFE4EC" />
						<!-- 脸蛋红晕 -->
						<ellipse cx="30" cy="70" rx="10" ry="6" fill="#FFB6C1" opacity="0.6" />
						<ellipse cx="90" cy="70" rx="10" ry="6" fill="#FFB6C1" opacity="0.6" />
						<!-- 眼睛 -->
						<circle cx="42" cy="58" r="8" fill="#2D1B4E" />
						<circle cx="78" cy="58" r="8" fill="#2D1B4E" />
						<!-- 眼睛高光 -->
						<circle cx="45" cy="55" r="3" fill="#FFFFFF" />
						<circle cx="81" cy="55" r="3" fill="#FFFFFF" />
						<!-- 微笑 -->
						<path
							d="M 48 78 Q 60 88 72 78"
							stroke="#2D1B4E"
							stroke-width="3"
							fill="none"
							stroke-linecap="round"
						/>
						<!-- 猫耳朵 -->
						<path d="M 25 30 L 35 55 L 15 50 Z" fill="#FFE4EC" />
						<path d="M 95 30 L 85 55 L 105 50 Z" fill="#FFE4EC" />
						<path d="M 27 35 L 34 52 L 20 48 Z" fill="#FFB6C1" />
						<path d="M 93 35 L 86 52 L 100 48 Z" fill="#FFB6C1" />
					</svg>
				</div>
				<div class="sparkles">
					<span class="sparkle">✨</span>
					<span class="sparkle">💫</span>
					<span class="sparkle">✨</span>
				</div>
			</div>
		</div>

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
		{#if categories.length > 0}
			<div class="category-tabs">
				<button
					class="category-tab"
					class:active={selectedCategoryId === null}
					onclick={() => selectCategory(null)}
					type="button"
				>
					<span class="tab-icon">🌟</span>
					<span class="tab-label">全部</span>
					<span class="tab-count">{downloads.filter((d) => d.enabled).length}</span>
				</button>
				{#each categories as category (category.id)}
					{@const count = downloads.filter((d) => d.enabled && d.categoryId === category.id).length}
					<button
						class="category-tab"
						class:active={selectedCategoryId === category.id}
						onclick={() => selectCategory(category.id)}
						type="button"
						style:--category-color={category.color || '#6B4C9A'}
					>
						{#if category.icon}
							<span class="tab-icon">{category.icon}</span>
						{/if}
						<span class="tab-label">{category.name}</span>
						{#if count > 0}
							<span class="tab-count">{count}</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}

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
							<div class="download-card">
								<div class="card-header">
									<div class="card-platform">
										<span class="platform-badge">{getPlatformLabel(item.platform)}</span>
										<span class="storage-badge">{item.storageType.toUpperCase()}</span>
									</div>
									<h3 class="card-title">
										{item.title || `${getPlatformLabel(item.platform)} 版本`}
									</h3>
								</div>
								<div class="card-meta">
									<span>版本 {item.version}</span>
									<span>大小 {item.size}</span>
									{#if item.description}
										<span class="card-desc">{item.description}</span>
									{/if}
									{#if item.filename}
										<span>文件 {item.filename}</span>
									{/if}
								</div>
								<div class="card-actions">
									<button
										class="card-btn btn-outline"
										onclick={() => openGuideModal(item)}
										type="button"
									>
										配置指引
									</button>
									<button
										class="card-btn btn-primary"
										onclick={() => openPasswordModal(item)}
										disabled={downloading}
									>
										<span>立即下载</span>
										<span class="btn-arrow">→</span>
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{:else}
				<div class="guide-panel" role="tabpanel">
					<div class="guide-header">
						<h3>配置指引</h3>
						{#if selectedItem}
							<p>
								{selectedItem.title || `${getPlatformLabel(selectedItem.platform)} 版本`}
							</p>
						{/if}
					</div>
					<p class="guide-message">{guideMessage}</p>
					{#if selectedItem && parseGuideSteps(selectedItem.configGuide).length > 0}
						<ol class="guide-steps">
							{#each parseGuideSteps(selectedItem.configGuide) as step (step)}
								{@const action = getGuideAction(step)}
								<li>
									<div class="guide-step-text">{step}</div>
									{#if action}
										<button class="guide-action" onclick={() => handleGuideAction(action)}>
											{action.type === 'copy' ? '点击复制' : '打开链接'}
										</button>
									{/if}
								</li>
							{/each}
						</ol>
					{:else}
						<div class="guide-empty">
							<span>🌸</span>
							<p>暂无配置指引，请联系管理员补充～</p>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		{#if showPasswordModal}
			<div class="modal-backdrop" role="dialog" aria-modal="true">
				<button
					type="button"
					class="modal-scrim"
					onclick={closePasswordModal}
					onkeydown={(e) =>
						(e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') && closePasswordModal()}
					aria-label="关闭"
				></button>
				<div class="modal-card">
					<div class="modal-header">
						<h3>🔐 输入下载密码</h3>
						<button class="modal-close" onclick={closePasswordModal}>×</button>
					</div>
					{#if pendingItem}
						<p class="modal-subtitle">
							{pendingItem.title || `${getPlatformLabel(pendingItem.platform)} 版本`}
						</p>
					{/if}
					<div class="auth-form">
						<input
							type="password"
							class="auth-input"
							placeholder="请输入下载密码"
							bind:value={password}
							disabled={downloading}
						/>

						{#if requireTurnstile}
							<div class="turnstile-wrapper">
								<div id="download-turnstile-container"></div>
								{#if !turnstileToken}
									<p class="turnstile-hint">🤖 请完成人机验证</p>
								{:else}
									<p class="turnstile-success">✅ 验证通过</p>
								{/if}
							</div>
						{/if}

						{#if downloadError}
							<p class="auth-error">{downloadError}</p>
						{/if}
					</div>
					<button
						class="modal-btn"
						onclick={() => pendingItem && handleDownloadItem(pendingItem)}
						disabled={downloading || (requireTurnstile && !turnstileToken)}
					>
						{#if downloading}
							<span class="spinner"></span>
							下载中...
						{:else}
							开始下载 →
						{/if}
					</button>
				</div>
			</div>
		{/if}

		{#if showGuideModal && guideItem}
			<div class="modal-backdrop" role="dialog" aria-modal="true">
				<button
					type="button"
					class="modal-scrim"
					onclick={closeGuideModal}
					onkeydown={(e) =>
						(e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') && closeGuideModal()}
					aria-label="关闭"
				></button>
				<div class="modal-card modal-lg">
					<div class="modal-header">
						<h3>📖 配置指引</h3>
						<button class="modal-close" onclick={closeGuideModal}>×</button>
					</div>
					<p class="modal-subtitle">
						{guideItem.title || `${getPlatformLabel(guideItem.platform)} 版本`}
					</p>
					<div class="guide-content-scroll">
						{#if guideItem.configGuide}
							<div class="markdown-body">
								{stripHtmlTags(parseMarkdown(guideItem.configGuide))}
							</div>
						{:else}
							<div class="guide-empty">
								<span>🌸</span>
								<p>暂无配置指引，请联系管理员补充～</p>
							</div>
						{/if}
					</div>
					<div class="modal-footer">
						<button class="modal-btn" onclick={closeGuideModal}> 我学会啦！ </button>
					</div>
				</div>
			</div>
		{/if}

		<!-- 特性卡片 -->
		<!-- <div class="features-section">
			<div class="feature-card">
				<div class="feature-icon">⚡</div>
				<h3>超快启动</h3>
				<p>秒速加载，不耽误你的对局</p>
			</div>
			<div class="feature-card">
				<div class="feature-icon">🎯</div>
				<h3>精准数据</h3>
				<p>实时战绩分析，助你上分</p>
			</div>
			<div class="feature-card">
				<div class="feature-icon">💖</div>
				<h3>免费使用</h3>
				<p>完全免费，无广告打扰</p>
			</div>
		</div> -->

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

	/* 背景装饰 */
	.bg-decorations {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		pointer-events: none;
		z-index: 0;
	}

	.floating-star {
		position: absolute;
		font-size: 2rem;
		color: #ffb6c1;
		animation: float 6s ease-in-out infinite;
		opacity: 0.6;
	}

	.star-1 {
		top: 10%;
		left: 10%;
		animation-delay: 0s;
		color: #ffd700;
	}
	.star-2 {
		top: 20%;
		right: 15%;
		animation-delay: 1s;
		color: #ff69b4;
	}
	.star-3 {
		bottom: 30%;
		left: 8%;
		animation-delay: 2s;
		color: #dda0dd;
	}
	.star-4 {
		bottom: 20%;
		right: 10%;
		animation-delay: 3s;
		color: #87ceeb;
	}

	.floating-cloud {
		position: absolute;
		font-size: 4rem;
		color: #ffffff;
		opacity: 0.5;
		animation: drift 20s linear infinite;
	}

	.cloud-1 {
		top: 15%;
		left: -10%;
		animation-duration: 25s;
	}
	.cloud-2 {
		top: 60%;
		left: -10%;
		animation-duration: 30s;
		animation-delay: 10s;
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

	@keyframes drift {
		from {
			transform: translateX(-100px);
		}
		to {
			transform: translateX(calc(100vw + 100px));
		}
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

	/* 吉祥物区域 */
	.mascot-area {
		margin-bottom: 1rem;
	}

	.mascot-container {
		position: relative;
		cursor: pointer;
	}

	.mascot {
		width: 140px;
		height: 140px;
		transition: transform 0.3s ease;
	}

	.mascot.bouncing {
		animation: bounce 0.5s ease infinite;
	}

	.mascot-svg {
		width: 100%;
		height: 100%;
		filter: drop-shadow(0 10px 20px rgba(255, 182, 193, 0.4));
	}

	.sparkles {
		position: absolute;
		top: -10px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 0.5rem;
		opacity: 0;
		transition: opacity 0.3s ease;
	}

	.mascot-container:hover .sparkles {
		opacity: 1;
	}

	.sparkle {
		animation: sparkle 1s ease-in-out infinite;
	}

	.sparkle:nth-child(2) {
		animation-delay: 0.2s;
	}
	.sparkle:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes bounce {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-10px);
		}
	}

	@keyframes sparkle {
		0%,
		100% {
			transform: scale(1);
			opacity: 1;
		}
		50% {
			transform: scale(1.3);
			opacity: 0.7;
		}
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

	/* 分类选项卡 */
	.category-tabs {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		justify-content: center;
		width: 100%;
		max-width: 720px;
		padding: 0.5rem;
	}

	.category-tab {
		--category-color: #6b4c9a;
		border: none;
		background: rgba(255, 255, 255, 0.75);
		backdrop-filter: blur(10px);
		color: #8b7ba8;
		font-weight: 600;
		font-family: inherit;
		font-size: 0.95rem;
		padding: 0.65rem 1.2rem;
		border-radius: 50px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease,
			background 0.2s ease,
			color 0.2s ease;
		box-shadow: 0 4px 12px rgba(107, 76, 154, 0.08);
		position: relative;
	}

	.category-tab:hover {
		transform: translateY(-2px);
		box-shadow: 0 6px 18px rgba(107, 76, 154, 0.15);
		color: var(--category-color);
		background: rgba(255, 255, 255, 0.9);
	}

	.category-tab.active {
		background: linear-gradient(135deg, #ffd6e8 0%, #e8d6ff 100%);
		color: var(--category-color);
		box-shadow: 0 6px 18px color-mix(in srgb, var(--category-color) 25%, transparent);
	}

	.category-tab.active::before {
		content: '';
		position: absolute;
		bottom: 0;
		left: 50%;
		transform: translateX(-50%);
		width: 60%;
		height: 3px;
		background: var(--category-color);
		border-radius: 2px 2px 0 0;
	}

	.category-tab .tab-icon {
		font-size: 1.1rem;
		line-height: 1;
	}

	.category-tab .tab-label {
		line-height: 1;
	}

	.category-tab .tab-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 0.35rem;
		background: rgba(107, 76, 154, 0.15);
		color: var(--category-color);
		border-radius: 9px;
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1;
	}

	.category-tab.active .tab-count {
		background: var(--category-color);
		color: white;
	}

	/* 下载按钮 */
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

	.guide-panel {
		background: rgba(255, 255, 255, 0.9);
		border-radius: 20px;
		padding: 1.5rem;
		box-shadow: 0 12px 30px rgba(107, 76, 154, 0.12);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.guide-header h3 {
		margin: 0;
		font-family: 'Fredoka', sans-serif;
		color: #6b4c9a;
		font-size: 1.3rem;
	}

	.guide-header p {
		margin: 0.3rem 0 0;
		color: #8b7ba8;
		font-size: 0.95rem;
	}

	.guide-message {
		margin: 0;
		color: #6b4c9a;
		background: rgba(255, 255, 255, 0.8);
		border-radius: 12px;
		padding: 0.8rem 1rem;
		box-shadow: inset 0 0 0 1px rgba(107, 76, 154, 0.08);
	}

	.guide-steps {
		margin: 0;
		padding-left: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		color: #4d3a73;
	}

	.guide-steps li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.8rem;
		background: rgba(255, 240, 247, 0.8);
		border-radius: 12px;
		box-shadow: 0 6px 16px rgba(107, 76, 154, 0.08);
	}

	.guide-step-text {
		flex: 1;
		min-width: 180px;
		color: #2d1b4e;
	}

	.guide-action {
		border: none;
		background: linear-gradient(135deg, #ff6b9d 0%, #6b4c9a 100%);
		color: white;
		font-weight: 600;
		font-family: inherit;
		padding: 0.45rem 0.9rem;
		border-radius: 999px;
		cursor: pointer;
		transition:
			transform 0.3s ease,
			box-shadow 0.3s ease;
	}

	.guide-action:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 18px rgba(255, 107, 157, 0.35);
	}

	.guide-empty {
		text-align: center;
		color: #8b7ba8;
		padding: 1rem 0;
	}

	.guide-empty span {
		font-size: 2rem;
		display: block;
		margin-bottom: 0.5rem;
	}

	.auth-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.auth-input {
		width: 100%;
		padding: 0.9rem 1.2rem;
		border: 2px solid #e8e0f0;
		border-radius: 14px;
		font-size: 1rem;
		font-family: inherit;
		background: rgba(255, 255, 255, 0.8);
		transition: all 0.3s ease;
		outline: none;
		box-sizing: border-box;
	}

	.auth-input:focus {
		border-color: #b8a5d0;
		box-shadow: 0 0 0 4px rgba(107, 76, 154, 0.1);
	}

	.auth-input::placeholder {
		color: #b8a5d0;
	}

	.auth-error {
		color: #ff6b9d;
		font-size: 0.9rem;
		margin: 0;
		text-align: left;
	}

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
		z-index: 10;
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
		max-width: 420px;
		background: rgba(255, 255, 255, 0.95);
		border-radius: 20px;
		padding: 1.5rem;
		box-shadow: 0 20px 50px rgba(107, 76, 154, 0.25);
		display: flex;
		flex-direction: column;
		gap: 1rem;
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
		font-size: 1.2rem;
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
		transform: translateY(-1px);
	}

	.modal-subtitle {
		margin: 0;
		color: #8b7ba8;
		font-size: 0.95rem;
	}

	.modal-btn {
		border: none;
		border-radius: 14px;
		padding: 0.8rem 1rem;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		transition:
			transform 0.3s ease,
			box-shadow 0.3s ease;
	}

	.modal-btn:hover {
		transform: translateY(-2px);
		box-shadow: 0 10px 25px rgba(102, 126, 234, 0.35);
	}

	.modal-btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}

	.download-list {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 1rem;
	}

	.download-card {
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(12px);
		border-radius: 20px;
		padding: 1.25rem;
		box-shadow: 0 10px 30px rgba(107, 76, 154, 0.12);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		transition:
			transform 0.3s ease,
			box-shadow 0.3s ease;
	}

	.download-card:hover {
		transform: translateY(-3px);
		box-shadow: 0 16px 35px rgba(107, 76, 154, 0.18);
	}

	.card-header {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.card-platform {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.platform-badge,
	.storage-badge {
		font-size: 0.75rem;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		font-weight: 600;
		color: #6b4c9a;
		background: rgba(107, 76, 154, 0.12);
	}

	.storage-badge {
		background: rgba(255, 107, 157, 0.15);
		color: #ff6b9d;
	}

	.card-title {
		font-family: 'Fredoka', sans-serif;
		font-size: 1.05rem;
		color: #2d1b4e;
		margin: 0;
	}

	.card-meta {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		color: #8b7ba8;
		font-size: 0.85rem;
	}

	.card-desc {
		color: #6b4c9a;
		background: rgba(107, 76, 154, 0.08);
		padding: 0.2rem 0.5rem;
		border-radius: 8px;
		line-height: 1.4;
	}

	.card-actions {
		margin-top: 0.5rem;
		display: flex;
		gap: 0.8rem;
	}

	.card-btn {
		flex: 1;
		border: none;
		border-radius: 14px;
		padding: 0.7rem 1rem;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 0.4rem;
		transition:
			transform 0.3s ease,
			box-shadow 0.3s ease,
			background 0.3s ease,
			color 0.3s ease;
	}

	.btn-primary {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
	}

	.btn-outline {
		background: transparent;
		border: 2px solid #b8a5d0;
		color: #6b4c9a;
	}

	.card-btn:hover {
		transform: translateY(-2px);
		box-shadow: 0 5px 15px rgba(107, 76, 154, 0.15);
	}

	.btn-primary:hover {
		box-shadow: 0 10px 25px rgba(102, 126, 234, 0.35);
	}

	.btn-outline:hover {
		border-color: #6b4c9a;
		background: rgba(107, 76, 154, 0.05);
	}

	.card-btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}

	.modal-lg {
		max-width: 600px;
	}

	.guide-content-scroll {
		max-height: 60vh;
		overflow-y: auto;
		padding-right: 0.5rem;
		/* Custom scrollbar */
		scrollbar-width: thin;
		scrollbar-color: #b8a5d0 transparent;
	}

	.guide-content-scroll::-webkit-scrollbar {
		width: 6px;
	}

	.guide-content-scroll::-webkit-scrollbar-thumb {
		background-color: #b8a5d0;
		border-radius: 3px;
	}

	.markdown-body {
		color: #4d3a73;
		line-height: 1.6;
		font-size: 0.95rem;
	}

	.markdown-body :global(h3),
	.markdown-body :global(h4) {
		color: #6b4c9a;
		margin: 1.2rem 0 0.6rem;
		font-family: 'Fredoka', sans-serif;
	}

	.markdown-body :global(h3) {
		font-size: 1.2rem;
		border-bottom: 2px solid rgba(107, 76, 154, 0.1);
		padding-bottom: 0.4rem;
	}

	.markdown-body :global(p) {
		margin: 0.6rem 0;
	}

	.markdown-body :global(ul) {
		padding-left: 1.2rem;
		margin: 0.6rem 0;
	}

	.markdown-body :global(li) {
		margin: 0.3rem 0;
	}

	.markdown-body :global(code) {
		background: rgba(107, 76, 154, 0.08);
		padding: 0.2rem 0.4rem;
		border-radius: 6px;
		font-family: monospace;
		font-size: 0.9em;
		color: #e91e63;
	}

	.markdown-body :global(a) {
		color: #ff6b9d;
		text-decoration: none;
		font-weight: 500;
	}

	.markdown-body :global(a:hover) {
		text-decoration: underline;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.5rem;
	}

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
