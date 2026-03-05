<script lang="ts">
	import type {
		Announcement,
		AnnouncementList as AnnouncementListData,
		ApiResponse
	} from '$lib/types';
	import AnnouncementCard from './AnnouncementCard.svelte';

	let announcements = $state<Announcement[]>([]);
	let loading = $state(true);

	async function loadAnnouncements() {
		try {
			const res = await fetch('/api/announcements');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data: ApiResponse<AnnouncementListData> = await res.json();
			if (data.success && data.data) {
				announcements = data.data.items;
			}
		} catch (e) {
			console.error('Failed to load announcements:', e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		loadAnnouncements();
	});
</script>

{#if !loading && announcements.length > 0}
	<section class="announcement-section">
		<div class="section-header">
			<span class="section-icon">📢</span>
			<h2 class="section-title">公告</h2>
		</div>
		<div class="announcement-list">
			{#each announcements as announcement (announcement.id)}
				<AnnouncementCard {announcement} />
			{/each}
		</div>
	</section>
{/if}

<style>
	.announcement-section {
		width: 100%;
		max-width: 720px;
		margin-bottom: 2rem;
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.section-icon {
		font-size: 1.25rem;
	}

	.section-title {
		font-family: 'Fredoka', 'Nunito', sans-serif;
		font-size: 1.25rem;
		font-weight: 600;
		color: #6b4c9a;
		margin: 0;
	}

	.announcement-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
</style>
