<script lang="ts">
	import type { DownloadItem, DownloadList, ApiResponse, Platform } from '$lib/types';
	
	let isHovering = $state(false);
	let downloadCount = $state(0);
	let downloads = $state<DownloadItem[]>([]);
	let loading = $state(true);
	
	// 下载密码
	let password = $state('');
	let downloadError = $state('');
	let downloading = $state(false);
	let showPasswordModal = $state(false);
	let pendingItem = $state<DownloadItem | null>(null);
	
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
			case 'windows': return 'Windows';
			case 'macos': return 'macOS';
			case 'linux': return 'Linux';
			default: return platform;
		}
	}

	function openPasswordModal(item: DownloadItem) {
		pendingItem = item;
		password = '';
		downloadError = '';
		showPasswordModal = true;
	}

	function closePasswordModal() {
		showPasswordModal = false;
		pendingItem = null;
		password = '';
		downloadError = '';
	}

	async function handleDownloadItem(item: DownloadItem) {
		if (!password.trim()) {
			downloadError = '请输入下载密码';
			return;
		}

		downloading = true;
		downloadError = '';
		try {
			const res = await fetch('/api/downloads/link', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ itemId: item.id, password })
			});
			const data: ApiResponse<{ url: string; filename?: string; count?: number }> = await res.json();
			if (data.success && data.data?.url) {
				if (typeof data.data.count === 'number') {
					downloadCount = data.data.count;
				}
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
			} else {
				downloadError = data.error || '获取下载链接失败';
			}
		} catch (e) {
			console.error('Failed to get download link:', e);
			downloadError = '获取下载链接失败';
		} finally {
			downloading = false;
			closePasswordModal();
		}
	}
	
	// 初始加载
	$effect(() => {
		loadDownloads();
	});
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
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
				onmouseenter={() => isHovering = true}
				onmouseleave={() => isHovering = false}
				role="img"
				aria-label="可爱的吉祥物"
			>
				<div class="mascot" class:bouncing={isHovering}>
					<svg viewBox="0 0 120 120" class="mascot-svg">
						<!-- 身体 -->
						<circle cx="60" cy="65" r="45" fill="#FFE4EC"/>
						<!-- 脸蛋红晕 -->
						<ellipse cx="30" cy="70" rx="10" ry="6" fill="#FFB6C1" opacity="0.6"/>
						<ellipse cx="90" cy="70" rx="10" ry="6" fill="#FFB6C1" opacity="0.6"/>
						<!-- 眼睛 -->
						<circle cx="42" cy="58" r="8" fill="#2D1B4E"/>
						<circle cx="78" cy="58" r="8" fill="#2D1B4E"/>
						<!-- 眼睛高光 -->
						<circle cx="45" cy="55" r="3" fill="#FFFFFF"/>
						<circle cx="81" cy="55" r="3" fill="#FFFFFF"/>
						<!-- 微笑 -->
						<path d="M 48 78 Q 60 88 72 78" stroke="#2D1B4E" stroke-width="3" fill="none" stroke-linecap="round"/>
						<!-- 猫耳朵 -->
						<path d="M 25 30 L 35 55 L 15 50 Z" fill="#FFE4EC"/>
						<path d="M 95 30 L 85 55 L 105 50 Z" fill="#FFE4EC"/>
						<path d="M 27 35 L 34 52 L 20 48 Z" fill="#FFB6C1"/>
						<path d="M 93 35 L 86 52 L 100 48 Z" fill="#FFB6C1"/>
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
				<span class="stats-text">已有 <strong>{downloadCount.toLocaleString()}</strong> 位小伙伴下载</span>
			</div>
		</div>

		<!-- 下载按钮区 -->
		<div class="download-section">
			{#if loading}
				<div class="loading-downloads">
					<div class="spinner"></div>
					<span>加载中...</span>
				</div>
			{:else}
				{#if downloads.length === 0}
					<div class="no-downloads">
						<span>😢</span>
						<p>暂无可用的下载</p>
					</div>
				{:else}
					<div class="download-list">
						{#each downloads.filter((item) => item.enabled) as item (item.id)}
							<div class="download-card">
								<div class="card-header">
									<div class="card-platform">
										<span class="platform-badge">{getPlatformLabel(item.platform)}</span>
										<span class="storage-badge">{item.storageType.toUpperCase()}</span>
									</div>
									<h3 class="card-title">{item.title || `${getPlatformLabel(item.platform)} 版本`}</h3>
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
								<button
									class="download-card-btn"
									onclick={() => openPasswordModal(item)}
									disabled={downloading}
								>
									<span>立即下载</span>
									<span class="btn-arrow">→</span>
								</button>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>

		{#if showPasswordModal}
			<div class="modal-backdrop" role="dialog" aria-modal="true">
				<button
					type="button"
					class="modal-scrim"
					onclick={closePasswordModal}
					onkeydown={(e) => (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') && closePasswordModal()}
					aria-label="关闭"
				></button>
				<div class="modal-card">
					<div class="modal-header">
						<h3>🔐 输入下载密码</h3>
						<button class="modal-close" onclick={closePasswordModal}>×</button>
					</div>
					{#if pendingItem}
						<p class="modal-subtitle">{pendingItem.title || `${getPlatformLabel(pendingItem.platform)} 版本`}</p>
					{/if}
					<div class="auth-form">
						<input
							type="password"
							class="auth-input"
							placeholder="请输入下载密码"
							bind:value={password}
							disabled={downloading}
						/>
						{#if downloadError}
							<p class="auth-error">{downloadError}</p>
						{/if}
					</div>
					<button
						class="modal-btn"
						onclick={() => pendingItem && handleDownloadItem(pendingItem)}
						disabled={downloading}
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
		background: linear-gradient(135deg, #FFF5F7 0%, #F0E6FF 50%, #E6F0FF 100%);
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
		color: #FFB6C1;
		animation: float 6s ease-in-out infinite;
		opacity: 0.6;
	}

	.star-1 { top: 10%; left: 10%; animation-delay: 0s; color: #FFD700; }
	.star-2 { top: 20%; right: 15%; animation-delay: 1s; color: #FF69B4; }
	.star-3 { bottom: 30%; left: 8%; animation-delay: 2s; color: #DDA0DD; }
	.star-4 { bottom: 20%; right: 10%; animation-delay: 3s; color: #87CEEB; }

	.floating-cloud {
		position: absolute;
		font-size: 4rem;
		color: #FFFFFF;
		opacity: 0.5;
		animation: drift 20s linear infinite;
	}

	.cloud-1 { top: 15%; left: -10%; animation-duration: 25s; }
	.cloud-2 { top: 60%; left: -10%; animation-duration: 30s; animation-delay: 10s; }

	@keyframes float {
		0%, 100% { transform: translateY(0) rotate(0deg); }
		50% { transform: translateY(-20px) rotate(10deg); }
	}

	@keyframes drift {
		from { transform: translateX(-100px); }
		to { transform: translateX(calc(100vw + 100px)); }
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

	.sparkle:nth-child(2) { animation-delay: 0.2s; }
	.sparkle:nth-child(3) { animation-delay: 0.4s; }

	@keyframes bounce {
		0%, 100% { transform: translateY(0); }
		50% { transform: translateY(-10px); }
	}

	@keyframes sparkle {
		0%, 100% { transform: scale(1); opacity: 1; }
		50% { transform: scale(1.3); opacity: 0.7; }
	}

	/* 标题区 */
	.title-section {
		text-align: center;
	}

	.main-title {
		font-family: 'Fredoka', sans-serif;
		font-size: 2.8rem;
		font-weight: 700;
		color: #6B4C9A;
		margin: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		text-shadow: 2px 2px 0 #FFE4EC;
	}

	.title-emoji {
		animation: wiggle 2s ease-in-out infinite;
	}

	@keyframes wiggle {
		0%, 100% { transform: rotate(-5deg); }
		50% { transform: rotate(5deg); }
	}

	.subtitle {
		font-size: 1.2rem;
		color: #8B7BA8;
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
		color: #6B4C9A;
		box-shadow: 0 4px 15px rgba(107, 76, 154, 0.1);
		backdrop-filter: blur(10px);
	}

	.download-stats strong {
		color: #FF6B9D;
		font-weight: 700;
	}

	/* 下载按钮 */
	.download-section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
		max-width: 720px;
	}

	.auth-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.auth-input {
		width: 100%;
		padding: 0.9rem 1.2rem;
		border: 2px solid #E8E0F0;
		border-radius: 14px;
		font-size: 1rem;
		font-family: inherit;
		background: rgba(255, 255, 255, 0.8);
		transition: all 0.3s ease;
		outline: none;
		box-sizing: border-box;
	}

	.auth-input:focus {
		border-color: #B8A5D0;
		box-shadow: 0 0 0 4px rgba(107, 76, 154, 0.1);
	}

	.auth-input::placeholder {
		color: #B8A5D0;
	}

	.auth-error {
		color: #FF6B9D;
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
		color: #6B4C9A;
		font-size: 1.2rem;
	}

	.modal-close {
		border: none;
		background: rgba(107, 76, 154, 0.1);
		color: #6B4C9A;
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
		color: #8B7BA8;
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
		transition: transform 0.3s ease, box-shadow 0.3s ease;
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
		transition: transform 0.3s ease, box-shadow 0.3s ease;
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
		color: #6B4C9A;
		background: rgba(107, 76, 154, 0.12);
	}

	.storage-badge {
		background: rgba(255, 107, 157, 0.15);
		color: #FF6B9D;
	}

	.card-title {
		font-family: 'Fredoka', sans-serif;
		font-size: 1.05rem;
		color: #2D1B4E;
		margin: 0;
	}

	.card-meta {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		color: #8B7BA8;
		font-size: 0.85rem;
	}

	.card-desc {
		color: #6B4C9A;
		background: rgba(107, 76, 154, 0.08);
		padding: 0.2rem 0.5rem;
		border-radius: 8px;
		line-height: 1.4;
	}

	.download-card-btn {
		margin-top: 0.5rem;
		border: none;
		border-radius: 14px;
		padding: 0.7rem 1rem;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		display: flex;
		justify-content: space-between;
		align-items: center;
		transition: transform 0.3s ease, box-shadow 0.3s ease;
	}

	.download-card-btn:hover {
		transform: translateY(-2px);
		box-shadow: 0 10px 25px rgba(102, 126, 234, 0.35);
	}

	.download-card-btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}


	/* 加载状态 */
	.loading-downloads {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 2rem;
		color: #8B7BA8;
	}
	
	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid rgba(107, 76, 154, 0.2);
		border-top-color: #6B4C9A;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}
	
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
	
	.no-downloads {
		text-align: center;
		padding: 2rem;
		color: #8B7BA8;
	}
	
	.no-downloads span {
		font-size: 3rem;
		display: block;
		margin-bottom: 0.5rem;
	}

	/* 底部 */
	.footer {
		text-align: center;
		margin-top: 2rem;
		color: #A89BC4;
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
