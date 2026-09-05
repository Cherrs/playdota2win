import { useMemo, useState } from 'react';
import type { Platform, PublicDownloadItem } from '$lib/types';
import { getGuideAction, parseGuideSteps } from '$lib/utils/markdown';
import styles from './GuidePanel.module.css';

interface GuidePanelProps {
	item: PublicDownloadItem | null;
	configGuide: string;
	message: string;
	id?: string;
	labelledBy?: string;
	hidden?: boolean;
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

export default function GuidePanel({
	item,
	configGuide,
	message,
	id,
	labelledBy,
	hidden = false
}: GuidePanelProps) {
	const [localOverride, setLocalOverride] = useState<{
		message: string;
		value: string;
	} | null>(null);
	const guideSteps = useMemo(() => parseGuideSteps(configGuide), [configGuide]);
	const shownMessage = localOverride?.message === message ? localOverride.value : message;

	const handleAction = async (action: { type: 'copy' | 'open'; value: string }) => {
		if (action.type === 'copy') {
			try {
				await navigator.clipboard.writeText(action.value);
				setLocalOverride({ message, value: `已复制：${action.value}` });
			} catch (caught) {
				console.error('Failed to copy text:', caught);
				setLocalOverride({ message, value: '复制失败，请手动复制。' });
			}
			return;
		}

		window.open(action.value, '_blank', 'noopener');
		setLocalOverride({ message, value: `已打开：${action.value}` });
	};

	return (
		<div
			className={`${styles['guide-panel']} ${hidden ? styles.inactive : ''}`}
			role="tabpanel"
			id={id}
			aria-labelledby={labelledBy}
			aria-hidden={hidden}
			inert={hidden}
			tabIndex={hidden ? -1 : 0}
		>
			<div className={styles['guide-header']}>
				<h3>配置指引</h3>
				{item ? <p>{item.title || `${getPlatformLabel(item.platform)} 版本`}</p> : null}
			</div>
			<p className={styles['guide-message']} aria-live="polite">
				{shownMessage}
			</p>
			{item && guideSteps.length > 0 ? (
				<ol className={styles['guide-steps']}>
					{guideSteps.map((step, index) => {
						const action = getGuideAction(step);
						return (
							<li key={`${index}-${step}`}>
								<div className={styles['guide-step-text']}>{step}</div>
								{action ? (
									<button
										className={styles['guide-action']}
										onClick={() => void handleAction(action)}
										type="button"
									>
										{action.type === 'copy' ? '点击复制' : '打开链接'}
									</button>
								) : null}
							</li>
						);
					})}
				</ol>
			) : (
				<div className={styles['guide-empty']}>
					<span aria-hidden="true">🌸</span>
					<p>暂无配置指引，请联系管理员补充～</p>
				</div>
			)}
		</div>
	);
}
