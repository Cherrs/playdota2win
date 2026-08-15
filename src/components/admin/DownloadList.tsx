import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import type { ApiResponse, Category, DownloadItem, Platform, StorageType } from '$lib/types';
import { needsR2VersionSync } from '$lib/utils/download-sync';

import styles from './DownloadList.module.css';
import { classNames } from './classNames';

export interface DownloadListProps {
	downloads: DownloadItem[];
	categories: Category[];
	loading: boolean;
	onEdit: (item: DownloadItem) => void;
	onToggleEnabled: (item: DownloadItem) => void | Promise<void>;
	onDelete: (id: string) => void | Promise<void>;
	onReload: (options?: { silent?: boolean }) => Promise<DownloadItem[] | undefined>;
}

interface SyncDownloadsResult {
	ready?: number;
	failed?: number;
}

interface SoftwareUpdateResult {
	label: string;
	status: 'updated' | 'current' | 'failed';
	error?: string;
}

interface SoftwareUpdateSummary {
	updated: number;
	current: number;
	failed: number;
	results: SoftwareUpdateResult[];
}

interface BulkMutationResult {
	updated?: DownloadItem[];
	deletedIds?: string[];
}

function getPlatformIcon(platform: Platform): string {
	switch (platform) {
		case 'windows':
			return '🪟';
		case 'macos':
			return '🍎';
		case 'linux':
			return '🐧';
		default:
			return '📦';
	}
}

function getStorageLabel(type: StorageType): string {
	switch (type) {
		case 'link':
			return '外部链接';
		case 'r2':
			return 'Cloudflare R2';
		case 's3':
			return '自定义 S3';
		default:
			return type;
	}
}

function getR2BackupLabel(item: DownloadItem): string {
	switch (item.r2Backup?.status) {
		case 'pending':
			return 'R2 等待同步';
		case 'syncing':
			return 'R2 同步中';
		case 'ready':
			return item.r2Backup.error ? 'R2 已备份（刷新失败）' : 'R2 已备份';
		case 'failed':
			return 'R2 同步失败';
		default:
			return 'R2 未备份';
	}
}

function getBriefBackupError(message: string): string {
	const compact = message.replace(/\s+/g, ' ').trim();
	return compact.length > 72 ? `${compact.slice(0, 72)}…` : compact;
}

