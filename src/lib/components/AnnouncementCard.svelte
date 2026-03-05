<script lang="ts">
	import type { Announcement } from '$lib/types';
	import { parseMarkdown } from '$lib/utils/markdown';

	interface Props {
		announcement: Announcement;
	}

	let { announcement }: Props = $props();

	let htmlContent = $derived(parseMarkdown(announcement.content));
</script>

<div class="announcement-card" class:pinned={announcement.pinned}>
	<div class="card-header">
		{#if announcement.pinned}
			<span class="pin-icon">📌</span>
		{/if}
		<h3 class="card-title">{announcement.title}</h3>
	</div>
	<div class="card-content">
		{@html htmlContent}
	</div>
</div>

<style>
	.announcement-card {
		background: linear-gradient(135deg, #fffbf0, #fff0e0);
		border: 1px solid rgba(255, 180, 80, 0.3);
		border-radius: 20px;
		padding: 1.25rem 1.5rem;
		transition: box-shadow 0.3s ease;
	}

	.announcement-card:hover {
		box-shadow: 0 4px 16px rgba(255, 160, 60, 0.2);
	}

	.announcement-card.pinned {
		border-color: rgba(255, 140, 40, 0.5);
		box-shadow: 0 2px 12px rgba(255, 160, 60, 0.15);
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.pin-icon {
		font-size: 1rem;
		flex-shrink: 0;
	}

	.card-title {
		font-family: 'Fredoka', 'Nunito', sans-serif;
		font-size: 1.1rem;
		font-weight: 600;
		color: #8b5e1a;
		margin: 0;
	}

	.card-content {
		font-size: 0.9rem;
		color: #6b4c2a;
		line-height: 1.6;
	}

	.card-content :global(a) {
		color: #c07020;
		text-decoration: underline;
	}

	.card-content :global(strong) {
		font-weight: 700;
	}

	.card-content :global(ul),
	.card-content :global(ol) {
		padding-left: 1.25rem;
		margin: 0.5rem 0;
	}

	.card-content :global(p) {
		margin: 0.25rem 0;
	}

	.card-content :global(em) {
		font-style: italic;
	}

	.card-content :global(code) {
		background: rgba(255, 160, 60, 0.12);
		border-radius: 4px;
		padding: 0.1em 0.35em;
		font-size: 0.85em;
		color: #7a4010;
	}

	.card-content :global(h3),
	.card-content :global(h4) {
		font-family: 'Fredoka', 'Nunito', sans-serif;
		color: #8b5e1a;
		margin: 0.5rem 0 0.25rem;
	}
</style>
