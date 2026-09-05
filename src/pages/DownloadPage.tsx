import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState
} from 'react';
import type { ApiResponse, Category, PublicDownloadItem } from '$lib/types';
import { MUMBLE_WIDGET_OPEN_EVENT } from '$lib/mumble/events';
import { publicHomeDataLoader } from '$lib/public-home-data';
import { preloadTurnstileScript } from '$lib/utils/turnstile-client';
import AnnouncementList from '../components/public/AnnouncementList';
import BackgroundDecorations from '../components/public/BackgroundDecorations';
import CategoryTabs from '../components/public/CategoryTabs';
import DownloadCard from '../components/public/DownloadCard';
import GuideModal from '../components/public/GuideModal';
import GuidePanel from '../components/public/GuidePanel';
import MascotAnimation from '../components/public/MascotAnimation';
import PasswordModal from '../components/public/PasswordModal';
import SiteHeader from '../components/public/SiteHeader';
import styles from './DownloadPage.module.css';

interface TurnstileResponseState {
	requireTurnstile?: boolean;
	siteKey?: string;
}

interface DownloadLinkResponse extends TurnstileResponseState {
	url: string;
	filename?: string;
	resolvedSource?: 'origin' | 'r2';
	downloadCount?: number;
	configGuide?: string;
}

interface GuideVerificationResponse extends TurnstileResponseState {
	verified: boolean;
	configGuide?: string;
}

type PublicTab = 'download' | 'guide';

