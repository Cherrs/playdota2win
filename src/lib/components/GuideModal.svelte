<script lang="ts">
	import type { DownloadItem, Platform } from '$lib/types';
	import { parseMarkdown } from '$lib/utils/markdown';
	import { trapFocus, focusFirstElement } from '$lib/utils/a11y';

	interface Props {
		item: DownloadItem;
		onClose: () => void;
	}

	let { item, onClose }: Props = $props();
	let parsedGuide = $derived(item.configGuide ? parseMarkdown(item.configGuide) : '');
	let dialogRef = $state<HTMLDivElement | null>(null);
	let closeButtonRef = $state<HTMLButtonElement | null>(null);
	let lastFocusedElement: HTMLElement | null = null;
	const titleId = crypto.randomUUID();

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

	$effect(() => {
		lastFocusedElement =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		void focusFirstElement(dialogRef, closeButtonRef);
		const handleKeydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				onClose();
			}
		};
		document.addEventListener('keydown', handleKeydown);
		return () => {
			document.removeEventListener('keydown', handleKeydown);
			lastFocusedElement?.focus();
		};
	});
</script>

<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={titleId}>
	<button type="button" class="modal-scrim" onclick={onClose} aria-label="关闭"></button>
	<div class="modal-card modal-lg" bind:this={dialogRef} use:trapFocus tabindex="-1">
		<div class="modal-header">
			<h3 id={titleId}>📖 配置指引</h3>
			<button class="modal-close" onclick={onClose} type="button" bind:this={closeButtonRef}>
				×
			</button>
		</div>
		<p class="modal-subtitle">
			{item.title || `${getPlatformLabel(item.platform)} 版本`}
		</p>
		<div class="guide-content-scroll">
			{#if item.configGuide}
				<div class="markdown-body">
					{@html parsedGuide}
				</div>
			{:else}
				<div class="guide-empty">
					<span>🌸</span>
					<p>暂无配置指引，请联系管理员补充～</p>
				</div>
			{/if}
		</div>
		<div class="modal-footer">
			<button class="modal-btn" onclick={onClose} type="button"> 我学会啦！ </button>
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		background: rgba(17, 8, 28, 0.35);
		backdrop-filter: blur(6px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10;
		padding: 1.5rem;
	}

	.modal-scrim {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		border: none;
		background: transparent;
		cursor: pointer;
	}

	.modal-card {
		width: 100%;
		max-width: 420px;
		background: rgba(255, 255, 255, 0.95);
		border-radius: 20px;
		padding: 1.5rem;
		box-shadow: 0 20px 50px rgba(107, 76, 154, 0.25);
		display: flex;
		flex-direction: column;
		gap: 1rem;
		position: relative;
		z-index: 1;
	}

	.modal-lg {
		max-width: 600px;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.modal-header h3 {
		margin: 0;
		font-family: 'Fredoka', sans-serif;
		color: #6b4c9a;
		font-size: 1.2rem;
	}

	.modal-close {
		border: none;
		background: rgba(107, 76, 154, 0.1);
		color: #6b4c9a;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		cursor: pointer;
		font-size: 1.2rem;
		transition: all 0.3s ease;
	}

	.modal-close:hover {
		background: rgba(107, 76, 154, 0.2);
		transform: translateY(-1px);
	}

	.modal-subtitle {
		margin: 0;
		color: #8b7ba8;
		font-size: 0.95rem;
	}

	.guide-content-scroll {
		max-height: 60vh;
		overflow-y: auto;
		padding-right: 0.5rem;
		scrollbar-width: thin;
		scrollbar-color: #b8a5d0 transparent;
	}

	.guide-content-scroll::-webkit-scrollbar {
		width: 6px;
	}

	.guide-content-scroll::-webkit-scrollbar-thumb {
		background-color: #b8a5d0;
		border-radius: 3px;
	}

	.markdown-body {
		color: #4d3a73;
		line-height: 1.6;
		font-size: 0.95rem;
	}

	.markdown-body :global(h3),
	.markdown-body :global(h4) {
		color: #6b4c9a;
		margin: 1.2rem 0 0.6rem;
		font-family: 'Fredoka', sans-serif;
	}

	.markdown-body :global(h3) {
		font-size: 1.2rem;
		border-bottom: 2px solid rgba(107, 76, 154, 0.1);
		padding-bottom: 0.4rem;
	}

	.markdown-body :global(p) {
		margin: 0.6rem 0;
	}

	.markdown-body :global(ul) {
		padding-left: 1.2rem;
		margin: 0.6rem 0;
	}

	.markdown-body :global(li) {
		margin: 0.3rem 0;
	}

	.markdown-body :global(code) {
		background: rgba(107, 76, 154, 0.08);
		padding: 0.2rem 0.4rem;
		border-radius: 6px;
		font-family: monospace;
		font-size: 0.9em;
		color: #e91e63;
	}

	.markdown-body :global(a) {
		color: #ff6b9d;
		text-decoration: none;
		font-weight: 500;
	}

	.markdown-body :global(a:hover) {
		text-decoration: underline;
	}

	.guide-empty {
		text-align: center;
		color: #8b7ba8;
		padding: 2rem 1rem;
	}

	.guide-empty span {
		font-size: 3rem;
		display: block;
		margin-bottom: 1rem;
	}

	.guide-empty p {
		margin: 0;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.5rem;
	}

	.modal-btn {
		border: none;
		border-radius: 14px;
		padding: 0.8rem 1.5rem;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition:
			transform 0.3s ease,
			box-shadow 0.3s ease;
	}

	.modal-btn:hover {
		transform: translateY(-2px);
		box-shadow: 0 10px 25px rgba(102, 126, 234, 0.35);
	}

	@media (prefers-reduced-motion: reduce) {
		.modal-close,
		.modal-btn {
			transition: none;
		}

		.modal-close:hover,
		.modal-btn:hover {
			transform: none;
			box-shadow: none;
		}
	}
</style>
