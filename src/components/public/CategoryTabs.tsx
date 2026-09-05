import type { CSSProperties } from 'react';
import type { Category, PublicDownloadItem } from '$lib/types';
import styles from './CategoryTabs.module.css';

interface CategoryTabsProps {
	categories: Category[];
	downloads: PublicDownloadItem[];
	selectedCategoryId: string | null;
	onSelect: (categoryId: string | null) => void;
}

function GridIcon() {
	return (
		<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
			<rect x="2.5" y="2.5" width="6" height="6" rx="1.2" />
			<rect x="11.5" y="2.5" width="6" height="6" rx="1.2" />
			<rect x="2.5" y="11.5" width="6" height="6" rx="1.2" />
			<rect x="11.5" y="11.5" width="6" height="6" rx="1.2" />
		</svg>
	);
}

export default function CategoryTabs({
	categories,
	downloads,
	selectedCategoryId,
	onSelect
}: CategoryTabsProps) {
	if (categories.length === 0) return null;

	const getEnabledCount = (categoryId?: string) =>
		downloads.filter(
			(download) => download.enabled && (!categoryId || download.categoryId === categoryId)
		).length;

	return (
		<div className={styles['category-tabs']}>
			<button
				className={`${styles['category-tab']} ${selectedCategoryId === null ? styles.active : ''}`}
				onClick={() => onSelect(null)}
				type="button"
				aria-pressed={selectedCategoryId === null}
			>
				<span className={styles['tab-icon']}>
					<GridIcon />
				</span>
				<span className={styles['tab-label']}>全部</span>
				<span className={styles['tab-count']}>{getEnabledCount()}</span>
			</button>
			{categories.map((category) => {
				const count = getEnabledCount(category.id);
				const categoryStyle = {
					'--category-color': category.color || '#6B4C9A'
				} as CSSProperties;
				return (
					<button
						key={category.id}
						className={`${styles['category-tab']} ${selectedCategoryId === category.id ? styles.active : ''}`}
						onClick={() => onSelect(category.id)}
						type="button"
						style={categoryStyle}
						aria-pressed={selectedCategoryId === category.id}
					>
						<span className={styles['tab-icon']} aria-hidden="true">
							{category.icon || category.name.slice(0, 1)}
						</span>
						<span className={styles['tab-label']}>{category.name}</span>
						{count > 0 ? <span className={styles['tab-count']}>{count}</span> : null}
					</button>
				);
			})}
		</div>
	);
}