export default function DownloadPage() {
	const [downloadCount, setDownloadCount] = useState(0);
	const [downloads, setDownloads] = useState<PublicDownloadItem[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState('');
	const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
	const [downloading, setDownloading] = useState(false);
	const [pendingItem, setPendingItem] = useState<PublicDownloadItem | null>(null);
	const [selectedItem, setSelectedItem] = useState<PublicDownloadItem | null>(null);
	const [selectedConfigGuide, setSelectedConfigGuide] = useState('');
	const [activeTab, setActiveTab] = useState<PublicTab>('download');
	const [guideMessage, setGuideMessage] = useState('下载完成后请查看这里的配置指引～');
	const [guideItem, setGuideItem] = useState<PublicDownloadItem | null>(null);
	const [guideConfigGuide, setGuideConfigGuide] = useState('');
	const [pendingGuideItem, setPendingGuideItem] = useState<PublicDownloadItem | null>(null);
	const [requireTurnstile, setRequireTurnstile] = useState(false);
	const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
	const guideCacheRef = useRef<Record<string, string>>({});
	const pageTopRef = useRef<HTMLElement>(null);
	const downloadSectionRef = useRef<HTMLDivElement>(null);
	const categoriesRequestRef = useRef<AbortController | null>(null);
	const downloadsRequestRef = useRef<AbortController | null>(null);
	const downloadTabRef = useRef<HTMLButtonElement>(null);
	const guideTabRef = useRef<HTMLButtonElement>(null);
	const downloadTabId = useId();
	const guideTabId = useId();
	const downloadPanelId = useId();
	const guidePanelId = useId();

	const applyTurnstileState = useCallback((state: TurnstileResponseState | undefined) => {
		if (typeof state?.requireTurnstile !== 'boolean') return;
		setRequireTurnstile(state.requireTurnstile);
		setTurnstileSiteKey(state.requireTurnstile ? state.siteKey || '' : '');
	}, []);

	const loadCategories = useCallback(async () => {
		categoriesRequestRef.current?.abort();
		const controller = new AbortController();
		categoriesRequestRef.current = controller;
		try {
			const result = await publicHomeDataLoader.loadCategories({ signal: controller.signal });
			if (result.ok && result.data.success && result.data.data) {
				setCategories(result.data.data.items);
			}
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			console.error('Failed to load categories:', caught);
		} finally {
			if (categoriesRequestRef.current === controller) categoriesRequestRef.current = null;
		}
	}, []);

	const loadDownloads = useCallback(async (options: { force?: boolean } = {}) => {
		downloadsRequestRef.current?.abort();
		const controller = new AbortController();
		downloadsRequestRef.current = controller;
		setLoading(true);
		setLoadError('');
		try {
			const result = await publicHomeDataLoader.loadDownloads({
				force: options.force,
				signal: controller.signal
			});
			if (result.ok && result.data.success && result.data.data) {
				setDownloads(result.data.data.items);
				setDownloadCount(result.data.data.downloadCount);
			} else {
				throw new Error(result.data.error || `加载失败（HTTP ${result.status}）`);
			}
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			console.error('Failed to load downloads:', caught);
			setLoadError(caught instanceof Error ? caught.message : '下载列表加载失败');
		} finally {
			if (downloadsRequestRef.current === controller) {
				downloadsRequestRef.current = null;
				setLoading(false);
			}
		}
	}, []);

	useEffect(() => {
		preloadTurnstileScript();
		void (async () => {
			await Promise.all([loadCategories(), loadDownloads()]);
		})();
		return () => {
			categoriesRequestRef.current?.abort();
			categoriesRequestRef.current = null;
			downloadsRequestRef.current?.abort();
			downloadsRequestRef.current = null;
		};
	}, [loadCategories, loadDownloads]);

	const closePasswordModal = useCallback(() => setPendingItem(null), []);
	const closeGuidePasswordModal = useCallback(() => setPendingGuideItem(null), []);
	const closeGuideModal = useCallback(() => {
		setGuideItem(null);
		setGuideConfigGuide('');
	}, []);

	const handleDownloadSubmit = useCallback(
		async (
			password: string,
			turnstileToken: string,
			downloadSource: 'auto' | 'r2',
			signal: AbortSignal
		) => {
			const item = pendingItem;
			if (!item) return;

			setDownloading(true);
			try {
				const response = await fetch('/api/downloads/link', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						itemId: item.id,
						password,
						downloadSource,
						turnstileToken: turnstileToken || undefined
					}),
					signal
				});
				const data = (await response.json()) as ApiResponse<DownloadLinkResponse>;
				signal.throwIfAborted();

				if (response.ok && data.success && data.data?.url) {
					applyTurnstileState(data.data);
					const nextItemDownloadCount =
						typeof data.data.downloadCount === 'number'
							? data.data.downloadCount
							: Math.min(item.downloadCount + 1, Number.MAX_SAFE_INTEGER);
					const countIncrease = Math.max(nextItemDownloadCount - item.downloadCount, 0);
					setDownloadCount((count) => Math.min(count + countIncrease, Number.MAX_SAFE_INTEGER));
					setDownloads((items) =>
						items.map((download) =>
							download.id === item.id
								? { ...download, downloadCount: nextItemDownloadCount }
								: download
						)
					);
					const configGuide =
						typeof data.data.configGuide === 'string' ? data.data.configGuide : '';
					guideCacheRef.current[item.id] = configGuide;
					setSelectedItem(item);
					setSelectedConfigGuide(configGuide);
					setActiveTab('guide');
					setGuideMessage(
						data.data.resolvedSource === 'r2'
							? 'R2 备用下载已开始，下面是配置指引～'
							: '下载已开始，下面是配置指引～'
					);

					const link = document.createElement('a');
					link.href = data.data.url;
					link.target = '_blank';
					link.rel = 'noopener';
					if (data.data.filename) link.download = data.data.filename;
					document.body.appendChild(link);
					link.click();
					document.body.removeChild(link);
					closePasswordModal();
				} else {
					applyTurnstileState(data.data);
					throw new Error(data.error || '获取下载链接失败');
				}
			} finally {
				setDownloading(false);
			}
		},
		[applyTurnstileState, closePasswordModal, pendingItem]
	);

	const openGuideModal = useCallback((item: PublicDownloadItem) => {
		if (Object.prototype.hasOwnProperty.call(guideCacheRef.current, item.id)) {
			setGuideItem(item);
			setGuideConfigGuide(guideCacheRef.current[item.id]);
			return;
		}
		setPendingGuideItem(item);
	}, []);

	const handleGuidePasswordSubmit = useCallback(
		async (
			password: string,
			turnstileToken: string,
			_downloadSource: 'auto' | 'r2',
			signal: AbortSignal
		) => {
			const item = pendingGuideItem;
			if (!item) throw new Error('未选择要查看的配置指引');
			const response = await fetch('/api/downloads/link', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					itemId: item.id,
					password,
					turnstileToken: turnstileToken || undefined,
					action: 'guide'
				}),
				signal
			});
			const data = (await response.json()) as ApiResponse<GuideVerificationResponse>;
			signal.throwIfAborted();

			if (
				response.ok &&
				data.success &&
				data.data?.verified &&
				typeof data.data.configGuide === 'string'
			) {
				applyTurnstileState(data.data);
				guideCacheRef.current[item.id] = data.data.configGuide;
				setGuideItem(item);
				setGuideConfigGuide(data.data.configGuide);
				closeGuidePasswordModal();
			} else {
				applyTurnstileState(data.data);
				throw new Error(data.error || '验证失败');
			}
		},
		[applyTurnstileState, closeGuidePasswordModal, pendingGuideItem]
	);

	const filteredDownloads = useMemo(() => {
		if (!selectedCategoryId) return downloads.filter((item) => item.enabled);
		return downloads.filter((item) => item.enabled && item.categoryId === selectedCategoryId);
	}, [downloads, selectedCategoryId]);

	const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, tab: PublicTab) => {
		let nextTab: PublicTab | null = null;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			nextTab = tab === 'download' ? 'guide' : 'download';
		} else if (event.key === 'Home') {
			nextTab = 'download';
		} else if (event.key === 'End') {
			nextTab = 'guide';
		}
		if (!nextTab) return;

		event.preventDefault();
		setActiveTab(nextTab);
		(nextTab === 'download' ? downloadTabRef : guideTabRef).current?.focus();
	};

	const scrollToSection = (element: HTMLElement | null) => {
		if (!element) return;
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
	};

	const handleHomeNavigation = () => {
		setActiveTab('download');
		scrollToSection(pageTopRef.current);
	};

	const handleGuideNavigation = () => {
		setActiveTab('guide');
		requestAnimationFrame(() => scrollToSection(downloadSectionRef.current));
	};

	const handleCommunityNavigation = () => {
		window.dispatchEvent(new Event(MUMBLE_WIDGET_OPEN_EVENT));
	};

	return (
		<>
			<link rel="preconnect" href="https://challenges.cloudflare.com" />
			<link rel="preconnect" href="https://fonts.googleapis.com" />
			<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
			<link
				href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap"
				rel="stylesheet"
			/>
			<link
				href="https://fonts.googleapis.com/css2?family=Nunito:wght@300;400;500;600;700&display=swap"
				rel="stylesheet"
			/>
			<title>下载 - PlayDota2Win</title>

			<div className={styles['page-container']}>
				<BackgroundDecorations />
				<SiteHeader
					activeSection={activeTab}
					onHome={handleHomeNavigation}
					onGuide={handleGuideNavigation}
					onCommunity={handleCommunityNavigation}
				/>
				<main className={styles['main-content']} ref={pageTopRef}>
					<section className={styles['hero-section']} aria-labelledby="download-page-title">
						<MascotAnimation />
						<div className={styles['title-section']}>
							<h1 className={styles['main-title']} id="download-page-title">
								PlayDota2Win
							</h1>
							<div className={styles['subtitle-row']}>
								<span className={styles['subtitle-accent']} aria-hidden="true" />
								<p className={styles.subtitle}>下载中心</p>
								<span
									className={`${styles['subtitle-accent']} ${styles.reverse}`}
									aria-hidden="true"
								/>
							</div>
							<div className={styles['download-stats']}>
								<span>
									已有 <strong>{downloadCount.toLocaleString()}</strong> 位小伙伴下载
								</span>
							</div>
						</div>
					</section>

					<CategoryTabs
						categories={categories}
						downloads={downloads}
						selectedCategoryId={selectedCategoryId}
						onSelect={setSelectedCategoryId}
					/>
					<div className={styles['content-lane']}>
						<AnnouncementList />

						<div className={styles['download-section']} ref={downloadSectionRef}>
							<div className={styles['tab-bar']} role="tablist">
								<button
									className={`${styles['tab-btn']} ${activeTab === 'download' ? styles.active : ''}`}
									type="button"
									role="tab"
									id={downloadTabId}
									ref={downloadTabRef}
									aria-selected={activeTab === 'download'}
									aria-controls={downloadPanelId}
									tabIndex={activeTab === 'download' ? 0 : -1}
									onClick={() => setActiveTab('download')}
									onKeyDown={(event) => handleTabKeyDown(event, 'download')}
								>
									下载
								</button>
								<button
									className={`${styles['tab-btn']} ${activeTab === 'guide' ? styles.active : ''}`}
									type="button"
									role="tab"
									id={guideTabId}
									ref={guideTabRef}
									aria-selected={activeTab === 'guide'}
									aria-controls={guidePanelId}
									tabIndex={activeTab === 'guide' ? 0 : -1}
									onClick={() => setActiveTab('guide')}
									onKeyDown={(event) => handleTabKeyDown(event, 'guide')}
								>
									配置指引
								</button>
							</div>

							<div className={styles['panel-stack']}>
								<div
									className={`${styles.tabpanel} ${activeTab !== 'download' ? styles.inactive : ''}`}
									role="tabpanel"
									id={downloadPanelId}
									aria-labelledby={downloadTabId}
									aria-hidden={activeTab !== 'download'}
									inert={activeTab !== 'download'}
									tabIndex={activeTab === 'download' ? 0 : -1}
								>
									{loading ? (
										<div className={styles['loading-downloads']} role="status" aria-live="polite">
											<div className={styles.spinner} aria-hidden="true" />
											<span>加载中...</span>
										</div>
									) : loadError ? (
										<div className={styles['no-downloads']} role="alert">
											<span aria-hidden="true">⚠️</span>
											<p>下载列表加载失败</p>
											<p className={styles.hint}>{loadError}</p>
											<button
												className={styles['retry-btn']}
												type="button"
												onClick={() => void loadDownloads({ force: true })}
											>
												重新加载
											</button>
										</div>
									) : downloads.length === 0 ? (
										<div className={styles['no-downloads']}>
											<span aria-hidden="true">📦</span>
											<p>暂无可用的下载</p>
											<p className={styles.hint}>请稍后再来看看～</p>
										</div>
									) : filteredDownloads.length === 0 ? (
										<div className={styles['no-downloads']}>
											<span aria-hidden="true">🔍</span>
											<p>该分类暂无下载</p>
											<p className={styles.hint}>试试其他分类吧～</p>
										</div>
									) : (
										<div className={styles['download-list']}>
											{filteredDownloads.map((item) => (
												<DownloadCard
													key={item.id}
													item={item}
													downloading={downloading}
													onDownload={setPendingItem}
													onGuide={openGuideModal}
												/>
											))}
										</div>
									)}
								</div>
								<GuidePanel
									item={selectedItem}
									configGuide={selectedConfigGuide}
									message={guideMessage}
									id={guidePanelId}
									labelledBy={guideTabId}
									hidden={activeTab !== 'guide'}
								/>
							</div>
						</div>
					</div>

					{pendingItem ? (
						<PasswordModal
							item={pendingItem}
							requireTurnstile={requireTurnstile}
							turnstileSiteKey={turnstileSiteKey}
							allowR2Download={pendingItem.storageType === 'link'}
							onClose={closePasswordModal}
							onSubmit={handleDownloadSubmit}
						/>
					) : null}

					{guideItem ? (
						<GuideModal item={guideItem} configGuide={guideConfigGuide} onClose={closeGuideModal} />
					) : null}

					{pendingGuideItem ? (
						<PasswordModal
							item={pendingGuideItem}
							purpose="guide"
							requireTurnstile={requireTurnstile}
							turnstileSiteKey={turnstileSiteKey}
							onClose={closeGuidePasswordModal}
							onSubmit={handleGuidePasswordSubmit}
						/>
					) : null}

					<footer className={styles.footer}>
						<p>Windows 10+</p>
						<p className={styles['footer-love']}>PlayDota2Win</p>
					</footer>
				</main>
			</div>
		</>
	);
}
