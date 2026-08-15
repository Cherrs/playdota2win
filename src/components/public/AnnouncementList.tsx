import { useEffect, useState } from 'react';
import { publicHomeDataLoader } from '$lib/public-home-data';
import type { Announcement } from '$lib/types';
import AnnouncementCard from './AnnouncementCard';
import styles from './AnnouncementList.module.css';

export default function AnnouncementList() {
	const [announcements, setAnnouncements] = useState<Announcement[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const controller = new AbortController();
		void (async () => {
			try {
				const result = await publicHomeDataLoader.loadAnnouncements({
					signal: controller.signal
				});
				if (!result.ok) throw new Error(`HTTP ${result.status}`);
				if (result.data.success && result.data.data) {
					setAnnouncements(result.data.data.items);
				}
			} catch (caught) {
				if (caught instanceof DOMException && caught.name === 'AbortError') return;
				console.error('Failed to load announcements:', caught);
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		})();

		return () => controller.abort();
	}, []);

	if (loading || announcements.length === 0) return null;

	return (
		<section className={styles['announcement-section']}>
			<div className={styles['section-header']}>
				<span className={styles['section-icon']} aria-hidden="true">
					📢
				</span>
				<h2 className={styles['section-title']}>公告</h2>
			</div>
			<div className={styles['announcement-list']}>
				{announcements.map((announcement) => (
					<AnnouncementCard key={announcement.id} announcement={announcement} />
				))}
			</div>
		</section>
	);
}
