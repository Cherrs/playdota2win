import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

import MumbleStatusPanel from '$components/mumble/MumbleStatusPanel';
import type {
	ApiResponse,
	Category,
	CategoryList,
	DownloadItem,
	DownloadList as DownloadListData
} from '$lib/types';
import { preloadTurnstileScript } from '$lib/utils/turnstile-client';

import AdminHeader from '../components/admin/AdminHeader';
import AdminLogin from '../components/admin/AdminLogin';
import AnnouncementForm from '../components/admin/AnnouncementForm';
import CategoryManager from '../components/admin/CategoryManager';
import DownloadEditModal from '../components/admin/DownloadEditModal';
import DownloadForm from '../components/admin/DownloadForm';
import DownloadList from '../components/admin/DownloadList';
import { classNames } from '../components/admin/classNames';
import styles from './AdminPage.module.css';

type AdminTab = 'downloads' | 'categories' | 'announcements' | 'mumble';
const ADMIN_TABS: AdminTab[] = ['downloads', 'categories', 'announcements', 'mumble'];

interface AuthState {
	authenticated?: boolean;
	requireTurnstile?: boolean;
	siteKey?: string;
}

export default function AdminPage() {
	const [adminTab, setAdminTab] = useState<AdminTab>('downloads');
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [initialTurnstileRequired, setInitialTurnstileRequired] = useState(false);
	const [initialTurnstileSiteKey, setInitialTurnstileSiteKey] = useState('');
	const [downloads, setDownloads] = useState<DownloadItem[]>([]);
	const [categories, setCategories] = useState<Category[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [editingItem, setEditingItem] = useState<DownloadItem | null>(null);
	const downloadsControllerRef = useRef<AbortController | null>(null);
	const categoriesControllerRef = useRef<AbortController | null>(null);
	const authControllerRef = useRef<AbortController | null>(null);
	const mutationControllersRef = useRef(new Map<string, AbortController>());

	const clearAdminState = useCallback(() => {
		downloadsControllerRef.current?.abort();
		categoriesControllerRef.current?.abort();
		for (const controller of mutationControllersRef.current.values()) controller.abort();
		mutationControllersRef.current.clear();
		setDownloads([]);
		setCategories([]);
		setEditingItem(null);
		setIsAuthenticated(false);
	}, []);

	const loadDownloads = useCallback(
		async (options: { silent?: boolean } = {}) => {
			const silent = options.silent === true;
			downloadsControllerRef.current?.abort();
			const controller = new AbortController();
			downloadsControllerRef.current = controller;
			if (!silent) {
				setLoading(true);
				setError('');
			}
			try {
				const response = await fetch('/api/admin', { signal: controller.signal });
				const data = (await response.json()) as ApiResponse<DownloadListData>;
				if (response.ok && data.success && data.data) {
					setDownloads(data.data.items);
					return data.data.items;
				}
				if (response.status === 401) clearAdminState();
				if (!silent) setError(data.error || '加载失败');
			} catch (caught) {
				if (caught instanceof DOMException && caught.name === 'AbortError') return undefined;
				if (!silent) setError('网络错误');
			} finally {
				if (downloadsControllerRef.current === controller) {
					downloadsControllerRef.current = null;
					if (!silent) setLoading(false);
				}
			}
			return undefined;
		},
		[clearAdminState]
	);

	const loadCategories = useCallback(async () => {
		categoriesControllerRef.current?.abort();
		const controller = new AbortController();
		categoriesControllerRef.current = controller;
		try {
			const response = await fetch('/api/admin/categories', { signal: controller.signal });
			const data = (await response.json()) as ApiResponse<CategoryList>;
			if (response.ok && data.success && data.data) {
				setCategories(data.data.items);
			} else {
				if (response.status === 401) clearAdminState();
				setError(data.error || '加载分类失败');
			}
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			console.error('Failed to load categories');
		} finally {
			if (categoriesControllerRef.current === controller) categoriesControllerRef.current = null;
		}
	}, [clearAdminState]);

	useEffect(() => {
		const previousTitle = document.title;
		const mutationControllers = mutationControllersRef.current;
		document.title = 'Admin - PlayDota2Win';
		preloadTurnstileScript();
		const controller = new AbortController();
		authControllerRef.current = controller;
		void (async () => {
			try {
				const response = await fetch('/api/admin/auth', { signal: controller.signal });
				const data = (await response.json()) as ApiResponse<AuthState>;
				if (controller.signal.aborted) return;
				if (response.ok && data.success && data.data?.authenticated === true) {
					setIsAuthenticated(true);
					await Promise.all([loadDownloads(), loadCategories()]);
					return;
				}
				const requireTurnstile = data.data?.requireTurnstile === true;
				setInitialTurnstileRequired(requireTurnstile);
				setInitialTurnstileSiteKey(requireTurnstile ? data.data?.siteKey || '' : '');
			} catch (caught) {
				if (caught instanceof DOMException && caught.name === 'AbortError') return;
				setError('无法检查登录状态');
			} finally {
				if (authControllerRef.current === controller) {
					authControllerRef.current = null;
					setLoading(false);
				}
			}
		})();
		return () => {
			document.title = previousTitle;
			controller.abort();
			downloadsControllerRef.current?.abort();
			categoriesControllerRef.current?.abort();
			for (const mutationController of mutationControllers.values()) {
				mutationController.abort();
			}
			mutationControllers.clear();
		};
	}, [loadCategories, loadDownloads]);

	function handleLoginSuccess() {
		setIsAuthenticated(true);
		setError('');
		void Promise.all([loadDownloads(), loadCategories()]);
	}

	async function handleLogout() {
		const key = 'logout';
		if (mutationControllersRef.current.has(key)) return;
		const controller = new AbortController();
		mutationControllersRef.current.set(key, controller);
		try {
			const response = await fetch('/api/admin/auth', {
				method: 'DELETE',
				signal: controller.signal
			});
			if (controller.signal.aborted) return;
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			clearAdminState();
			setError('');
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			setError('退出登录失败，请检查网络后重试');
		} finally {
			mutationControllersRef.current.delete(key);
		}
	}

	async function handleToggleEnabled(item: DownloadItem) {
		const key = `item:${item.id}`;
		if (mutationControllersRef.current.has(key)) return;
		const controller = new AbortController();
		mutationControllersRef.current.set(key, controller);
		setError('');
		try {
			const response = await fetch('/api/admin', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: item.id, enabled: !item.enabled }),
				signal: controller.signal
			});
			const data = (await response.json()) as ApiResponse<DownloadItem>;
			if (controller.signal.aborted) return;
			if (response.ok && data.success && data.data) {
				setDownloads((current) =>
					current.map((download) => (download.id === item.id ? data.data! : download))
				);
			} else if (response.status === 401) {
				clearAdminState();
				setError('登录已过期，请重新登录');
			} else {
				setError(data.error || `更新失败（HTTP ${response.status}）`);
			}
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			setError('更新失败');
		} finally {
			mutationControllersRef.current.delete(key);
		}
	}

	async function handleDelete(id: string) {
		if (!window.confirm('确定要删除吗？')) return;
		const key = `item:${id}`;
		if (mutationControllersRef.current.has(key)) return;
		const controller = new AbortController();
		mutationControllersRef.current.set(key, controller);
		try {
			const response = await fetch('/api/admin', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id }),
				signal: controller.signal
			});
			const data = (await response.json()) as ApiResponse;
			if (controller.signal.aborted) return;
			if (data.success) {
				setDownloads((current) => current.filter((download) => download.id !== id));
				setSuccess('删除成功！');
			} else {
				setError(data.error || '删除失败');
			}
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			setError('网络错误');
		} finally {
			mutationControllersRef.current.delete(key);
		}
	}

	function handleEditSave(item: DownloadItem) {
		setDownloads((current) =>
			current.map((download) => (download.id === item.id ? item : download))
		);
		setSuccess('更新成功！');
		setEditingItem(null);
	}

	function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		const currentTab = (event.target as HTMLElement).dataset.adminTab as AdminTab | undefined;
		if (!currentTab) return;
		event.preventDefault();
		const currentIndex = ADMIN_TABS.indexOf(currentTab);
		const nextIndex =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? ADMIN_TABS.length - 1
					: (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + ADMIN_TABS.length) %
						ADMIN_TABS.length;
		const nextTab = ADMIN_TABS[nextIndex];
		setAdminTab(nextTab);
		document.getElementById(`admin-tab-${nextTab}`)?.focus();
	}

	if (!isAuthenticated) {
		return (
			<AdminLogin
				onLoginSuccess={handleLoginSuccess}
				initialTurnstileRequired={initialTurnstileRequired}
				initialTurnstileSiteKey={initialTurnstileSiteKey}
			/>
		);
	}

	return (
		<div className={styles.adminContainer}>
			<AdminHeader itemCount={downloads.length} onLogout={() => void handleLogout()} />
			{error && <PageAlert type="error" message={error} onClose={() => setError('')} />}
			{success && <PageAlert type="success" message={success} onClose={() => setSuccess('')} />}
			<div
				className={styles.adminTabs}
				role="tablist"
				aria-label="后台管理功能"
				onKeyDown={handleTabKeyDown}
			>
				<Tab
					tab="downloads"
					active={adminTab === 'downloads'}
					onClick={() => setAdminTab('downloads')}
				>
					下载管理
				</Tab>
				<Tab
					tab="categories"
					active={adminTab === 'categories'}
					onClick={() => setAdminTab('categories')}
				>
					分类管理
				</Tab>
				<Tab
					tab="announcements"
					active={adminTab === 'announcements'}
					onClick={() => setAdminTab('announcements')}
				>
					公告管理
				</Tab>
				<Tab tab="mumble" active={adminTab === 'mumble'} onClick={() => setAdminTab('mumble')}>
					🎧 Mumble 状态
				</Tab>
			</div>

			{adminTab === 'categories' && (
				<TabPanel tab="categories">
					<CategoryManager
						categories={categories}
						downloads={downloads}
						onCategoriesChange={setCategories}
						onReloadDownloads={loadDownloads}
					/>
				</TabPanel>
			)}
			{adminTab === 'downloads' && (
				<TabPanel tab="downloads">
					<DownloadForm
						categories={categories}
						onAdd={(item) => setDownloads((current) => [...current, item])}
					/>
					<DownloadList
						downloads={downloads}
						categories={categories}
						loading={loading}
						onEdit={setEditingItem}
						onToggleEnabled={handleToggleEnabled}
						onDelete={handleDelete}
						onReload={loadDownloads}
					/>
					{editingItem && (
						<DownloadEditModal
							key={editingItem.id}
							item={editingItem}
							categories={categories}
							onSave={handleEditSave}
							onClose={() => setEditingItem(null)}
						/>
					)}
				</TabPanel>
			)}
			{adminTab === 'announcements' && (
				<TabPanel tab="announcements">
					<AnnouncementForm />
				</TabPanel>
			)}
			{adminTab === 'mumble' && (
				<TabPanel tab="mumble">
					<MumbleStatusPanel />
				</TabPanel>
			)}
		</div>
	);
}

