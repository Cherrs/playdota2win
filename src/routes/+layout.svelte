<script lang="ts">
	import { page } from '$app/state';
	import MumbleWidget from '$lib/components/MumbleWidget.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/favicon.svg" />
</svelte:head>

{@render children()}
{#if !page.url.pathname.startsWith('/admin')}
	<MumbleWidget />
{/if}
