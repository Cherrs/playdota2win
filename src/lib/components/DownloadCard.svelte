<script lang="ts">
	import type { DownloadItem, Platform } from '$lib/types';

	interface Props {
		item: DownloadItem;
		downloading?: boolean;
		onDownload: (item: DownloadItem) => void;
		onGuide: (item: DownloadItem) => void;
	}

	let { item, downloading = false, onDownload, onGuide }: Props = $props();

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
</script>

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
		<button class="card-btn btn-outline" onclick={() => onGuide(item)} type="button">
			配置指引
		</button>
		<button class="card-btn btn-primary" onclick={() => onDownload(item)} disabled={downloading}>
			<span>立即下载</span>
			<span class="btn-arrow">→</span>
		</button>
	</div>
</div>

<style>
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
</style>
