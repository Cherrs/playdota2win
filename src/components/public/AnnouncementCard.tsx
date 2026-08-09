import { useMemo } from 'react';
import type { Announcement } from '$lib/types';
import { parseMarkdown } from '$lib/utils/markdown';
import styles from './AnnouncementCard.module.css';

interface AnnouncementCardProps {
	announcement: Announcement;
}

export default function AnnouncementCard({ announcement }: AnnouncementCardProps) {
	const htmlContent = useMemo(() => parseMarkdown(announcement.content), [announcement.content]);

	return (
		<div className={`${styles['announcement-card']} ${announcement.pinned ? styles.pinned : ''}`}>
			<div className={styles['card-header']}>
				{announcement.pinned ? (
					<span className={styles['pin-icon']} aria-hidden="true">
						📌
					</span>
				) : null}
				<h3 className={styles['card-title']}>{announcement.title}</h3>
			</div>
			<div className={styles['card-content']} dangerouslySetInnerHTML={{ __html: htmlContent }} />
		</div>
	);
}
