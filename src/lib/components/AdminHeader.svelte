<script lang="ts">
	interface Props {
		downloadCount: number;
		itemCount: number;
		onLogout: () => void;
	}

	let { downloadCount, itemCount, onLogout }: Props = $props();
</script>

<header class="admin-header">
	<h1>🎮 PlayDota2Win 管理后台</h1>
	<div class="header-actions">
		<div class="stats">
			<span class="stat-item">
				📥 总下载次数: <strong>{downloadCount.toLocaleString()}</strong>
			</span>
			<span class="stat-item">
				📦 下载项: <strong>{itemCount}</strong>
			</span>
		</div>
		<button class="logout-btn" onclick={onLogout}>🚪 退出登录</button>
	</div>
</header>

<style>
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
</style>
