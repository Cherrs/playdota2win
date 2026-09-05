import MascotIcon from './MascotIcon';
import styles from './SiteHeader.module.css';

interface SiteHeaderProps {
	activeSection: 'download' | 'guide';
	onHome: () => void;
	onGuide: () => void;
	onCommunity: () => void;
}

function HomeIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
			<path d="m3.5 10.8 8.5-7 8.5 7" />
			<path d="M5.5 9.5v10h5v-5h3v5h5v-10" />
		</svg>
	);
}

function GuideIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
			<rect x="3.5" y="4" width="17" height="16" rx="3" />
			<path d="m9 14 1.8-4.5 2.2 2.2 2-2" />
			<path d="M14 17h3" />
		</svg>
	);
}

function CommunityIcon() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
			<path d="M20.4 5.8c-2.3-2.4-6.2-1.8-8.4 1-2.2-2.8-6.1-3.4-8.4-1-2.4 2.5-1.7 6.5.6 8.8L12 22l7.8-7.4c2.3-2.3 3-6.3.6-8.8Z" />
		</svg>
	);
}

export default function SiteHeader({
	activeSection,
	onHome,
	onGuide,
	onCommunity
}: SiteHeaderProps) {
	return (
		<header className={styles.header}>
			<button className={styles.brand} type="button" onClick={onHome} aria-label="返回首页">
				<span className={styles['brand-mark']} aria-hidden="true">
					<MascotIcon className={styles['brand-mascot']} />
				</span>
				<span className={styles['brand-name']}>PlayDota2Win</span>
			</button>

			<nav className={styles.navigation} aria-label="主导航">
				<button
					className={`${styles['nav-item']} ${activeSection === 'download' ? styles.active : ''}`}
					type="button"
					onClick={onHome}
					aria-label="首页"
					aria-current={activeSection === 'download' ? 'page' : undefined}
				>
					<HomeIcon />
					<span>首页</span>
				</button>
				<button
					className={`${styles['nav-item']} ${activeSection === 'guide' ? styles.active : ''}`}
					type="button"
					onClick={onGuide}
					aria-label="配置指引"
					aria-current={activeSection === 'guide' ? 'page' : undefined}
				>
					<GuideIcon />
					<span>配置指引</span>
				</button>
				<button
					className={styles['nav-item']}
					type="button"
					onClick={onCommunity}
					aria-label="社区"
				>
					<CommunityIcon />
					<span>社区</span>
				</button>
			</nav>
		</header>
	);
}