export default function DownloadList({
	downloads,
	categories,
	loading,
	onEdit,
	onToggleEnabled,
	onDelete,
	onReload
}: DownloadListProps) {
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [syncingLinks, setSyncingLinks] = useState(false);
	const [checkingUpdates, setCheckingUpdates] = useState(false);
	const [bulkUpdating, setBulkUpdating] = useState(false);
	const [showBulkActions, setShowBulkActions] = useState(false);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
	const syncControllerRef = useRef<AbortController | null>(null);
	const updateControllerRef = useRef<AbortController | null>(null);
	const bulkControllerRef = useRef<AbortController | null>(null);
	const mountedRef = useRef(false);
	const linkDownloads = useMemo(
		() => downloads.filter((item) => item.storageType === 'link'),
		[downloads]
	);
	const r2SyncDownloads = useMemo(() => linkDownloads.filter(needsR2VersionSync), [linkDownloads]);
	const selectedItemIds = useMemo(
		() => downloads.filter((download) => selectedIds.has(download.id)).map(({ id }) => id),
		[downloads, selectedIds]
	);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			syncControllerRef.current?.abort();
			updateControllerRef.current?.abort();
			bulkControllerRef.current?.abort();
		};
	}, []);

	async function handleSyncLinks() {
		if (
			r2SyncDownloads.length === 0 ||
			syncingLinks ||
			syncControllerRef.current ||
			updateControllerRef.current ||
			bulkControllerRef.current
		) {
			return;
		}
		const controller = new AbortController();
		syncControllerRef.current = controller;
		setSyncingLinks(true);
		setError('');
		setSuccess('');

		try {
			let nextIndex = 0;
			let ready = 0;
			let failed = 0;
			const failures: string[] = [];
			async function worker() {
				while (nextIndex < r2SyncDownloads.length) {
					const item = r2SyncDownloads[nextIndex++];
					try {
						const response = await fetch('/api/admin/downloads/sync', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ itemId: item.id }),
							signal: controller.signal
						});
						const data = (await response.json()) as ApiResponse<SyncDownloadsResult>;
						if (!response.ok || !data.success) throw new Error(data.error || '同步失败');
						ready += data.data?.ready ?? 0;
						failed += data.data?.failed ?? 0;
						if ((data.data?.failed ?? 0) > 0) {
							failures.push(`${item.title || item.filename || item.id} 同步失败`);
						}
					} catch (caught) {
						if (caught instanceof DOMException && caught.name === 'AbortError') throw caught;
						failed += 1;
						failures.push(caught instanceof Error ? caught.message : '同步失败');
					}
				}
			}
			await Promise.all(
				Array.from({ length: Math.min(3, r2SyncDownloads.length) }, () => worker())
			);
			if (controller.signal.aborted) return;
			await onReload({ silent: true });
			if (controller.signal.aborted) return;
			if (mountedRef.current) {
				setSuccess(ready > 0 ? `R2 同步完成：成功 ${ready} 个。` : '');
			}
			if (failed > 0 && mountedRef.current) {
				const firstFailure = failures[0];
				setError(
					`R2 同步完成：失败 ${failed} 个。${firstFailure ? ` ${getBriefBackupError(firstFailure)}` : ''}`
				);
			}
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			if (mountedRef.current) setError(caught instanceof Error ? caught.message : '同步失败');
		} finally {
			if (syncControllerRef.current === controller) {
				syncControllerRef.current = null;
				if (mountedRef.current) setSyncingLinks(false);
			}
		}
	}

	async function handleCheckUpdates() {
		if (
			checkingUpdates ||
			updateControllerRef.current ||
			syncControllerRef.current ||
			bulkControllerRef.current
		) {
			return;
		}
		const controller = new AbortController();
		updateControllerRef.current = controller;
		setCheckingUpdates(true);
		setError('');
		setSuccess('');

		try {
			const response = await fetch('/api/admin/downloads/update', {
				method: 'POST',
				signal: controller.signal
			});
			const data = (await response.json()) as ApiResponse<SoftwareUpdateSummary>;
			if (!response.ok || !data.success || !data.data) {
				throw new Error(data.error || `检查更新失败（HTTP ${response.status}）`);
			}
			if (controller.signal.aborted) return;
			await onReload({ silent: true });
			if (controller.signal.aborted || !mountedRef.current) return;

			const summary = data.data;
			if (summary.updated > 0 || summary.current > 0) {
				setSuccess(`检查完成：更新 ${summary.updated} 个，已是最新 ${summary.current} 个。`);
			}
			if (summary.failed > 0) {
				const firstFailure = summary.results.find((result) => result.status === 'failed');
				setError(
					`检查更新失败 ${summary.failed} 个。${
						firstFailure
							? ` ${firstFailure.label}：${getBriefBackupError(firstFailure.error || '未知错误')}`
							: ''
					}`
				);
			}
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			if (mountedRef.current) {
				setError(caught instanceof Error ? caught.message : '检查更新失败');
			}
		} finally {
			if (updateControllerRef.current === controller) {
				updateControllerRef.current = null;
				if (mountedRef.current) setCheckingUpdates(false);
			}
		}
	}

	function toggleSelectAll() {
		if (bulkUpdating) return;
		setSelectedIds(
			selectedItemIds.length === downloads.length
				? new Set()
				: new Set(downloads.map((download) => download.id))
		);
	}

	function toggleSelected(id: string) {
		setSelectedIds((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	async function handleBulkMoveToCategory(categoryId: string | null) {
		if (
			bulkUpdating ||
			bulkControllerRef.current ||
			syncControllerRef.current ||
			updateControllerRef.current
		) {
			return;
		}
		if (selectedItemIds.length === 0) {
			setError('请先选择要移动的下载项');
			return;
		}
		const controller = new AbortController();
		bulkControllerRef.current = controller;
		setBulkUpdating(true);
		setError('');
		setSuccess('');
		const itemIds = selectedItemIds;
		try {
			const selectedItems = itemIds.map((id) => downloads.find((item) => item.id === id));
			if (selectedItems.some((item) => !item)) {
				throw new Error('部分下载项已不存在，请刷新列表后重试');
			}
			const response = await fetch('/api/admin', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					updates: selectedItems.map((item) => ({ id: item!.id, categoryId }))
				}),
				signal: controller.signal
			});
			const data = (await response.json()) as ApiResponse<BulkMutationResult>;
			if (controller.signal.aborted) return;
			if (!response.ok || !data.success) {
				throw new Error(data.error || `批量移动失败（HTTP ${response.status}）`);
			}
			const updatedIds = new Set(data.data?.updated?.map((item) => item.id) || []);
			if (itemIds.some((id) => !updatedIds.has(id))) {
				throw new Error('服务器返回的批量移动结果不完整，请刷新确认');
			}
			if (mountedRef.current) {
				setSuccess(`成功移动 ${itemIds.length} 个下载项。`);
				setSelectedIds(new Set());
				setShowBulkActions(false);
			}
			await onReload();
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			if (mountedRef.current) {
				setError(caught instanceof Error ? `批量移动失败：${caught.message}` : '批量移动失败');
			}
		} finally {
			if (bulkControllerRef.current === controller) {
				bulkControllerRef.current = null;
				if (mountedRef.current) setBulkUpdating(false);
			}
		}
	}

	async function handleBulkDelete() {
		if (
			bulkUpdating ||
			bulkControllerRef.current ||
			syncControllerRef.current ||
			updateControllerRef.current
		) {
			return;
		}
		if (selectedItemIds.length === 0) {
			setError('请先选择要删除的下载项');
			return;
		}
		const itemIds = selectedItemIds;
		if (!window.confirm(`确定要删除选中的 ${itemIds.length} 个下载项吗？`)) return;
		const controller = new AbortController();
		bulkControllerRef.current = controller;
		setBulkUpdating(true);
		setError('');
		setSuccess('');
		try {
			const response = await fetch('/api/admin', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids: itemIds }),
				signal: controller.signal
			});
			const data = (await response.json()) as ApiResponse<BulkMutationResult>;
			if (controller.signal.aborted) return;
			if (!response.ok || !data.success) {
				throw new Error(data.error || `批量删除失败（HTTP ${response.status}）`);
			}
			const deletedIds = new Set(data.data?.deletedIds || []);
			if (itemIds.some((id) => !deletedIds.has(id))) {
				throw new Error('服务器返回的批量删除结果不完整，请刷新确认');
			}
			if (mountedRef.current) {
				setSuccess(`成功删除 ${itemIds.length} 个下载项。`);
				setSelectedIds(new Set());
				setShowBulkActions(false);
			}
			await onReload();
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			if (mountedRef.current) {
				setError(caught instanceof Error ? `批量删除失败：${caught.message}` : '批量删除失败');
			}
		} finally {
			if (bulkControllerRef.current === controller) {
				bulkControllerRef.current = null;
				if (mountedRef.current) setBulkUpdating(false);
			}
		}
	}

	function handleBulkCategoryChange(event: ChangeEvent<HTMLSelectElement>) {
		const select = event.currentTarget;
		if (!select.value) return;
		const value = select.value === '__none__' ? null : select.value;
		void handleBulkMoveToCategory(value);
		select.value = '';
	}

	return (
		<section className={styles.listSection}>
			<div className={styles.sectionHeader}>
				<h2>📋 下载列表</h2>
				{downloads.length > 0 && (
					<div className={styles.sectionHeaderActions}>
						<button
							className={classNames(styles.btn, styles.btnSmall, styles.btnUpdate)}
							type="button"
							onClick={() => void handleCheckUpdates()}
							disabled={checkingUpdates || syncingLinks || bulkUpdating}
							title="检查官方稳定版并更新 Mumble、RustDesk 的 R2 文件"
						>
							{checkingUpdates ? (
								<>
									<span className={styles.buttonSpinner} aria-hidden="true" />
									正在检查并更新...
								</>
							) : (
								'检查 Mumble / RustDesk 更新'
							)}
						</button>
						<button
							className={classNames(styles.btn, styles.btnSmall, styles.btnSync)}
							type="button"
							onClick={() => void handleSyncLinks()}
							disabled={
								checkingUpdates || syncingLinks || bulkUpdating || r2SyncDownloads.length === 0
							}
							title={
								r2SyncDownloads.length === 0
									? '当前版本与 R2 版本一致，无需同步'
									: `同步 ${r2SyncDownloads.length} 个版本不同的外部链接到 R2`
							}
						>
							{syncingLinks ? (
								<>
									<span className={styles.buttonSpinner} aria-hidden="true" />
									正在同步...
								</>
							) : (
								`☁️ 同步到 R2 (${r2SyncDownloads.length})`
							)}
						</button>
						<button
							className={classNames(
								styles.btn,
								styles.btnSmall,
								!showBulkActions && styles.btnPrimary
							)}
							type="button"
							disabled={checkingUpdates || syncingLinks || bulkUpdating}
							onClick={() => {
								setShowBulkActions((shown) => {
									if (shown) setSelectedIds(new Set());
									return !shown;
								});
							}}
						>
							{showBulkActions ? '取消批量操作' : '批量操作'}
						</button>
					</div>
				)}
			</div>

			{error && <Alert type="error" message={error} onClose={() => setError('')} />}
			{success && <Alert type="success" message={success} onClose={() => setSuccess('')} />}

			{showBulkActions && downloads.length > 0 && (
				<div className={styles.bulkActionsBar}>
					<label className={styles.checkboxLabel}>
						<input
							type="checkbox"
							checked={selectedItemIds.length === downloads.length}
							disabled={bulkUpdating}
							onChange={toggleSelectAll}
						/>
						<span>
							全选 ({selectedItemIds.length} / {downloads.length})
						</span>
					</label>
					{selectedItemIds.length > 0 && (
						<div className={styles.bulkActionButtons}>
							<select
								className={styles.bulkCategorySelect}
								disabled={bulkUpdating}
								aria-label="批量移动到分类"
								defaultValue=""
								onChange={handleBulkCategoryChange}
							>
								<option value="">移动到分类...</option>
								<option value="__none__">（无分类）</option>
								{categories.map((category) => (
									<option key={category.id} value={category.id}>
										{category.icon || ''} {category.name}
									</option>
								))}
							</select>
							<button
								className={classNames(styles.btn, styles.btnSmall, styles.btnDanger)}
								type="button"
								onClick={() => void handleBulkDelete()}
								disabled={bulkUpdating}
							>
								{bulkUpdating ? '处理中...' : `删除选中 (${selectedItemIds.length})`}
							</button>
						</div>
					)}
				</div>
			)}

			{loading ? (
				<div className={styles.loading}>
					<div className={classNames(styles.spinner, styles.large)} />
					<p>加载中...</p>
				</div>
			) : downloads.length === 0 ? (
				<div className={styles.emptyState}>
					<span className={styles.emptyIcon}>📦</span>
					<p>暂无下载项</p>
					<p className={styles.emptyHint}>使用上方表单添加第一个下载项吧！</p>
				</div>
			) : (
				<div className={styles.downloadList}>
					{downloads.map((item) => {
						const category = categories.find((candidate) => candidate.id === item.categoryId);
						const backupStatus = item.r2Backup?.status || 'missing';
						return (
							<div
								key={item.id}
								className={classNames(styles.downloadItem, !item.enabled && styles.disabled)}
							>
								{showBulkActions && (
									<label className={styles.itemCheckbox}>
										<input
											type="checkbox"
											checked={selectedIds.has(item.id)}
											disabled={bulkUpdating}
											aria-label={`选择 ${item.title || item.filename || item.version}`}
											onChange={() => toggleSelected(item.id)}
										/>
									</label>
								)}
								<div className={styles.itemIcon}>{getPlatformIcon(item.platform)}</div>
								<div className={styles.itemInfo}>
									<div className={styles.itemTitle}>
										{item.title || `${item.platform.toUpperCase()} - ${item.version}`}
										<span
											className={classNames(
												styles.badge,
												styles[
													`badge${item.storageType.toUpperCase()}` as
														'badgeLINK' | 'badgeR2' | 'badgeS3'
												]
											)}
										>
											{getStorageLabel(item.storageType)}
										</span>
										{item.storageType === 'link' && (
											<span
												className={classNames(
													styles.badge,
													styles.badgeBackup,
													styles[
														`backup${backupStatus[0].toUpperCase()}${backupStatus.slice(1)}` as
															| 'backupMissing'
															| 'backupPending'
															| 'backupSyncing'
															| 'backupReady'
															| 'backupFailed'
													]
												)}
												title={item.r2Backup?.error || getR2BackupLabel(item)}
											>
												{(backupStatus === 'pending' || backupStatus === 'syncing') && (
													<span className={styles.backupSpinner} aria-hidden="true" />
												)}
												{getR2BackupLabel(item)}
											</span>
										)}
										{item.rustdeskConfig?.enabled && (
											<span className={classNames(styles.badge, styles.badgeRustdesk)}>
												RustDesk 接口
											</span>
										)}
										{category && (
											<span
												className={classNames(styles.badge, styles.badgeCategory)}
												style={{
													backgroundColor: category.color
														? `${category.color}15`
														: 'rgba(107, 76, 154, 0.08)',
													color: category.color || '#6b4c9a'
												}}
											>
												{category.icon || ''} {category.name}
											</span>
										)}
									</div>
									<div className={styles.itemMeta}>
										<span>版本 {item.version}</span>
										<span>📦 {item.size}</span>
										{item.description && <span>📝 {item.description}</span>}
										{item.filename && <span>📝 {item.filename}</span>}
										{item.configGuide && (
											<span>
												🧭 指引 {item.configGuide.split(/\r?\n/).filter(Boolean).length} 步
											</span>
										)}
										<span>
											🔗{' '}
											<a
												href={item.storageType === 'link' ? item.url : item.signedUrl || item.url}
												target="_blank"
												rel="noopener"
												onClick={(event) => event.stopPropagation()}
											>
												{item.url.slice(0, 50)}...
											</a>
										</span>
										{item.storageType === 'link' && item.r2Backup?.error && (
											<span className={styles.backupError} title={item.r2Backup.error}>
												⚠️ R2：{getBriefBackupError(item.r2Backup.error)}
											</span>
										)}
									</div>
								</div>
								<div className={styles.itemActions}>
									<button
										className={classNames(
											styles.btn,
											styles.btnSmall,
											item.enabled ? styles.btnWarning : styles.btnSuccess
										)}
										type="button"
										disabled={checkingUpdates}
										onClick={() => void onToggleEnabled(item)}
									>
										{item.enabled ? '禁用' : '启用'}
									</button>
									<button
										className={classNames(styles.btn, styles.btnSmall)}
										type="button"
										disabled={checkingUpdates}
										onClick={() => onEdit(item)}
									>
										编辑
									</button>
									<button
										className={classNames(styles.btn, styles.btnSmall, styles.btnDanger)}
										type="button"
										disabled={checkingUpdates}
										onClick={() => void onDelete(item.id)}
									>
										删除
									</button>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}

function Alert({
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
			aria-live={type === 'success' ? 'polite' : undefined}
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
