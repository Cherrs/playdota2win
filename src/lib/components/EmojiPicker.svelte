<script lang="ts">
	interface Props {
		value?: string;
		onselect: (emoji: string) => void;
	}

	let { value = '', onselect }: Props = $props();

	const emojiCategories = [
		{
			name: '常用',
			emojis: ['🔧', '📚', '🎮', '🎨', '💼', '📦', '🌟', '✨', '💎', '🎯', '🚀', '⚡']
		},
		{
			name: '工具',
			emojis: ['🔧', '🛠️', '⚙️', '🔨', '🪛', '⚗️', '🧰', '📐', '📏', '🔬', '🔭', '🧲']
		},
		{
			name: '文档',
			emojis: ['📄', '📃', '📑', '📊', '📈', '📉', '📚', '📖', '📝', '📋', '📌', '📍']
		},
		{
			name: '游戏',
			emojis: ['🎮', '🕹️', '🎯', '🎲', '🃏', '🎰', '🎳', '🎪', '🎭', '🎨', '🖌️', '🖍️']
		},
		{
			name: '符号',
			emojis: ['⭐', '🌟', '✨', '💫', '🔥', '💧', '⚡', '💥', '💢', '💨', '💦', '🌈']
		},
		{
			name: '物品',
			emojis: ['💼', '👜', '🎒', '💰', '💳', '💎', '🔮', '🎁', '🎀', '🎊', '🎉', '🎈']
		},
		{
			name: '其他',
			emojis: ['🌸', '🌺', '🌻', '🌹', '🌷', '🌼', '🏵️', '🌿', '🍀', '🍃', '🎋', '🎍']
		}
	];

	let selectedCategory = $state(0);
	let hoveredEmoji = $state<string | null>(null);

	function selectEmoji(emoji: string) {
		onselect(emoji);
	}
</script>

<div class="emoji-picker">
	<div class="emoji-tabs">
		{#each emojiCategories as category, index (category.name)}
			<button
				class="emoji-tab"
				class:active={selectedCategory === index}
				onclick={() => (selectedCategory = index)}
				type="button"
			>
				{category.name}
			</button>
		{/each}
	</div>

	<div class="emoji-grid">
		{#each emojiCategories[selectedCategory].emojis as emoji (emoji)}
			<button
				class="emoji-btn"
				class:selected={value === emoji}
				class:hovered={hoveredEmoji === emoji}
				onclick={() => selectEmoji(emoji)}
				onmouseenter={() => (hoveredEmoji = emoji)}
				onmouseleave={() => (hoveredEmoji = null)}
				type="button"
				title={emoji}
			>
				{emoji}
			</button>
		{/each}
	</div>

	{#if value}
		<div class="emoji-preview">
			<span class="preview-label">已选择：</span>
			<span class="preview-emoji">{value}</span>
			<button class="clear-btn" onclick={() => selectEmoji('')} type="button"> × </button>
		</div>
	{/if}
</div>

<style>
	.emoji-picker {
		background: rgba(255, 255, 255, 0.9);
		border-radius: 16px;
		padding: 1rem;
		box-shadow: 0 8px 24px rgba(107, 76, 154, 0.1);
		border: 1px solid rgba(107, 76, 154, 0.08);
	}

	.emoji-tabs {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.emoji-tab {
		padding: 0.4rem 0.8rem;
		border: none;
		background: rgba(107, 76, 154, 0.08);
		color: #8b7ba8;
		border-radius: 8px;
		font-size: 0.85rem;
		font-family: inherit;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.emoji-tab:hover {
		background: rgba(107, 76, 154, 0.15);
		color: #6b4c9a;
	}

	.emoji-tab.active {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		box-shadow: 0 4px 12px rgba(102, 126, 234, 0.25);
	}

	.emoji-grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 0.5rem;
		margin-bottom: 1rem;
		max-height: 240px;
		overflow-y: auto;
		padding: 0.25rem;
	}

	.emoji-grid::-webkit-scrollbar {
		width: 6px;
	}

	.emoji-grid::-webkit-scrollbar-thumb {
		background-color: #b8a5d0;
		border-radius: 3px;
	}

	.emoji-btn {
		border: 2px solid transparent;
		background: rgba(255, 255, 255, 0.8);
		font-size: 1.8rem;
		padding: 0.5rem;
		border-radius: 12px;
		cursor: pointer;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
	}

	.emoji-btn:hover,
	.emoji-btn.hovered {
		transform: scale(1.15);
		background: rgba(255, 240, 247, 0.9);
		border-color: rgba(107, 76, 154, 0.2);
		box-shadow: 0 4px 12px rgba(107, 76, 154, 0.15);
	}

	.emoji-btn.selected {
		background: linear-gradient(135deg, #ffd6e8 0%, #e8d6ff 100%);
		border-color: #6b4c9a;
		box-shadow: 0 6px 16px rgba(107, 76, 154, 0.25);
	}

	.emoji-preview {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: rgba(107, 76, 154, 0.05);
		border-radius: 12px;
		border: 1px dashed rgba(107, 76, 154, 0.2);
	}

	.preview-label {
		font-size: 0.85rem;
		color: #8b7ba8;
		font-weight: 500;
	}

	.preview-emoji {
		font-size: 1.8rem;
	}

	.clear-btn {
		margin-left: auto;
		border: none;
		background: rgba(107, 76, 154, 0.1);
		color: #6b4c9a;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		cursor: pointer;
		font-size: 1.2rem;
		line-height: 1;
		transition: all 0.2s ease;
	}

	.clear-btn:hover {
		background: rgba(107, 76, 154, 0.2);
		transform: scale(1.1);
	}
</style>
