<script lang="ts">
	interface Props {
		value?: string;
		onselect: (color: string) => void;
	}

	let { value = '', onselect }: Props = $props();

	const presetColors = [
		{ name: '粉红', color: '#FF6B9D' },
		{ name: '紫色', color: '#6B4C9A' },
		{ name: '蓝色', color: '#667EEA' },
		{ name: '天蓝', color: '#4FC3F7' },
		{ name: '青色', color: '#26C6DA' },
		{ name: '绿色', color: '#66BB6A' },
		{ name: '黄绿', color: '#9CCC65' },
		{ name: '黄色', color: '#FFCA28' },
		{ name: '橙色', color: '#FFA726' },
		{ name: '深橙', color: '#FF7043' },
		{ name: '红色', color: '#EF5350' },
		{ name: '玫红', color: '#EC407A' }
	];

	let customColor = $state('#667EEA');
	let showCustomInput = $state(false);

	// 当 value 改变时更新 customColor
	$effect(() => {
		if (value) {
			customColor = value;
		}
	});

	function selectColor(color: string) {
		customColor = color;
		onselect(color);
	}

	function handleCustomColorChange(e: Event) {
		const input = e.target as HTMLInputElement;
		customColor = input.value;
		onselect(input.value);
	}
</script>

<div class="color-picker">
	<div class="preset-colors">
		{#each presetColors as preset (preset.color)}
			<button
				class="color-btn"
				class:selected={value === preset.color}
				style:background-color={preset.color}
				onclick={() => selectColor(preset.color)}
				type="button"
				title={preset.name}
			>
				{#if value === preset.color}
					<span class="check-mark">✓</span>
				{/if}
			</button>
		{/each}
	</div>

	<div class="custom-color-section">
		<button
			class="custom-color-toggle"
			onclick={() => (showCustomInput = !showCustomInput)}
			type="button"
		>
			{showCustomInput ? '隐藏' : '自定义颜色'}
		</button>

		{#if showCustomInput}
			<div class="custom-color-input">
				<input
					type="color"
					bind:value={customColor}
					oninput={handleCustomColorChange}
					class="color-input"
				/>
				<input
					type="text"
					bind:value={customColor}
					oninput={handleCustomColorChange}
					placeholder="#667EEA"
					class="hex-input"
					pattern="^#[0-9A-Fa-f]{6}$"
				/>
			</div>
		{/if}
	</div>

	{#if value}
		<div class="color-preview">
			<span class="preview-label">已选择：</span>
			<div class="preview-swatch" style:background-color={value}></div>
			<span class="preview-hex">{value.toUpperCase()}</span>
			<button class="clear-btn" onclick={() => selectColor('')} type="button"> × </button>
		</div>
	{/if}
</div>

<style>
	.color-picker {
		background: rgba(255, 255, 255, 0.9);
		border-radius: 16px;
		padding: 1rem;
		box-shadow: 0 8px 24px rgba(107, 76, 154, 0.1);
		border: 1px solid rgba(107, 76, 154, 0.08);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.preset-colors {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 0.5rem;
	}

	.color-btn {
		border: 3px solid transparent;
		width: 100%;
		aspect-ratio: 1;
		border-radius: 12px;
		cursor: pointer;
		transition: all 0.2s ease;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.color-btn:hover {
		transform: scale(1.15);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
	}

	.color-btn.selected {
		border-color: #2d1b4e;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
	}

	.check-mark {
		color: white;
		font-size: 1.2rem;
		font-weight: bold;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
	}

	.custom-color-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.custom-color-toggle {
		padding: 0.5rem 1rem;
		border: 1px solid rgba(107, 76, 154, 0.2);
		background: rgba(107, 76, 154, 0.05);
		color: #6b4c9a;
		border-radius: 8px;
		font-size: 0.85rem;
		font-family: inherit;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.custom-color-toggle:hover {
		background: rgba(107, 76, 154, 0.1);
		border-color: rgba(107, 76, 154, 0.3);
	}

	.custom-color-input {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.color-input {
		width: 50px;
		height: 50px;
		border: 2px solid rgba(107, 76, 154, 0.2);
		border-radius: 12px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.color-input:hover {
		border-color: rgba(107, 76, 154, 0.4);
	}

	.hex-input {
		flex: 1;
		padding: 0.6rem 1rem;
		border: 2px solid rgba(107, 76, 154, 0.2);
		border-radius: 12px;
		font-size: 0.95rem;
		font-family: monospace;
		transition: all 0.2s ease;
		outline: none;
	}

	.hex-input:focus {
		border-color: #6b4c9a;
		box-shadow: 0 0 0 3px rgba(107, 76, 154, 0.1);
	}

	.color-preview {
		display: flex;
		align-items: center;
		gap: 0.75rem;
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

	.preview-swatch {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		border: 2px solid rgba(255, 255, 255, 0.8);
	}

	.preview-hex {
		font-family: monospace;
		font-size: 0.9rem;
		color: #6b4c9a;
		font-weight: 600;
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
