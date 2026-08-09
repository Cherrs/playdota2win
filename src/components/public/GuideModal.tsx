import { useId, useMemo, useRef } from 'react';
import type { Platform, PublicDownloadItem } from '$lib/types';
import { parseMarkdown } from '$lib/utils/markdown';
import { usePublicDialog } from '../../hooks/public-dialog';
import styles from './GuideModal.module.css';

interface GuideModalProps {
	item: PublicDownloadItem;
	configGuide: string;
	onClose: () => void;
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

export default function GuideModal({ item, configGuide, onClose }: GuideModalProps) {
	const titleId = useId();
	const subtitleId = useId();
	const dialogRef = useRef<HTMLDivElement>(null);
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const parsedGuide = useMemo(() => (configGuide ? parseMarkdown(configGuide) : ''), [configGuide]);
	const handleDialogKeyDown = usePublicDialog({
		dialogRef,
		initialFocusRef: closeButtonRef,
		onClose
	});

	return (
		<div
			className={styles['modal-backdrop']}
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			aria-describedby={subtitleId}
		>
			<div className={styles['modal-scrim']} onClick={onClose} aria-hidden="true" />
			<div
				className={`${styles['modal-card']} ${styles['modal-lg']}`}
				ref={dialogRef}
				tabIndex={-1}
				onKeyDown={handleDialogKeyDown}
			>
				<div className={styles['modal-header']}>
					<h3 id={titleId}>📖 配置指引</h3>
					<button
						className={styles['modal-close']}
						onClick={onClose}
						type="button"
						ref={closeButtonRef}
						aria-label="关闭配置指引"
					>
						×
					</button>
				</div>
				<p className={styles['modal-subtitle']} id={subtitleId}>
					{item.title || `${getPlatformLabel(item.platform)} 版本`}
				</p>
				<div className={styles['guide-content-scroll']}>
					{configGuide ? (
						<div
							className={styles['markdown-body']}
							dangerouslySetInnerHTML={{ __html: parsedGuide }}
						/>
					) : (
						<div className={styles['guide-empty']}>
							<span aria-hidden="true">🌸</span>
							<p>暂无配置指引，请联系管理员补充～</p>
						</div>
					)}
				</div>
				<div className={styles['modal-footer']}>
					<button className={styles['modal-btn']} onClick={onClose} type="button">
						我学会啦！
					</button>
				</div>
			</div>
		</div>
	);
}
