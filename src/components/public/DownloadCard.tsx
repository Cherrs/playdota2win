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

type CardBrand = 'mumble' | 'rustdesk' | 'monkey' | 'generic';

function getCardBrand(item: PublicDownloadItem): CardBrand {
	const identity = `${item.title ?? ''} ${item.filename ?? ''}`.toLowerCase();
	if (identity.includes('monkey') || identity.includes('猴')) return 'monkey';
	if (identity.includes('mumble')) return 'mumble';
	if (identity.includes('rustdesk')) return 'rustdesk';
	return 'generic';
}

function ProductIcon({ brand }: { brand: CardBrand }) {
	if (brand === 'mumble') {
		return (
			<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
				<path d="M13 34a19 19 0 0 1 38 0" />
				<rect x="9" y="31" width="11" height="21" rx="5" />
				<rect x="44" y="31" width="11" height="21" rx="5" />
				<path d="M49 48c-2 7-7 9-15 9" />
				<rect x="27" y="53" width="10" height="6" rx="3" />
			</svg>
		);
	}

	if (brand === 'rustdesk') {
		return (
			<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
				<path d="M51 19a23 23 0 0 0-37 5l10 6a12 12 0 0 1 18-4Z" />
				<path d="M13 45a23 23 0 0 0 37-5l-10-6a12 12 0 0 1-18 4Z" />
				<circle cx="32" cy="32" r="7" />
			</svg>
		);
	}

	if (brand === 'monkey') {
		return (
			<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
				<circle cx="14" cy="29" r="9" />
				<circle cx="50" cy="29" r="9" />
				<circle cx="32" cy="32" r="23" />
				<ellipse cx="32" cy="39" rx="15" ry="13" />
				<circle cx="25" cy="28" r="2.5" />
				<circle cx="39" cy="28" r="2.5" />
				<path d="M27 43q5 5 10 0" />
			</svg>
		);
	}

	return (
		<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
			<rect x="12" y="10" width="40" height="44" rx="12" />
			<path d="M32 19v23m-9-9 9 9 9-9" />
		</svg>
	);
}

function PlatformIcon({ platform }: { platform: Platform }) {
	if (platform !== 'windows') {
		return (
			<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<rect x="2" y="2.5" width="12" height="9" rx="1.5" fill="none" stroke="currentColor" />
				<path d="M5 14h6M8 11.5V14" fill="none" stroke="currentColor" />
			</svg>
		);
	}

	return (
		<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
			<path d="M1.5 2.7 7 2v5.3H1.5Zm6.5-.8L14.5 1v6.3H8ZM1.5 8.4H7v5.3l-5.5-.8Zm6.5 0h6.5V15L8 14.1Z" />
		</svg>
	);
}

function GuideIcon() {
	return (
		<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
			<path d="M3 4.5c2.7-.8 5-.2 7 1.4v10c-2-1.6-4.3-2.1-7-1.3Z" />
			<path d="M17 4.5c-2.7-.8-5-.2-7 1.4v10c2-1.6 4.3-2.1 7-1.3Z" />
		</svg>
	);
}

function DownloadIcon() {
	return (
		<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
			<path d="M10 2.5v10m-4-4 4 4 4-4" />
			<path d="M3 14.5v2.8h14v-2.8" />
		</svg>
	);
}

export default function DownloadCard({
	item,
	downloading = false,
	onDownload,
	onGuide
}: DownloadCardProps) {
	const brand = getCardBrand(item);

	return (
		<article className={`${styles['download-card']} ${styles[brand]}`}>
			<div className={styles['card-header']}>
				<div className={styles['product-icon']}>
					<ProductIcon brand={brand} />
				</div>
				<div className={styles['card-heading']}>
					<h3 className={styles['card-title']}>
						{item.title || `${getPlatformLabel(item.platform)} 版本`}
					</h3>
					<span className={styles['platform-badge']}>
						<PlatformIcon platform={item.platform} />
						{getPlatformLabel(item.platform)}
					</span>
				</div>
			</div>
			<dl className={styles['card-meta']}>
				<div>
					<dt>版本</dt>
					<dd>{item.version}</dd>
				</div>
				<div>
					<dt>大小</dt>
					<dd>{item.size}</dd>
				</div>
				<div>
					<dt>文件</dt>
					<dd title={item.filename}>{item.filename || '—'}</dd>
				</div>
			</dl>
			{item.description ? <p className={styles['card-desc']}>{item.description}</p> : null}
			<div className={styles['card-actions']}>
				<button
					className={`${styles['card-btn']} ${styles['btn-outline']}`}
					onClick={() => onGuide(item)}
					type="button"
				>
					<GuideIcon />
					配置指引
				</button>
				<button
					className={`${styles['card-btn']} ${styles['btn-primary']}`}
					type="button"
					onClick={() => onDownload(item)}
					disabled={downloading}
				>
					<DownloadIcon />
					<span>立即下载</span>
				</button>
			</div>
		</article>
	);
}
