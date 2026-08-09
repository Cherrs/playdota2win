import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { ApiResponse, Category, DownloadItem, Platform } from '$lib/types';
import { parseDownloadFileInfo } from '$lib/utils/parseFilename';

import styles from './DownloadEditModal.module.css';
import { classNames } from './classNames';
import { useDialogFocus } from './useDialogFocus';

export interface DownloadEditModalProps {
	item: DownloadItem;
	categories: Category[];
	onSave: (item: DownloadItem) => void;
	onClose: () => void;
}

export default function DownloadEditModal({
	item,
	categories,
	onSave,
	onClose
}: DownloadEditModalProps) {
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [platform, setPlatform] = useState<Platform>(item.platform);
	const [title, setTitle] = useState(item.title || '');
	const [description, setDescription] = useState(item.description || '');
	const [configGuide, setConfigGuide] = useState(item.configGuide || '');
	const [filename, setFilename] = useState(item.filename || '');
	const [version, setVersion] = useState(item.version);
	const [size, setSize] = useState(item.size);
	const [url, setUrl] = useState(item.url || '');
	const [categoryId, setCategoryId] = useState<string | undefined>(item.categoryId);
	const [rustDeskEnabled, setRustDeskEnabled] = useState(item.rustdeskConfig?.enabled === true);
	const [rustDeskIdServer, setRustDeskIdServer] = useState(item.rustdeskConfig?.idServer || '');
	const [rustDeskKey, setRustDeskKey] = useState(item.rustdeskConfig?.key || '');
	const dialogRef = useRef<HTMLDivElement>(null);
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const saveControllerRef = useRef<AbortController | null>(null);
	const closedRef = useRef(false);
	const titleId = useId();
	const errorId = useId();

	const handleClose = useCallback(() => {
		if (closedRef.current) return;
		closedRef.current = true;
		saveControllerRef.current?.abort();
		saveControllerRef.current = null;
		setSaving(false);
		onClose();
	}, [onClose]);

	useDialogFocus(true, dialogRef, closeButtonRef, handleClose);

	useEffect(
		() => () => {
			closedRef.current = true;
			saveControllerRef.current?.abort();
		},
		[]
	);

	function applyParsedFileInfo(input: string, updateFilename: boolean) {
		const parsed = parseDownloadFileInfo(input);
		if (updateFilename && parsed.filename) setFilename(parsed.filename);
		if (parsed.version) setVersion(parsed.version);
		if (parsed.platform) setPlatform(parsed.platform);
	}

	async function handleSave() {
		if (saving || saveControllerRef.current) return;
		if (!version || !size) {
			setError('请填写版本和大小');
			return;
		}
		if (!url.trim()) {
			setError('请填写下载地址');
			return;
		}
		if (rustDeskEnabled && (!rustDeskIdServer.trim() || !rustDeskKey.trim())) {
			setError('请填写 RustDesk ID 服务器和 key');
			return;
		}

		const itemId = item.id;
		const controller = new AbortController();
		saveControllerRef.current = controller;
		setSaving(true);
		setError('');
		try {
			const response = await fetch('/api/admin', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: itemId,
					platform,
					categoryId: categoryId || '',
					title: title.trim(),
					description: description.trim(),
					configGuide: configGuide.trim(),
					filename: filename.trim(),
					version: version.trim(),
					size: size.trim(),
					...(item.storageType === 'r2' ? {} : { url: url.trim() }),
					rustdeskConfig: {
						enabled: rustDeskEnabled,
						idServer: rustDeskIdServer.trim(),
						key: rustDeskKey.trim()
					}
				}),
				signal: controller.signal
			});
			const data = (await response.json()) as ApiResponse<DownloadItem>;
			if (closedRef.current || controller.signal.aborted || item.id !== itemId) return;
			if (response.ok && data.success && data.data) {
				onSave(data.data);
				handleClose();
			} else {
				setError(data.error || '更新失败');
			}
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			if (!closedRef.current && saveControllerRef.current === controller) setError('网络错误');
		} finally {
			if (!closedRef.current && saveControllerRef.current === controller) {
				saveControllerRef.current = null;
				setSaving(false);
			}
		}
	}

	return (
		<div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby={titleId}>
			<button
				type="button"
				className={styles.modalScrim}
				onClick={handleClose}
				aria-label="关闭编辑表单"
			/>
			<div
				className={classNames(styles.modalCard, styles.modalLg)}
				ref={dialogRef}
				tabIndex={-1}
				aria-busy={saving}
				aria-describedby={error ? errorId : undefined}
			>
				<div className={styles.modalHeader}>
					<h3 id={titleId}>编辑下载项</h3>
					<button
						type="button"
						className={styles.modalClose}
						onClick={handleClose}
						ref={closeButtonRef}
						aria-label="关闭编辑表单"
					>
						×
					</button>
				</div>
				{error && (
					<p className={styles.authError} id={errorId} role="alert" aria-live="assertive">
						{error}
					</p>
				)}
				<div className={styles.modalFormGrid}>
					<div className={classNames(styles.formGroup, styles.fullWidth)}>
						<p className={styles.fieldHint}>
							可修改展示信息和下载地址；外部链接变更后会重新同步 R2
							备份。如需更换存储方式或重新上传文件，请重新添加下载项。
						</p>
					</div>
					<div className={styles.formGroup}>
						<label htmlFor="editPlatform">平台</label>
						<select
							id="editPlatform"
							value={platform}
							onChange={(event) => setPlatform(event.target.value as Platform)}
						>
							<option value="windows">🪟 Windows</option>
							<option value="macos">🍎 macOS</option>
							<option value="linux">🐧 Linux</option>
						</select>
					</div>
					<div className={styles.formGroup}>
						<label htmlFor="editVersion">版本号</label>
						<input
							id="editVersion"
							value={version}
							onChange={(event) => setVersion(event.target.value)}
							placeholder="v1.0.0"
						/>
					</div>
					<div className={styles.formGroup}>
						<label htmlFor="editCategory">分类</label>
						<select
							id="editCategory"
							value={categoryId ?? ''}
							onChange={(event) => setCategoryId(event.target.value || undefined)}
						>
							<option value="">无分类</option>
							{categories.map((category) => (
								<option key={category.id} value={category.id}>
									{category.icon || ''} {category.name}
								</option>
							))}
						</select>
					</div>
					<div className={styles.formGroup}>
						<label htmlFor="editTitle">标题</label>
						<input
							id="editTitle"
							value={title}
							onChange={(event) => setTitle(event.target.value)}
							placeholder="例如：PlayDota2Win Windows 稳定版"
						/>
					</div>
					<div className={classNames(styles.formGroup, styles.fullWidth)}>
						<label htmlFor="editDescription">描述</label>
						<textarea
							id="editDescription"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							placeholder="简短描述这个版本的特性或用途"
						/>
					</div>
					<div className={classNames(styles.formGroup, styles.fullWidth)}>
						<label htmlFor="editConfigGuide">配置指引</label>
						<textarea
							id="editConfigGuide"
							value={configGuide}
							onChange={(event) => setConfigGuide(event.target.value)}
							placeholder="每行一条步骤，例如：复制 验证码123 或 打开 mumble://xxx"
						/>
						<p className={styles.fieldHint}>支持动作：复制 xxx / 打开 mumble://xxx 或 https://</p>
					</div>
					<div className={classNames(styles.formGroup, styles.fullWidth)}>
						<label htmlFor="editUrl">下载地址</label>
						<input
							id="editUrl"
							value={url}
							onChange={(event) => {
								setUrl(event.target.value);
								applyParsedFileInfo(event.target.value, true);
							}}
							readOnly={item.storageType === 'r2'}
							placeholder="https://example.com/download.exe 或 /api/admin/download/..."
						/>
						<p className={styles.fieldHint}>
							{item.storageType === 'r2'
								? 'R2 对象路径由上传流程生成且不可编辑；更换文件请重新添加下载项。'
								: '仅支持公网 HTTP(S) 地址；外部链接不可用时可手动选择 R2 备份。'}
						</p>
					</div>
					<div className={styles.formGroup}>
						<label htmlFor="editFilename">文件名</label>
						<input
							id="editFilename"
							value={filename}
							onChange={(event) => {
								setFilename(event.target.value);
								applyParsedFileInfo(event.target.value, false);
							}}
							placeholder="例如：PlayDota2Win.exe"
						/>
					</div>
					<div className={styles.formGroup}>
						<label htmlFor="editSize">文件大小</label>
						<input
							id="editSize"
							value={size}
							onChange={(event) => setSize(event.target.value)}
							placeholder="45MB"
						/>
					</div>
					<div className={classNames(styles.rustdeskConfig, styles.fullWidth)}>
						<label className={styles.checkboxLabel} htmlFor="editRustdeskEnabled">
							<input
								id="editRustdeskEnabled"
								type="checkbox"
								checked={rustDeskEnabled}
								onChange={(event) => setRustDeskEnabled(event.target.checked)}
							/>
							<span>作为 RustDesk 配置接口数据源</span>
						</label>
						<p className={styles.fieldHint}>
							开启后，公开的 /api/rustdesk 接口会返回此下载项的下载链接、版本号、ID 服务器和
							key，调用时无需授权。
						</p>
						{rustDeskEnabled && (
							<div className={styles.rustdeskGrid}>
								<div className={styles.formGroup}>
									<label htmlFor="editRustdeskIdServer">RustDesk ID 服务器</label>
									<input
										id="editRustdeskIdServer"
										value={rustDeskIdServer}
										onChange={(event) => setRustDeskIdServer(event.target.value)}
										placeholder="例如：rustdesk.example.com"
									/>
								</div>
								<div className={styles.formGroup}>
									<label htmlFor="editRustdeskKey">RustDesk key</label>
									<input
										id="editRustdeskKey"
										value={rustDeskKey}
										onChange={(event) => setRustDeskKey(event.target.value)}
										placeholder="请输入 RustDesk key"
									/>
								</div>
							</div>
						)}
					</div>
				</div>
				<div className={styles.modalFooter}>
					<button
						type="button"
						className={classNames(styles.btn, styles.btnSecondary)}
						onClick={handleClose}
					>
						取消
					</button>
					<button
						type="button"
						className={classNames(styles.btn, styles.btnPrimary)}
						onClick={() => void handleSave()}
						disabled={saving}
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
	);
}
