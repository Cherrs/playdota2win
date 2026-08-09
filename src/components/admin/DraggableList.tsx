import { type DragEvent, type ReactNode, useState } from 'react';
import { classNames } from './classNames';
import styles from './DraggableList.module.css';

interface OrderedItem {
	id: string;
	order: number;
}

interface DraggableListProps<T extends OrderedItem> {
	items: T[];
	onReorder: (items: T[]) => void;
	renderItem: (item: T, index: number) => ReactNode;
	disabled?: boolean;
}

export default function DraggableList<T extends OrderedItem>({
	items,
	onReorder,
	renderItem,
	disabled = false
}: DraggableListProps<T>) {
	const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

	function finishDrag(): void {
		setDraggedIndex(null);
		setDragOverIndex(null);
	}

	function handleDrop(event: DragEvent<HTMLDivElement>, dropIndex: number): void {
		event.preventDefault();
		if (disabled || draggedIndex === null || draggedIndex === dropIndex) {
			finishDrag();
			return;
		}

		const reordered = [...items];
		const [draggedItem] = reordered.splice(draggedIndex, 1);
		reordered.splice(dropIndex, 0, draggedItem);
		onReorder(reordered.map((item, order) => ({ ...item, order })));
		finishDrag();
	}

	function moveItem(index: number, offset: -1 | 1): void {
		if (disabled) return;
		const nextIndex = index + offset;
		if (nextIndex < 0 || nextIndex >= items.length) return;
		const reordered = [...items];
		const [item] = reordered.splice(index, 1);
		reordered.splice(nextIndex, 0, item);
		onReorder(reordered.map((entry, order) => ({ ...entry, order })));
	}

	return (
		<div className={styles.list} role="list" aria-label="可排序列表" aria-busy={disabled}>
			{items.map((item, index) => (
				<div
					key={item.id}
					className={classNames(
						styles.item,
						draggedIndex === index && styles.dragging,
						dragOverIndex === index && styles.dragOver,
						disabled && styles.disabled
					)}
					draggable={!disabled}
					role="listitem"
					onDragStart={() => !disabled && setDraggedIndex(index)}
					onDragOver={(event) => {
						if (disabled) return;
						event.preventDefault();
						setDragOverIndex(index);
					}}
					onDragLeave={() => setDragOverIndex(null)}
					onDrop={(event) => handleDrop(event, index)}
					onDragEnd={finishDrag}
				>
					<div className={styles.controls}>
						<button
							type="button"
							className={styles.orderButton}
							disabled={disabled || index === 0}
							aria-label={`上移第 ${index + 1} 项`}
							title="上移"
							onClick={() => moveItem(index, -1)}
						>
							↑
						</button>
						<button
							type="button"
							className={styles.orderButton}
							disabled={disabled || index === items.length - 1}
							aria-label={`下移第 ${index + 1} 项`}
							title="下移"
							onClick={() => moveItem(index, 1)}
						>
							↓
						</button>
					</div>
					<div className={styles.handle} title="也可拖动排序" aria-hidden="true">
						<svg viewBox="0 0 20 20" fill="currentColor">
							<path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
						</svg>
					</div>
					<div className={styles.content}>{renderItem(item, index)}</div>
				</div>
			))}
		</div>
	);
}
