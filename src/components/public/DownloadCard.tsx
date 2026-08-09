import type { Platform, PublicDownloadItem } from '$lib/types';
import styles from './DownloadCard.module.css';

interface DownloadCardProps {
	item: PublicDownloadItem;
	downloading?: boolean;
	onDownload: (item: PublicDownloadItem) => void;
	onGuide: (item: PublicDownloadItem) => void;
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

export default function DownloadCard({
	item,
	downloading = false,
	onDownload,
	onGuide
}: DownloadCardProps) {
	return (
		<div className={styles['download-card']}>
			<div className={styles['card-header']}>
				<div className={styles['card-platform']}>
					<span className={styles['platform-badge']}>{getPlatformLabel(item.platform)}</span>
					<span className={styles['storage-badge']}>{item.storageType.toUpperCase()}</span>
				</div>
				<h3 className={styles['card-title']}>
					{item.title || `${getPlatformLabel(item.platform)} 版本`}
				</h3>
			</div>
			<div className={styles['card-meta']}>
				<span>版本 {item.version}</span>
				<span>大小 {item.size}</span>
				{item.description ? <span className={styles['card-desc']}>{item.description}</span> : null}
				{item.filename ? <span>文件 {item.filename}</span> : null}
			</div>
			<div className={styles['card-actions']}>
				<button
					className={`${styles['card-btn']} ${styles['btn-outline']}`}
					onClick={() => onGuide(item)}
					type="button"
				>
					配置指引
				</button>
				<button
					className={`${styles['card-btn']} ${styles['btn-primary']}`}
					type="button"
					onClick={() => onDownload(item)}
					disabled={downloading}
				>
					<span>立即下载</span>
					<span className="btn-arrow" aria-hidden="true">
						→
					</span>
				</button>
			</div>
		</div>
	);
}
