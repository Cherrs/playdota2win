import { useCallback, useEffect, useRef, useState } from 'react';

import '$lib/styles/admin-form.css';
import type { Announcement, AnnouncementFormData, AnnouncementList, ApiResponse } from '$lib/types';

import styles from './AnnouncementForm.module.css';
import { classNames } from './classNames';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export default function AnnouncementForm() {
	const [announcements, setAnnouncements] = useState<Announcement[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [editingId, setEditingId] = useState<string | null>(null);
	const [title, setTitle] = useState('');
	const [content, setContent] = useState('');
	const [visible, setVisible] = useState(true);
	const [pinned, setPinned] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const loadControllerRef = useRef<AbortController | null>(null);
	const mutationControllerRef = useRef<AbortController | null>(null);
	const actionControllersRef = useRef(new Map<string, AbortController>());
	const mountedRef = useRef(false);

	const showTemporarySuccess = useCallback((message: string) => {
		if (successTimerRef.current) clearTimeout(successTimerRef.current);
		setSuccess(message);
		successTimerRef.current = setTimeout(() => {
			setSuccess('');
			successTimerRef.current = null;
		}, 3000);
	}, []);

	const loadAnnouncements = useCallback(async (signal?: AbortSignal) => {
		setLoading(true);
		try {
			const response = await fetch('/api/admin/announcements', { signal });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = (await response.json()) as ApiResponse<AnnouncementList>;
			if (data.success && data.data) {
				setAnnouncements(data.data.items);
			} else {
				setError(data.error || '加载失败');
			}
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			setError('网络错误');
		} finally {
			if (!signal?.aborted) setLoading(false);
		}
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		mountedRef.current = true;
		loadControllerRef.current = controller;
		queueMicrotask(() => {
			if (!controller.signal.aborted) void loadAnnouncements(controller.signal);
		});
		return () => {
			mountedRef.current = false;
			controller.abort();
			if (successTimerRef.current) clearTimeout(successTimerRef.current);
		};
	}, [loadAnnouncements]);

	function startEdit(item: Announcement) {
		setEditingId(item.id);
		setTitle(item.title);
		setContent(item.content);
		setVisible(item.visible);
		setPinned(item.pinned);
	}

	function cancelEdit() {
		setEditingId(null);
		setTitle('');
		setContent('');
		setVisible(true);
		setPinned(false);
	}

	async function reloadAnnouncements() {
		loadControllerRef.current?.abort();
		const controller = new AbortController();
		loadControllerRef.current = controller;
		await loadAnnouncements(controller.signal);
	}

	async function handleSubmit() {
		if (!title.trim() || !content.trim()) {
			setError('标题和内容不能为空');
			return;
		}
		if (submitting || mutationControllerRef.current) return;
		const controller = new AbortController();
		mutationControllerRef.current = controller;
		setSubmitting(true);
		setError('');
		setSuccess('');
		try {
			const body: AnnouncementFormData & { id?: string } = {
				title,
				content,
				visible,
				pinned,
				...(editingId && { id: editingId })
			};
			const response = await fetch('/api/admin/announcements', {
				method: editingId ? 'PUT' : 'POST',
				headers: JSON_HEADERS,
				body: JSON.stringify(body),
				signal: controller.signal
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = (await response.json()) as ApiResponse<Announcement>;
			if (controller.signal.aborted || !mountedRef.current) return;
			if (data.success) {
				showTemporarySuccess(editingId ? '更新成功' : '创建成功');
				cancelEdit();
				await reloadAnnouncements();
			} else {
				setError(data.error || '操作失败');
			}
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			if (mountedRef.current) setError('网络错误');
		} finally {
			if (mutationControllerRef.current === controller) {
				mutationControllerRef.current = null;
				if (mountedRef.current) setSubmitting(false);
			}
		}
	}

	async function updateAnnouncement(item: Announcement, patch: Partial<Announcement>) {
		const actionKey = `item:${item.id}`;
		if (actionControllersRef.current.has(actionKey)) return;
		const controller = new AbortController();
		actionControllersRef.current.set(actionKey, controller);
		try {
			const response = await fetch('/api/admin/announcements', {
				method: 'PUT',
				headers: JSON_HEADERS,
				body: JSON.stringify({ id: item.id, ...patch }),
				signal: controller.signal
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = (await response.json()) as ApiResponse;
			if (controller.signal.aborted || !mountedRef.current) return;
			if (data.success) {
				setError('');
				await reloadAnnouncements();
			} else {
				setError(data.error || '操作失败');
			}
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			if (mountedRef.current) setError('操作失败');
		} finally {
			actionControllersRef.current.delete(actionKey);
		}
	}

	async function deleteAnnouncement(id: string) {
		if (!window.confirm('确定删除这条公告吗？')) return;
		const actionKey = `item:${id}`;
		if (actionControllersRef.current.has(actionKey)) return;
		const controller = new AbortController();
		actionControllersRef.current.set(actionKey, controller);
		try {
			const response = await fetch('/api/admin/announcements', {
				method: 'DELETE',
				headers: JSON_HEADERS,
				body: JSON.stringify({ id }),
				signal: controller.signal
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = (await response.json()) as ApiResponse;
			if (controller.signal.aborted || !mountedRef.current) return;
			if (data.success) {
				showTemporarySuccess('删除成功');
				await reloadAnnouncements();
			} else {
				setError(data.error || '删除失败');
			}
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			if (mountedRef.current) setError('网络错误');
		} finally {
			actionControllersRef.current.delete(actionKey);
		}
	}

	return (
		<div className={styles.announcementManager}>
			<h3 className={styles.sectionTitle}>公告管理</h3>
			{error && (
				<div className={classNames(styles.alert, styles.alertError)} role="alert">
					{error}
				</div>
			)}
			{success && (
				<div className={classNames(styles.alert, styles.alertSuccess)} role="status">
					{success}
				</div>
			)}
			<div className={styles.formCard}>
				<h4 className={styles.formTitle}>{editingId ? '编辑公告' : '新增公告'}</h4>
				<div className={styles.formField}>
					<label htmlFor="ann-title" className="admin-label">
						标题
					</label>
					<input
						id="ann-title"
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder="公告标题"
						className={classNames(styles.formInput, 'admin-input')}
					/>
				</div>
				<div className={styles.formField}>
					<label htmlFor="ann-content" className="admin-label">
						内容（Markdown）
					</label>
					<textarea
						id="ann-content"
						value={content}
						onChange={(event) => setContent(event.target.value)}
						placeholder="支持 **加粗**、[链接](url)、- 列表等 Markdown 格式"
						className={classNames(styles.formTextarea, 'admin-input')}
						rows={5}
					/>
				</div>
				<div className={styles.formRow}>
					<label className={styles.checkboxLabel}>
						<input
							type="checkbox"
							className="admin-checkbox"
							checked={visible}
							onChange={(event) => setVisible(event.target.checked)}
						/>
						<span>显示</span>
					</label>
					<label className={styles.checkboxLabel}>
						<input
							type="checkbox"
							className="admin-checkbox"
							checked={pinned}
							onChange={(event) => setPinned(event.target.checked)}
						/>
						<span>置顶</span>
					</label>
				</div>
				<div className={styles.formActions}>
					<button
						className="admin-btn admin-btn-primary"
						onClick={() => void handleSubmit()}
						disabled={submitting}
						type="button"
					>
						{submitting ? '提交中...' : editingId ? '保存修改' : '发布公告'}
					</button>
					{editingId && (
						<button className="admin-btn admin-btn-ghost" onClick={cancelEdit} type="button">
							取消
						</button>
					)}
				</div>
			</div>

			{loading ? (
				<p className={styles.loadingText}>加载中...</p>
			) : announcements.length === 0 ? (
				<p className={styles.emptyText}>暂无公告</p>
			) : (
				<div className={styles.list}>
					{announcements.map((item) => (
						<div className={styles.listItem} key={item.id}>
							<div className={styles.itemInfo}>
								<span className={styles.itemTitle}>
									{item.pinned ? '📌 ' : ''}
									{item.title}
								</span>
								<span className={classNames(styles.itemStatus, !item.visible && styles.hidden)}>
									{item.visible ? '显示' : '隐藏'}
								</span>
							</div>
							<div className={styles.itemActions}>
								<button
									className={styles.btnSm}
									onClick={() => void updateAnnouncement(item, { pinned: !item.pinned })}
									type="button"
								>
									{item.pinned ? '取消置顶' : '置顶'}
								</button>
								<button
									className={styles.btnSm}
									onClick={() => void updateAnnouncement(item, { visible: !item.visible })}
									type="button"
								>
									{item.visible ? '隐藏' : '显示'}
								</button>
								<button className={styles.btnSm} onClick={() => startEdit(item)} type="button">
									编辑
								</button>
								<button
									className={classNames(styles.btnSm, styles.btnDanger)}
									onClick={() => void deleteAnnouncement(item.id)}
									type="button"
								>
									删除
								</button>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
