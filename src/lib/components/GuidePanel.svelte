<script lang="ts">
	import type { DownloadItem, Platform } from '$lib/types';
	import { parseGuideSteps, getGuideAction } from '$lib/utils/markdown';

	interface Props {
		item: DownloadItem | null;
		message: string;
	}

	let { item, message }: Props = $props();

	// Use derived for the base message, with local override capability
	let displayMessage = $derived(message);
	let localOverride = $state<string | null>(null);

	// Computed display value
	let shownMessage = $derived(localOverride ?? displayMessage);

	// Reset override when parent message changes
	$effect(() => {
		if (message !== undefined) {
			localOverride = null;
		}
	});

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

	async function handleAction(action: { type: 'copy' | 'open'; value: string }) {
		if (action.type === 'copy') {
			try {
				await navigator.clipboard.writeText(action.value);
				localOverride = `已复制：${action.value}`;
			} catch (e) {
				console.error('Failed to copy text:', e);
				localOverride = '复制失败，请手动复制。';
			}
			return;
		}

		if (action.type === 'open') {
			window.open(action.value, '_blank', 'noopener');
			localOverride = `已打开：${action.value}`;
		}
	}
</script>

<div class="guide-panel" role="tabpanel">
	<div class="guide-header">
		<h3>配置指引</h3>
		{#if item}
			<p>
				{item.title || `${getPlatformLabel(item.platform)} 版本`}
			</p>
		{/if}
	</div>
	<p class="guide-message">{shownMessage}</p>
	{#if item && parseGuideSteps(item.configGuide).length > 0}
		<ol class="guide-steps">
			{#each parseGuideSteps(item.configGuide) as step (step)}
				{@const action = getGuideAction(step)}
				<li>
					<div class="guide-step-text">{step}</div>
					{#if action}
						<button class="guide-action" onclick={() => handleAction(action)} type="button">
							{action.type === 'copy' ? '点击复制' : '打开链接'}
						</button>
					{/if}
				</li>
			{/each}
		</ol>
	{:else}
		<div class="guide-empty">
			<span>🌸</span>
			<p>暂无配置指引，请联系管理员补充～</p>
		</div>
	{/if}
</div>

<style>
	.guide-panel {
		background: rgba(255, 255, 255, 0.9);
		border-radius: 20px;
		padding: 1.5rem;
		box-shadow: 0 12px 30px rgba(107, 76, 154, 0.12);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.guide-header h3 {
		margin: 0;
		font-family: 'Fredoka', sans-serif;
		color: #6b4c9a;
		font-size: 1.3rem;
	}

	.guide-header p {
		margin: 0.3rem 0 0;
		color: #8b7ba8;
		font-size: 0.95rem;
	}

	.guide-message {
		margin: 0;
		color: #6b4c9a;
		background: rgba(255, 255, 255, 0.8);
		border-radius: 12px;
		padding: 0.8rem 1rem;
		box-shadow: inset 0 0 0 1px rgba(107, 76, 154, 0.08);
	}

	.guide-steps {
		margin: 0;
		padding-left: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		color: #4d3a73;
	}

	.guide-steps li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.8rem;
		background: rgba(255, 240, 247, 0.8);
		border-radius: 12px;
		box-shadow: 0 6px 16px rgba(107, 76, 154, 0.08);
	}

	.guide-step-text {
		flex: 1;
		min-width: 180px;
		color: #2d1b4e;
	}

	.guide-action {
		border: none;
		background: linear-gradient(135deg, #ff6b9d 0%, #6b4c9a 100%);
		color: white;
		font-weight: 600;
		font-family: inherit;
		padding: 0.45rem 0.9rem;
		border-radius: 999px;
		cursor: pointer;
		transition:
			transform 0.3s ease,
			box-shadow 0.3s ease;
	}

	.guide-action:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 18px rgba(255, 107, 157, 0.35);
	}

	.guide-empty {
		text-align: center;
		color: #8b7ba8;
		padding: 1rem 0;
	}

	.guide-empty span {
		font-size: 2rem;
		display: block;
		margin-bottom: 0.5rem;
	}

	.guide-empty p {
		margin: 0;
	}
</style>
