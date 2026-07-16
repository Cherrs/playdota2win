<script lang="ts" generics="T extends { id: string; order: number }">
	import type { Snippet } from 'svelte';
	interface Props {
		items: T[];
		onreorder: (items: T[]) => void;
		children: Snippet<[T, number]>;
		disabled?: boolean;
	}

	let { items = $bindable(), onreorder, children, disabled = false }: Props = $props();

	let draggedIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	function handleDragStart(index: number) {
		if (disabled) return;
		draggedIndex = index;
	}

	function handleDragOver(e: DragEvent, index: number) {
		if (disabled) return;
		e.preventDefault();
		dragOverIndex = index;
	}

	function handleDragLeave() {
		dragOverIndex = null;
	}

	function handleDrop(e: DragEvent, dropIndex: number) {
		e.preventDefault();
		if (disabled) return;

		if (draggedIndex === null || draggedIndex === dropIndex) {
			draggedIndex = null;
			dragOverIndex = null;
			return;
		}

		const newItems = [...items];
		const [draggedItem] = newItems.splice(draggedIndex, 1);
		newItems.splice(dropIndex, 0, draggedItem);

		// 更新 order 字段
		const reorderedItems = newItems.map((item, index) => ({
			...item,
			order: index
		}));

		onreorder(reorderedItems as T[]);

		draggedIndex = null;
		dragOverIndex = null;
	}

	function handleDragEnd() {
		draggedIndex = null;
		dragOverIndex = null;
	}

	function moveItem(index: number, offset: -1 | 1): void {
		if (disabled) return;
		const nextIndex = index + offset;
		if (nextIndex < 0 || nextIndex >= items.length) return;
		const reordered = [...items];
		const [item] = reordered.splice(index, 1);
		reordered.splice(nextIndex, 0, item);
		onreorder(reordered.map((entry, order) => ({ ...entry, order })) as T[]);
	}
</script>

<div class="draggable-list" role="list" aria-label="可排序列表" aria-busy={disabled}>
	{#each items as item, index (item.id)}
		<div
			class="draggable-item"
			class:dragging={draggedIndex === index}
			class:drag-over={dragOverIndex === index}
			class:disabled
			draggable={!disabled}
			ondragstart={() => handleDragStart(index)}
			ondragover={(e) => handleDragOver(e, index)}
			ondragleave={handleDragLeave}
			ondrop={(e) => handleDrop(e, index)}
			ondragend={handleDragEnd}
			role="listitem"
		>
			<div class="drag-controls">
				<button
					class="order-btn"
					type="button"
					onclick={() => moveItem(index, -1)}
					disabled={disabled || index === 0}
					aria-label={`上移第 ${index + 1} 项`}
					title="上移">↑</button
				>
				<button
					class="order-btn"
					type="button"
					onclick={() => moveItem(index, 1)}
					disabled={disabled || index === items.length - 1}
					aria-label={`下移第 ${index + 1} 项`}
					title="下移">↓</button
				>
			</div>
			<div class="drag-handle" title="也可拖动排序" aria-hidden="true">
				<svg viewBox="0 0 20 20" fill="currentColor">
					<path
						d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z"
					></path>
				</svg>
			</div>
			<div class="item-content">
				{@render children(item, index)}
			</div>
		</div>
	{/each}
</div>

<style>
	.draggable-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.draggable-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		background: rgba(255, 255, 255, 0.8);
		backdrop-filter: blur(8px);
		border-radius: 14px;
		transition: all 0.3s ease;
		box-shadow: 0 4px 12px rgba(107, 76, 154, 0.06);
		cursor: move;
		border: 2px solid transparent;
	}

	.draggable-item:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 20px rgba(107, 76, 154, 0.1);
	}

	.draggable-item.dragging {
		opacity: 0.5;
		transform: scale(0.98);
	}

	.draggable-item.drag-over {
		border-color: #667eea;
		background: linear-gradient(135deg, rgba(255, 214, 232, 0.4) 0%, rgba(232, 214, 255, 0.4) 100%);
		box-shadow: 0 8px 24px rgba(102, 126, 234, 0.2);
	}

	.drag-handle {
		width: 20px;
		height: 20px;
		color: #b8a5d0;
		flex-shrink: 0;
		transition: color 0.2s ease;
	}

	.drag-controls {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		flex-shrink: 0;
	}

	.order-btn {
		width: 24px;
		height: 20px;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: rgba(107, 76, 154, 0.08);
		color: #6b4c9a;
		font: inherit;
		line-height: 1;
		cursor: pointer;
	}

	.order-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.order-btn:focus-visible {
		outline: 3px solid rgba(107, 76, 154, 0.25);
		outline-offset: 1px;
	}

	.draggable-item.disabled {
		cursor: wait;
		opacity: 0.75;
	}

	.draggable-item:hover .drag-handle {
		color: #6b4c9a;
	}

	.item-content {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	@media (max-width: 640px) {
		.draggable-item {
			align-items: flex-start;
			padding: 0.9rem;
		}

		.drag-handle {
			display: none;
		}

		.item-content {
			align-items: flex-start;
			flex-wrap: wrap;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.draggable-item,
		.drag-handle {
			transition: none;
		}

		.draggable-item:hover,
		.draggable-item.dragging {
			transform: none;
		}
	}
</style>
