import assert from 'node:assert/strict';
import test from 'node:test';

import { createPublicHomeDataLoader, type PublicHomeDataPreload } from './public-home-data.ts';

test('preloads all public home requests in parallel and reuses them', async () => {
	const requests: Array<{ cache?: RequestCache; url: string }> = [];
	const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
		requests.push({ url: String(input), cache: init?.cache });
		return new Response(JSON.stringify({ success: true, data: { items: [] } }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	}) as typeof fetch;
	const loader = createPublicHomeDataLoader(fetcher, () => 1_000);

	loader.preload();
	assert.deepEqual(
		requests.map(({ url }) => url),
		['/api/categories', '/api/downloads', '/api/announcements']
	);

	await Promise.all([loader.loadCategories(), loader.loadDownloads(), loader.loadAnnouncements()]);
	assert.equal(requests.length, 3);
	assert.equal(requests[1]?.cache, 'no-store');

	await loader.loadDownloads({ force: true });
	assert.equal(requests.length, 4);
});

test('honors an aborted consumer even when the underlying request was preloaded', async () => {
	const fetcher = (async () =>
		new Response(JSON.stringify({ success: true, data: { items: [] } }))) as typeof fetch;
	const loader = createPublicHomeDataLoader(fetcher);
	const controller = new AbortController();

	loader.preload();
	controller.abort();
	await assert.rejects(loader.loadCategories({ signal: controller.signal }), {
		name: 'AbortError'
	});
});

test('adopts inline HTML requests even when the main bundle loads slowly', async () => {
	let fetchCount = 0;
	const fetcher = (async () => {
		fetchCount += 1;
		return new Response('{}');
	}) as typeof fetch;
	const preload: PublicHomeDataPreload = {
		createdAt: 1_000,
		categories: Promise.resolve({
			ok: true,
			status: 200,
			data: { success: true, data: { items: [], lastUpdated: 1_000 } }
		}),
		downloads: Promise.resolve({
			ok: true,
			status: 200,
			data: { success: true, data: { items: [], downloadCount: 0, lastUpdated: 1_000 } }
		}),
		announcements: Promise.resolve({
			ok: true,
			status: 200,
			data: { success: true, data: { items: [], lastUpdated: 1_000 } }
		})
	};
	const loader = createPublicHomeDataLoader(fetcher, () => 30_000, preload);

	await Promise.all([loader.loadCategories(), loader.loadDownloads(), loader.loadAnnouncements()]);
	assert.equal(fetchCount, 0);
});