function Tab({
	tab,
	active,
	onClick,
	children
}: {
	tab: AdminTab;
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			id={`admin-tab-${tab}`}
			data-admin-tab={tab}
			className={classNames(styles.tabBtn, active && styles.active)}
			type="button"
			role="tab"
			aria-selected={active}
			aria-controls={`admin-panel-${tab}`}
			tabIndex={active ? 0 : -1}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

function TabPanel({ tab, children }: { tab: AdminTab; children: React.ReactNode }) {
	return (
		<div
			className={styles.tabPanel}
			id={`admin-panel-${tab}`}
			role="tabpanel"
			aria-labelledby={`admin-tab-${tab}`}
		>
			{children}
		</div>
	);
}

function PageAlert({
	type,
	message,
	onClose
}: {
	type: 'error' | 'success';
	message: string;
	onClose: () => void;
}) {
	return (
		<div
			className={classNames(
				styles.alert,
				type === 'error' ? styles.alertError : styles.alertSuccess
			)}
			role={type === 'error' ? 'alert' : 'status'}
		>
			<span>{type === 'error' ? '❌' : '✅'}</span>
			{message}
			<button
				className={styles.alertClose}
				type="button"
				aria-label={type === 'error' ? '关闭错误提示' : '关闭成功提示'}
				onClick={onClose}
			>
				×
			</button>
		</div>
	);
}
