import { useEffect, useRef, useState, type ChangeEvent } from 'react';

import { MAX_ADMIN_R2_UPLOAD_BYTES, formatMiB } from '$lib/upload-limits';
import type { ApiResponse, Category, DownloadItem, Platform, StorageType } from '$lib/types';
import { parseDownloadFileInfo } from '$lib/utils/parseFilename';
import { normalizePublicHttpsUrl } from '$lib/utils/public-url';

import styles from './DownloadForm.module.css';
import { classNames } from './classNames';

export interface DownloadFormProps {
	categories: Category[];
	onAdd: (item: DownloadItem) => void;
}

export default function DownloadForm({ categories, onAdd }: DownloadFormProps) {
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [platform, setPlatform] = useState<Platform>('windows');
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [configGuide, setConfigGuide] = useState('');
	const [filename, setFilename] = useState('');
	const [version, setVersion] = useState('v1.0.0');
	const [size, setSize] = useState('');
	const [storageType, setStorageType] = useState<StorageType>('link');
	const [url, setUrl] = useState('');
	const [file, setFile] = useState<File | null>(null);
	const [s3PresignedUrl, setS3PresignedUrl] = useState('');
	const [s3PublicUrl, setS3PublicUrl] = useState('');
	const [categoryId, setCategoryId] = useState<string | undefined>();
	const [rustDeskEnabled, setRustDeskEnabled] = useState(false);
	const [rustDeskIdServer, setRustDeskIdServer] = useState('');
	const [rustDeskKey, setRustDeskKey] = useState('');
	const fileInputRef = useRef<HTMLInputElement>(null);
	const submitControllerRef = useRef<AbortController | null>(null);
	const submitRunIdRef = useRef(0);

	useEffect(
		() => () => {
			submitRunIdRef.current += 1;
			submitControllerRef.current?.abort();
		},
		[]
	);

	function applyParsedFileInfo(input: string, updateFilename: boolean) {
		const parsed = parseDownloadFileInfo(input);
		if (updateFilename && parsed.filename) setFilename(parsed.filename);
		if (parsed.version) setVersion(parsed.version);
		if (parsed.platform) setPlatform(parsed.platform);
	}

	function clearFormFields() {
		setPlatform('windows');
		setTitle('');
		setDescription('');
		setConfigGuide('');
		setFilename('');
		setVersion('v1.0.0');
		setSize('');
		setStorageType('link');
		setUrl('');
		setFile(null);
		setS3PresignedUrl('');
		setS3PublicUrl('');
		setCategoryId(undefined);
		setRustDeskEnabled(false);
		setRustDeskIdServer('');
		setRustDeskKey('');
		if (fileInputRef.current) fileInputRef.current.value = '';
	}

	function resetForm() {
		submitRunIdRef.current += 1;
		submitControllerRef.current?.abort();
		submitControllerRef.current = null;
		setSaving(false);
		clearFormFields();
		setError('');
		setSuccess('');
	}

	function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
		const nextFile = event.target.files?.[0];
		if (!nextFile) return;
		setFile(nextFile);
		if (!filename) setFilename(nextFile.name);
		applyParsedFileInfo(nextFile.name, false);
		setSize(`${(nextFile.size / (1024 * 1024)).toFixed(1)}MB`);
	}

	async function handleAdd() {
		if (saving || submitControllerRef.current) return;
		if (!version || !size) {
			setError('请填写版本和大小');
			return;
		}
		if (
			version.length > 128 ||
			size.length > 128 ||
			title.length > 200 ||
			description.length > 4000 ||
			configGuide.length > 20_000 ||
			filename.length > 512
		) {
			setError('表单字段过长，请缩短后重试');
			return;
		}
		if (rustDeskEnabled && (!rustDeskIdServer.trim() || !rustDeskKey.trim())) {
			setError('请填写 RustDesk ID 服务器和 key');
			return;
		}
		if (rustDeskIdServer.length > 255 || rustDeskKey.length > 4096) {
			setError('RustDesk 配置字段过长');
			return;
		}

		const submitted = {
			platform,
			storageType,
			file,
			filename,
			url,
			title,
			description,
			configGuide,
			version,
			size,
			categoryId,
			rustDeskEnabled,
			rustDeskIdServer,
			rustDeskKey,
			s3PresignedUrl,
			s3PublicUrl
		};
		const runId = ++submitRunIdRef.current;
		const controller = new AbortController();
		submitControllerRef.current = controller;
		setSaving(true);
		setError('');
		setSuccess('');

		try {
			let downloadUrl: string;
			if (submitted.storageType === 'link') {
				if (!submitted.url) {
					setError('请填写下载链接');
					return;
				}
				downloadUrl = submitted.url;
			} else {
				if (!submitted.file) {
					setError('请选择文件');
					return;
				}
				if (submitted.file.size <= 0) {
					setError('文件不能为空');
					return;
				}
				const uploadFilename = submitted.filename.trim() || submitted.file.name;
				if (submitted.storageType === 'r2') {
					if (submitted.file.size > MAX_ADMIN_R2_UPLOAD_BYTES) {
						setError(`R2 上传不能超过 ${formatMiB(MAX_ADMIN_R2_UPLOAD_BYTES)}`);
						return;
					}
					const params = new URLSearchParams({
						platform: submitted.platform,
						filename: uploadFilename
					});
					const uploadResponse = await fetch(`/api/admin/uploads?${params}`, {
						method: 'PUT',
						headers: {
							'Content-Type': submitted.file.type || 'application/octet-stream'
						},
						body: submitted.file,
						signal: controller.signal
					});
					const uploadData = (await uploadResponse.json()) as ApiResponse<{ url: string }>;
					if (!uploadResponse.ok || !uploadData.success || !uploadData.data?.url) {
						setError(uploadData.error || 'R2 上传失败');
						return;
					}
					downloadUrl = uploadData.data.url;
				} else {
					if (!submitted.s3PresignedUrl || !submitted.s3PublicUrl) {
						setError('请填写预签名上传 URL 和公开下载 URL');
						return;
					}
					let presignedUrl: string;
					let publicUrl: string;
					try {
						presignedUrl = normalizePublicHttpsUrl(submitted.s3PresignedUrl);
						publicUrl = normalizePublicHttpsUrl(submitted.s3PublicUrl);
					} catch (validationError) {
						setError(validationError instanceof Error ? validationError.message : 'S3 URL 无效');
						return;
					}
					const uploadResponse = await fetch(presignedUrl, {
						method: 'PUT',
						headers: {
							'Content-Type': submitted.file.type || 'application/octet-stream'
						},
						body: submitted.file,
						signal: controller.signal
					});
					if (!uploadResponse.ok) {
						setError(`S3 上传失败（HTTP ${uploadResponse.status}）`);
						return;
					}
					downloadUrl = publicUrl;
				}
			}

			const metadata = {
				platform: submitted.platform,
				title: submitted.title || undefined,
				description: submitted.description || undefined,
				configGuide: submitted.configGuide || undefined,
				filename: submitted.filename || submitted.file?.name || undefined,
				version: submitted.version,
				size: submitted.size,
				storageType: submitted.storageType,
				url: downloadUrl,
				categoryId: submitted.categoryId,
				rustdeskConfig: {
					enabled: submitted.rustDeskEnabled,
					idServer: submitted.rustDeskIdServer.trim(),
					key: submitted.rustDeskKey.trim()
				}
			};
			const response = await fetch('/api/admin', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(metadata),
				signal: controller.signal
			});
			const data = (await response.json()) as ApiResponse<DownloadItem>;
			if (runId !== submitRunIdRef.current || controller.signal.aborted) return;
			if (response.ok && data.success && data.data) {
				onAdd(data.data);
				clearFormFields();
				setSuccess(
					submitted.storageType === 'link' && data.data.r2Backup?.status === 'failed'
						? '添加成功，但首次 R2 备份失败，请稍后重试同步。'
						: '添加成功！'
				);
			} else {
				setError(data.error || '添加失败');
			}
		} catch (caught) {
			if (caught instanceof DOMException && caught.name === 'AbortError') return;
			if (runId === submitRunIdRef.current) setError('网络错误');
		} finally {
			if (runId === submitRunIdRef.current && submitControllerRef.current === controller) {
				submitControllerRef.current = null;
				setSaving(false);
			}
		}
	}

	return (
		<section className={styles.formSection}>
			<h2>✨ 添加下载项</h2>
			{error && (
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
			)}
			{success && (
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
			)}

			<div className={styles.formGrid}>
				<div className={styles.formGroup}>
					<label htmlFor="platform">平台</label>
					<select
						id="platform"
						value={platform}
						onChange={(event) => setPlatform(event.target.value as Platform)}
					>
						<option value="windows">🪟 Windows</option>
						<option value="macos">🍎 macOS</option>
						<option value="linux">🐧 Linux</option>
					</select>
				</div>
				<div className={styles.formGroup}>
					<label htmlFor="version">版本号</label>
					<input
						id="version"
						value={version}
						onChange={(event) => setVersion(event.target.value)}
						placeholder="v1.0.0"
					/>
				</div>
				<div className={styles.formGroup}>
					<label htmlFor="category">分类</label>
					<select
						id="category"
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
					<label htmlFor="title">标题</label>
					<input
						id="title"
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder="例如：PlayDota2Win Windows 稳定版"
					/>
				</div>
				<div className={classNames(styles.formGroup, styles.fullWidth)}>
					<label htmlFor="description">描述</label>
					<textarea
						id="description"
						value={description}
						onChange={(event) => setDescription(event.target.value)}
						placeholder="简短描述这个版本的特性或用途"
					/>
				</div>
				<div className={classNames(styles.formGroup, styles.fullWidth)}>
					<label htmlFor="configGuide">配置指引</label>
					<textarea
						id="configGuide"
						value={configGuide}
						onChange={(event) => setConfigGuide(event.target.value)}
						placeholder="每行一条步骤，例如：复制 验证码123 或 打开 mumble://xxx"
					/>
					<p className={styles.fieldHint}>支持动作：复制 xxx / 打开 mumble://xxx 或 https://</p>
				</div>
				<div className={styles.formGroup}>
					<label htmlFor="filename">文件名</label>
					<input
						id="filename"
						value={filename}
						onChange={(event) => {
							setFilename(event.target.value);
							applyParsedFileInfo(event.target.value, false);
						}}
						placeholder="例如：PlayDota2Win.exe"
					/>
				</div>
				<div className={styles.formGroup}>
					<label htmlFor="size">文件大小</label>
					<input
						id="size"
						value={size}
						onChange={(event) => setSize(event.target.value)}
						placeholder="45MB"
					/>
				</div>
				<div className={styles.formGroup}>
					<label htmlFor="storageType">存储方式</label>
					<select
						id="storageType"
						value={storageType}
						onChange={(event) => setStorageType(event.target.value as StorageType)}
					>
						<option value="link">🔗 外部链接</option>
						<option value="r2">☁️ Cloudflare R2</option>
						<option value="s3">🗄️ 自定义 S3</option>
					</select>
				</div>
			</div>

			{storageType === 'link' && (
				<div className={classNames(styles.formGroup, styles.fullWidth)}>
					<label htmlFor="url">下载链接</label>
					<input
						id="url"
						type="url"
						value={url}
						onChange={(event) => {
							setUrl(event.target.value);
							applyParsedFileInfo(event.target.value, true);
						}}
						placeholder="https://example.com/download.exe"
					/>
					<p className={styles.fieldHint}>
						添加时会同步备份到 Cloudflare R2；原链接不可用时会自动使用备份下载。
					</p>
				</div>
			)}

			{(storageType === 'r2' || storageType === 's3') && (
				<div className={classNames(styles.formGroup, styles.fullWidth)}>
					<label htmlFor="file">选择文件</label>
					<input id="file" type="file" onChange={handleFileSelect} ref={fileInputRef} />
					{file && <span className={styles.fileInfo}>📄 {file.name}</span>}
					{storageType === 'r2' && (
						<p className={styles.fieldHint}>
							文件会以原始请求体流式上传，最大 {formatMiB(MAX_ADMIN_R2_UPLOAD_BYTES)}。
						</p>
					)}
				</div>
			)}

			{storageType === 's3' && (
				<div className={styles.s3Config}>
					<h3>🗄️ S3 配置</h3>
					<div className={styles.formGrid}>
						<div className={styles.formGroup}>
							<label htmlFor="s3PresignedUrl">预签名上传 URL</label>
							<input
								id="s3PresignedUrl"
								type="url"
								value={s3PresignedUrl}
								onChange={(event) => setS3PresignedUrl(event.target.value)}
								placeholder="https://...presigned-url"
							/>
						</div>
						<div className={styles.formGroup}>
							<label htmlFor="s3PublicUrl">公开下载 URL</label>
							<input
								id="s3PublicUrl"
								type="url"
								value={s3PublicUrl}
								onChange={(event) => setS3PublicUrl(event.target.value)}
								placeholder="https://cdn.example.com/file"
							/>
						</div>
					</div>
					<p className={styles.fieldHint}>
						文件由浏览器直接 PUT 到预签名 URL；S3 服务必须允许本站来源的 PUT、Content-Type
						跨域请求。
					</p>
				</div>
			)}

			<div className={styles.rustdeskConfig}>
				<label className={styles.checkboxLabel} htmlFor="rustdeskEnabled">
					<input
						id="rustdeskEnabled"
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
					<div className={classNames(styles.formGrid, styles.rustdeskGrid)}>
						<div className={styles.formGroup}>
							<label htmlFor="rustdeskIdServer">RustDesk ID 服务器</label>
							<input
								id="rustdeskIdServer"
								value={rustDeskIdServer}
								onChange={(event) => setRustDeskIdServer(event.target.value)}
								placeholder="例如：rustdesk.example.com"
							/>
						</div>
						<div className={styles.formGroup}>
							<label htmlFor="rustdeskKey">RustDesk key</label>
							<input
								id="rustdeskKey"
								value={rustDeskKey}
								onChange={(event) => setRustDeskKey(event.target.value)}
								placeholder="请输入 RustDesk key"
							/>
						</div>
					</div>
				)}
			</div>

			<div className={styles.formActions}>
				<button
					className={classNames(styles.btn, styles.btnPrimary)}
					type="button"
					onClick={() => void handleAdd()}
					disabled={saving}
				>
					{saving ? (
						<>
							<span className={styles.spinner} /> 保存中...
						</>
					) : (
						'💾 添加下载项'
					)}
				</button>
				<button
					className={classNames(styles.btn, styles.btnSecondary)}
					type="button"
					onClick={resetForm}
				>
					{saving ? '取消并重置' : '🔄 重置'}
				</button>
			</div>
		</section>
	);
}
