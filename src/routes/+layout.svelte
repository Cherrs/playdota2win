<script lang="ts">
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import MumbleWidget from '$lib/components/MumbleWidget.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
{#if !page.url.pathname.startsWith('/admin')}
	<MumbleWidget />
{/if}
