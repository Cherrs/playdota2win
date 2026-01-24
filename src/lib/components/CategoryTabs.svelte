<script lang="ts">
	import type { Category, DownloadItem } from '$lib/types';

	interface Props {
		categories: Category[];
		downloads: DownloadItem[];
		selectedCategoryId: string | null;
		onSelect: (categoryId: string | null) => void;
	}

	let { categories, downloads, selectedCategoryId, onSelect }: Props = $props();

	function getEnabledCount(categoryId?: string): number {
		if (!categoryId) {
			return downloads.filter((d) => d.enabled).length;
		}
		return downloads.filter((d) => d.enabled && d.categoryId === categoryId).length;
	}
</script>

{#if categories.length > 0}
	<div class="category-tabs">
		<button
			class="category-tab"
			class:active={selectedCategoryId === null}
			onclick={() => onSelect(null)}
			type="button"
		>
			<span class="tab-icon">🌟</span>
			<span class="tab-label">全部</span>
			<span class="tab-count">{getEnabledCount()}</span>
		</button>
		{#each categories as category (category.id)}
			{@const count = getEnabledCount(category.id)}
			<button
				class="category-tab"
				class:active={selectedCategoryId === category.id}
				onclick={() => onSelect(category.id)}
				type="button"
				style:--category-color={category.color || '#6B4C9A'}
			>
				{#if category.icon}
					<span class="tab-icon">{category.icon}</span>
				{/if}
				<span class="tab-label">{category.name}</span>
				{#if count > 0}
					<span class="tab-count">{count}</span>
				{/if}
			</button>
		{/each}
	</div>
{/if}

<style>
	.category-tabs {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		justify-content: center;
		width: 100%;
		max-width: 720px;
		padding: 0.5rem;
	}

	.category-tab {
		--category-color: #6b4c9a;
		border: none;
		background: rgba(255, 255, 255, 0.75);
		backdrop-filter: blur(10px);
		color: #8b7ba8;
		font-weight: 600;
		font-family: inherit;
		font-size: 0.95rem;
		padding: 0.65rem 1.2rem;
		border-radius: 50px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease,
			background 0.2s ease,
			color 0.2s ease;
		box-shadow: 0 4px 12px rgba(107, 76, 154, 0.08);
		position: relative;
	}

	.category-tab:hover {
		transform: translateY(-2px);
		box-shadow: 0 6px 18px rgba(107, 76, 154, 0.15);
		color: var(--category-color);
		background: rgba(255, 255, 255, 0.9);
	}

	.category-tab.active {
		background: linear-gradient(135deg, #ffd6e8 0%, #e8d6ff 100%);
		color: var(--category-color);
		box-shadow: 0 6px 18px color-mix(in srgb, var(--category-color) 25%, transparent);
	}

	.category-tab.active::before {
		content: '';
		position: absolute;
		bottom: 0;
		left: 50%;
		transform: translateX(-50%);
		width: 60%;
		height: 3px;
		background: var(--category-color);
		border-radius: 2px 2px 0 0;
	}

	.category-tab .tab-icon {
		font-size: 1.1rem;
		line-height: 1;
	}

	.category-tab .tab-label {
		line-height: 1;
	}

	.category-tab .tab-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 0.35rem;
		background: rgba(107, 76, 154, 0.15);
		color: var(--category-color);
		border-radius: 9px;
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1;
	}

	.category-tab.active .tab-count {
		background: var(--category-color);
		color: white;
	}
</style>
