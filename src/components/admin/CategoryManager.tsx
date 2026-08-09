import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ApiResponse, Category, CategoryList } from '$lib/types';
import ColorPicker from './ColorPicker';
import DraggableList from './DraggableList';
import EmojiPicker from './EmojiPicker';
import { classNames } from './classNames';
import { useDialogFocus } from './useDialogFocus';
import styles from './CategoryManager.module.css';

interface CategoryManagerProps {
	categories: Category[];
	downloads: Array<{ categoryId?: string; enabled: boolean }>;
	onCategoriesChange: (categories: Category[]) => void;
	onReloadDownloads: () => void | Promise<unknown>;
}

export default function CategoryManager({
	categories,
	downloads,
	onCategoriesChange,
	onReloadDownloads
}: CategoryManagerProps) {
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [reordering, setReordering] = useState(false);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [showForm, setShowForm] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [formName, setFormName] = useState('');
	const [formIcon, setFormIcon] = useState('');
	const [formColor, setFormColor] = useState('');
	const [formDescription, setFormDescription] = useState('');
	const [formOrder, setFormOrder] = useState(0);
	const [showEmojiPicker, setShowEmojiPicker] = useState(false);
	const [showColorPicker, setShowColorPicker] = useState(false);
	const dialogRef = useRef<HTMLDivElement>(null);
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const saveControllerRef = useRef<AbortController | null>(null);
	const loadControllerRef = useRef<AbortController | null>(null);
	const reorderControllerRef = useRef<AbortController | null>(null);
	const deleteControllersRef = useRef(new Map<string, AbortController>());
	const mountedRef = useRef(false);
	const formSessionRef = useRef(0);
	const titleId = useId();
	const errorId = useId();

	const closeForm = useCallback(() => {
		formSessionRef.current += 1;
		saveControllerRef.current?.abort();
		saveControllerRef.current = null;
		setSaving(false);
		setShowForm(false);
		setEditingId(null);
		setFormName('');
		setFormIcon('');
		setFormColor('');
		setFormDescription('');
		setFormOrder(0);
		setShowEmojiPicker(false);
		setShowColorPicker(false);
	}, []);

	useDialogFocus(showForm, dialogRef, closeButtonRef, closeForm);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			formSessionRef.current += 1;
			saveControllerRef.current?.abort();
			loadControllerRef.current?.abort();
			loadControllerRef.current = null;
		};
	}, []);

	function openForm(category?: Category): void {
		formSessionRef.current += 1;
		saveControllerRef.current?.abort();
		saveControllerRef.current = null;
		setSaving(false);
		setEditingId(category?.id ?? null);
		setFormName(category?.name ?? '');
		setFormIcon(category?.icon ?? '');
		setFormColor(category?.color ?? '');
		setFormDescription(category?.description ?? '');
		setFormOrder(category?.order ?? categories.length);
		setShowEmojiPicker(false);
		setShowColorPicker(false);
		setSuccess('');
		setError('');
		setShowForm(true);
	}

	async function loadCategories(): Promise<void> {
		loadControllerRef.current?.abort();
		const controller = new AbortController();
		loadControllerRef.current = controller;
		setLoading(true);
		setError('');
		try {
			const response = await fetch('/api/admin/categories', { signal: controller.signal });
			const data = (await response.json()) as ApiResponse<CategoryList>;
			if (controller.signal.aborted) return;
			if (!response.ok || !data.success || !data.data) {
				setError(data.error || '加载分类失败');
				return;
			}
			onCategoriesChange(data.data.items);
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			setError('网络错误');
		} finally {
			if (loadControllerRef.current === controller) {
				loadControllerRef.current = null;
				setLoading(false);
			}
		}
	}

	async function handleSave(): Promise<void> {
		if (!formName.trim()) {
			setError('请输入分类名称');
			return;
		}
		if (saving || saveControllerRef.current) return;

		const session = formSessionRef.current;
		const targetId = editingId;
		const controller = new AbortController();
		saveControllerRef.current = controller;
		setSaving(true);
		setError('');

		try {
			const response = await fetch('/api/admin/categories', {
				method: targetId ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...(targetId ? { id: targetId } : {}),
					name: formName.trim(),
					icon: formIcon.trim() || undefined,
					color: formColor.trim() || undefined,
					description: formDescription.trim() || undefined,
					order: formOrder
				}),
				signal: controller.signal
			});
			const data = (await response.json()) as ApiResponse<Category>;
			if (session !== formSessionRef.current || controller.signal.aborted) return;
			if (!response.ok || !data.success || !data.data) {
				setError(data.error || '保存失败');
				return;
			}

			const nextCategories = targetId
				? categories.map((category) => (category.id === targetId ? data.data! : category))
				: [...categories, data.data];
			onCategoriesChange(nextCategories);
			setSuccess(targetId ? '更新成功！' : '添加成功！');
			closeForm();
			await loadCategories();
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			if (session === formSessionRef.current) setError('网络错误');
		} finally {
			if (session === formSessionRef.current && saveControllerRef.current === controller) {
				saveControllerRef.current = null;
				setSaving(false);
			}
		}
	}

	async function handleDelete(id: string): Promise<void> {
		if (deleteControllersRef.current.has(id)) return;
		const itemsInCategory = downloads.filter((download) => download.categoryId === id);
		const message =
			itemsInCategory.length > 0
				? `该分类下有 ${itemsInCategory.length} 个下载项，确定要删除吗？删除后这些下载项将变为无分类。`
				: '确定要删除这个分类吗？';
		if (!window.confirm(message)) return;
		const controller = new AbortController();
		deleteControllersRef.current.set(id, controller);

		try {
			const response = await fetch('/api/admin/categories', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id }),
				signal: controller.signal
			});
			const data = (await response.json()) as ApiResponse;
			if (controller.signal.aborted) return;
			if (!response.ok || !data.success) {
				if (mountedRef.current) setError(data.error || '删除失败');
				return;
			}
			onCategoriesChange(categories.filter((category) => category.id !== id));
			if (mountedRef.current) {
				setSuccess('删除成功！');
				setError('');
			}
			if (itemsInCategory.length > 0) await onReloadDownloads();
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			if (mountedRef.current) setError('网络错误');
		} finally {
			deleteControllersRef.current.delete(id);
		}
	}

	async function handleReorder(reorderedCategories: Category[]): Promise<void> {
		if (reordering || reorderControllerRef.current) return;
		const controller = new AbortController();
		reorderControllerRef.current = controller;
		const previousCategories = categories.map((category) => ({ ...category }));
		onCategoriesChange(reorderedCategories);
		setReordering(true);
		setError('');
		setSuccess('');

		try {
			const response = await fetch('/api/admin/categories', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					orders: reorderedCategories.map(({ id, order }) => ({ id, order }))
				}),
				signal: controller.signal
			});
			const data = (await response.json()) as ApiResponse<CategoryList>;
			if (controller.signal.aborted) return;
			if (!response.ok || !data.success || !data.data) {
				throw new Error(data.error || '服务器未返回更新后的分类列表');
			}
			onCategoriesChange(data.data.items);
			if (mountedRef.current) setSuccess('排序已更新！');
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			onCategoriesChange(previousCategories);
			if (mountedRef.current) {
				setError(caught instanceof Error ? `更新排序失败：${caught.message}` : '更新排序失败');
			}
		} finally {
			if (reorderControllerRef.current === controller) {
				reorderControllerRef.current = null;
				if (mountedRef.current) setReordering(false);
			}
		}
	}

	return (
		<>
			<section className={styles.section}>
				<div className={styles.sectionHeader}>
					<h2>🗂️ 分类管理</h2>
					<button
						type="button"
						className={classNames(styles.button, styles.small, styles.primary)}
						onClick={() => openForm()}
					>
						+ 添加分类
					</button>
				</div>

				{error ? (
					<div className={classNames(styles.alert, styles.alertError)} role="alert">
						<span>❌</span>
						{error}
						<button
							className={styles.alertClose}
							type="button"
							aria-label="关闭错误提示"
							onClick={() => setError('')}
						>
							×
						</button>
					</div>
				) : null}
				{success ? (
					<div
						className={classNames(styles.alert, styles.alertSuccess)}
						role="status"
						aria-live="polite"
					>
						<span>✅</span>
						{success}
						<button
							className={styles.alertClose}
							type="button"
							aria-label="关闭成功提示"
							onClick={() => setSuccess('')}
						>
							×
						</button>
					</div>
				) : null}

				{loading ? (
					<div className={styles.loading}>
						<span className={classNames(styles.spinner, styles.spinnerLarge)} />
						<p>加载中...</p>
					</div>
				) : categories.length === 0 ? (
					<div className={styles.empty}>
						<span className={styles.emptyIcon}>📂</span>
						<p>暂无分类</p>
						<p className={styles.emptyHint}>点击上方按钮添加第一个分类～</p>
					</div>
				) : (
					<DraggableList
						items={categories}
						disabled={reordering}
						onReorder={(items) => void handleReorder(items)}
						renderItem={(category) => (
							<>
								<div className={styles.iconWrapper}>
									{category.color ? (
										<span className={styles.colorDot} style={{ backgroundColor: category.color }} />
									) : null}
									<span className={styles.categoryIcon}>{category.icon || '📁'}</span>
								</div>
								<div className={styles.categoryInfo}>
									<div className={styles.nameRow}>
										<span className={styles.categoryName}>{category.name}</span>
										<span className={styles.countBadge}>
											{
												downloads.filter(
													(download) => download.enabled && download.categoryId === category.id
												).length
											}
										</span>
									</div>
									{category.description ? (
										<div className={styles.description}>{category.description}</div>
									) : null}
									<div className={styles.meta}>
										排序: {category.order}
										{category.color ? (
											<span
												className={styles.colorPreview}
												style={{ backgroundColor: category.color }}
											>
												{category.color}
											</span>
										) : null}
									</div>
								</div>
								<div className={styles.categoryActions}>
									<button
										type="button"
										className={classNames(styles.button, styles.small)}
										onClick={() => openForm(category)}
									>
										编辑
									</button>
									<button
										type="button"
										className={classNames(styles.button, styles.small, styles.danger)}
										onClick={() => void handleDelete(category.id)}
									>
										删除
									</button>
								</div>
							</>
						)}
					/>
				)}
			</section>

			{showForm ? (
				<div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby={titleId}>
					<button
						className={styles.scrim}
						type="button"
						aria-label="关闭分类表单"
						onClick={closeForm}
					/>
					<div
						className={styles.modal}
						ref={dialogRef}
						tabIndex={-1}
						aria-describedby={error ? errorId : undefined}
					>
						<div className={styles.modalHeader}>
							<h3 id={titleId}>{editingId ? '编辑分类' : '添加分类'}</h3>
							<button
								ref={closeButtonRef}
								type="button"
								className={styles.modalClose}
								aria-label="关闭分类表单"
								onClick={closeForm}
							>
								×
							</button>
						</div>
						{error ? (
							<p className={styles.modalError} id={errorId} role="alert">
								{error}
							</p>
						) : null}
						<div className={styles.formGrid}>
							<label className={styles.field}>
								<span>分类名称</span>
								<input
									value={formName}
									placeholder="例如：工具"
									onChange={(event) => setFormName(event.target.value)}
								/>
							</label>
							<label className={styles.field}>
								<span>描述（可选）</span>
								<textarea
									value={formDescription}
									rows={2}
									placeholder="简单描述这个分类"
									onChange={(event) => setFormDescription(event.target.value)}
								/>
							</label>
							<div className={styles.field}>
								<label htmlFor="category-icon">图标（emoji）</label>
								<div className={styles.inlineInput}>
									<input
										id="category-icon"
										readOnly
										value={formIcon}
										placeholder="🔧"
										onClick={() => setShowEmojiPicker((shown) => !shown)}
									/>
									<button
										className={classNames(styles.button, styles.small)}
										type="button"
										onClick={() => setShowEmojiPicker((shown) => !shown)}
									>
										{showEmojiPicker ? '收起' : '选择'}
									</button>
								</div>
								{showEmojiPicker ? (
									<div className={styles.picker}>
										<EmojiPicker
											value={formIcon}
											onSelect={(emoji) => {
												setFormIcon(emoji);
												setShowEmojiPicker(false);
											}}
										/>
									</div>
								) : null}
							</div>
							<div className={styles.field}>
								<label htmlFor="category-color">分类颜色（可选）</label>
								<div className={styles.inlineInput}>
									<input
										id="category-color"
										readOnly
										value={formColor}
										placeholder="#667EEA"
										onClick={() => setShowColorPicker((shown) => !shown)}
									/>
									<button
										className={classNames(styles.button, styles.small)}
										type="button"
										onClick={() => setShowColorPicker((shown) => !shown)}
									>
										{showColorPicker ? '收起' : '选择'}
									</button>
									{formColor ? (
										<span
											className={styles.colorIndicator}
											style={{ backgroundColor: formColor }}
										/>
									) : null}
								</div>
								{showColorPicker ? (
									<div className={styles.picker}>
										<ColorPicker value={formColor} onSelect={setFormColor} />
									</div>
								) : null}
							</div>
							<label className={styles.field}>
								<span>排序</span>
								<input
									type="number"
									value={formOrder}
									onChange={(event) => setFormOrder(event.target.valueAsNumber || 0)}
								/>
								<small>数字越小越靠前，支持拖放排序</small>
							</label>
						</div>
						<div className={styles.modalFooter}>
							<button
								className={classNames(styles.button, styles.secondary)}
								type="button"
								onClick={closeForm}
							>
								取消
							</button>
							<button
								className={classNames(styles.button, styles.primary)}
								type="button"
								disabled={saving}
								onClick={() => void handleSave()}
							>
								{saving ? (
									<>
										<span className={styles.spinner} /> 保存中...
									</>
								) : (
									'保存'
								)}
							</button>
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}
