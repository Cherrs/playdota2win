import assert from 'node:assert/strict';
import test from 'node:test';

import type { DownloadItem, DownloadList } from '../types.ts';
import { getDownloadBackupStateKey, type DownloadBackupLogger } from './download-backup.ts';
import { DOWNLOAD_LIST_R2_KEY } from './download-list-store.ts';
import {
	buildVersionedPrimaryDownloadUrl,
	findManagedSoftwareItem,
	parseOfficialLatestReleaseUrl,
	parseOfficialSoftwareRelease,
	updateManagedSoftware
} from './software-update.ts';

interface StoredObject {
	body: Uint8Array;
	etag: string;
}

class MemoryR2 {
	readonly objects = new Map<string, StoredObject>();
	#version = 0;

	async get(key: string) {
		const object = this.objects.get(key);
		if (!object) return null;
		return {
			key,
			etag: object.etag,
			size: object.body.byteLength,
			async text() {
				return new TextDecoder().decode(object.body);
			},
			async json<T>() {
				return JSON.parse(new TextDecoder().decode(object.body)) as T;
			}
		};
	}

	async head(key: string) {
		const object = this.objects.get(key);
		return object ? { key, etag: object.etag, size: object.body.byteLength } : null;
	}

	async put(key: string, value: string | ReadableStream, options?: Pick<R2PutOptions, 'onlyIf'>) {
		const current = this.objects.get(key);
		const onlyIf = options?.onlyIf;
		if (onlyIf && !(onlyIf instanceof Headers)) {
			if (onlyIf.etagDoesNotMatch === '*' && current) return null;
			if (onlyIf.etagMatches !== undefined && current?.etag !== onlyIf.etagMatches) return null;
		}
		const body =
			typeof value === 'string'
				? new TextEncoder().encode(value)
				: new Uint8Array(await new Response(value).arrayBuffer());
		const etag = `etag-${++this.#version}`;
		this.objects.set(key, { body, etag });
		return { key, etag, size: body.byteLength };
	}

	async delete(key: string) {
		this.objects.delete(key);
	}

	async seedList(list: DownloadList): Promise<void> {
		await this.put(DOWNLOAD_LIST_R2_KEY, JSON.stringify(list));
	}

	readJson<T>(key: string): T {
		const object = this.objects.get(key);
		assert.ok(object, `Missing object ${key}`);
		return JSON.parse(new TextDecoder().decode(object.body)) as T;
	}
}

const quietLogger: DownloadBackupLogger = {
	write() {}
};

function downloadItem(overrides: Partial<DownloadItem>): DownloadItem {
	return {
		id: 'download',
		platform: 'windows',
		version: '1.0.0',
		size: '1.0MB',
		storageType: 'link',
		url: 'https://downloads.example.com/client-1.0.0.exe',
		createdAt: 1,
		updatedAt: 1,
		enabled: true,
		...overrides
	};
}

function releasePayload(
	product: 'mumble' | 'rustdesk',
	version: string,
	size: number
): Record<string, unknown> {
	const mumble = product === 'mumble';
	const repository = mumble ? 'mumble-voip/mumble' : 'rustdesk/rustdesk';
	const filename = mumble ? `mumble_client-${version}.x64.exe` : `rustdesk-${version}-x86_64.exe`;
	return {
		tag_name: mumble ? `v${version}` : version,
		draft: false,
		prerelease: false,
		assets: [
			{
				name: filename,
				browser_download_url: `https://github.com/${repository}/releases/download/v${version}/${filename}`,
				size
			}
		]
	};
}

test('parses only the expected stable official Windows asset', () => {
	assert.deepEqual(parseOfficialSoftwareRelease('mumble', releasePayload('mumble', '1.5.915', 2)), {
		product: 'mumble',
		version: '1.5.915',
		filename: 'mumble_client-1.5.915.x64.exe',
		downloadUrl:
			'https://github.com/mumble-voip/mumble/releases/download/v1.5.915/mumble_client-1.5.915.x64.exe',
		size: 2
	});
	assert.throws(
		() =>
			parseOfficialSoftwareRelease('rustdesk', {
				...releasePayload('rustdesk', '1.4.9', 2),
				prerelease: true
			}),
		/not stable/iu
	);
	assert.throws(
		() =>
			parseOfficialSoftwareRelease('rustdesk', {
				...releasePayload('rustdesk', '1.4.9', 2),
				assets: [
					{
						name: 'rustdesk-1.4.9-x86_64.exe',
						browser_download_url: 'https://attacker.example/rustdesk.exe',
						size: 2
					}
				]
			}),
		/unexpected asset URL/iu
	);
});

test('builds the expected official asset from a GitHub latest-release redirect', () => {
	assert.deepEqual(
		parseOfficialLatestReleaseUrl(
			'mumble',
			'https://github.com/mumble-voip/mumble/releases/tag/v1.5.915'
		),
		{
			product: 'mumble',
			version: '1.5.915',
			filename: 'mumble_client-1.5.915.x64.exe',
			downloadUrl:
				'https://github.com/mumble-voip/mumble/releases/download/v1.5.915/mumble_client-1.5.915.x64.exe'
		}
	);
	assert.throws(
		() =>
			parseOfficialLatestReleaseUrl(
				'mumble',
				'https://attacker.example/mumble-voip/mumble/releases/tag/v1.5.915'
			),
		/unexpected/iu
	);
});

test('builds a same-directory versioned URL only for the primary download host', () => {
	const release = parseOfficialLatestReleaseUrl(
		'mumble',
		'https://github.com/mumble-voip/mumble/releases/tag/v1.5.915'
	);
	assert.equal(
		buildVersionedPrimaryDownloadUrl(
			downloadItem({
				url: 'https://d.example.com:8081/tools/mumble_client-1.5.901.x64.exe'
			}),
			release,
			' D.Example.Com '
		),
		'https://d.example.com:8081/tools/mumble_client-1.5.915.x64.exe'
	);
	assert.equal(
		buildVersionedPrimaryDownloadUrl(
			downloadItem({ url: 'https://downloads.example.com/mumble_client-1.5.901.x64.exe' }),
			release,
			'd.example.com'
		),
		undefined
	);
	for (const url of [
		'https://d.example.com/mumble_client-1.5.901.x64.exe',
		'https://d.example.com.attacker.example/mumble_client-1.5.901.x64.exe',
		'https://user:password@d.example.com/mumble_client-1.5.901.x64.exe',
		'ftp://d.example.com/mumble_client-1.5.901.x64.exe'
	]) {
		assert.equal(buildVersionedPrimaryDownloadUrl(downloadItem({ url }), release), undefined);
		if (!url.startsWith('https://d.example.com/')) {
			assert.equal(
				buildVersionedPrimaryDownloadUrl(downloadItem({ url }), release, 'd.example.com'),
				undefined
			);
		}
	}
});

test('matches only the official RustDesk API item and excludes the monkey installer', () => {
	const official = downloadItem({
		id: 'rustdesk',
		title: 'RustDesk',
		filename: 'rustdesk-1.4.9-x86_64.exe',
		url: 'https://downloads.example.com/rustdesk-1.4.9-x86_64.exe',
		rustdeskConfig: { enabled: true, idServer: 'id.example.com', key: 'key' }
	});
	const monkey = downloadItem({
		id: 'monkey',
		title: '猴版Rustdesk远程',
		filename: 'syprdsetup.exe',
		url: 'https://downloads.example.com/syprdsetup.exe'
	});

	assert.equal(findManagedSoftwareItem([official, monkey], 'rustdesk').id, 'rustdesk');
});

test('updates R2 and metadata while keeping equal versions on the original link', async () => {
	const mumbleSize = 2 * 1024 * 1024;
	const rustDeskSize = 1024 * 1024;
	const mumble = downloadItem({
		id: 'mumble',
		title: 'Mumble',
		filename: 'mumble_client-1.5.901.x64.exe',
		version: '1.5.901',
		size: '47.0MB',
		url: 'https://d.example.com:8081/mumble_client-1.5.901.x64.exe'
	});
	const rustdesk = downloadItem({
		id: 'rustdesk',
		title: 'RustDesk',
		filename: 'rustdesk-1.4.9-x86_64.exe',
		version: '1.4.8',
		size: '20.0MB',
		url: 'https://d.example.com:8081/rustdesk-1.4.9-x86_64.exe',
		rustdeskConfig: { enabled: true, idServer: 'id.example.com', key: 'key' }
	});
	const monkey = downloadItem({
		id: 'monkey',
		title: '猴版Rustdesk远程',
		filename: 'syprdsetup.exe',
		version: '2025.1.0',
		size: '8.0MB',
		url: 'https://downloads.example.com/syprdsetup.exe'
	});
	const list: DownloadList = {
		items: [mumble, rustdesk, monkey],
		downloadCount: 0,
		lastUpdated: 1
	};
	const bucket = new MemoryR2();
	await bucket.seedList(list);
	const assetDownloads: string[] = [];
	let mumbleFallbackChecks = 0;
	let primaryOriginChecks = 0;
	const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		if (url.startsWith('https://api.github.com/') && url.endsWith('/mumble/releases/latest')) {
			return new Response('rate limited', { status: 403 });
		}
		if (url === 'https://github.com/mumble-voip/mumble/releases/latest') {
			mumbleFallbackChecks += 1;
			const response = new Response('latest release');
			Object.defineProperty(response, 'url', {
				value: 'https://github.com/mumble-voip/mumble/releases/tag/v1.5.915'
			});
			return response;
		}
		if (url.endsWith('/rustdesk/rustdesk/releases/latest')) {
			return Response.json(releasePayload('rustdesk', '1.4.9', rustDeskSize));
		}
		if (
			url === 'https://d.example.com:8081/mumble_client-1.5.915.x64.exe' &&
			init?.method === 'HEAD'
		) {
			primaryOriginChecks += 1;
			return new Response(null, { status: 200 });
		}
		assetDownloads.push(url);
		const size = url.includes('mumble_client') ? mumbleSize : rustDeskSize;
		return new Response(new Uint8Array(size), {
			headers: {
				'content-length': String(size),
				'content-type': 'application/octet-stream'
			}
		});
	};

	const first = await updateManagedSoftware({
		kv: undefined,
		primaryDownloadHostname: 'd.example.com',
		r2: bucket as unknown as R2Bucket,
		fetchImpl,
		backupLogger: quietLogger,
		now: () => 10
	});
	assert.equal(first.updated, 2);
	assert.equal(first.current, 0);
	assert.equal(first.failed, 0);
	assert.equal(
		first.results.find((result) => result.product === 'mumble')?.selectedSource,
		'origin'
	);
	assert.equal(first.results.find((result) => result.product === 'mumble')?.originUrlUpdated, true);
	assert.equal(
		first.results.find((result) => result.product === 'rustdesk')?.selectedSource,
		'origin'
	);
	assert.equal(assetDownloads.length, 2);
	assert.equal(mumbleFallbackChecks, 1);
	assert.equal(primaryOriginChecks, 1);

	const stored = bucket.readJson<DownloadList>(DOWNLOAD_LIST_R2_KEY);
	assert.deepEqual(
		stored.items.find((item) => item.id === 'mumble'),
		{
			...mumble,
			url: 'https://d.example.com:8081/mumble_client-1.5.915.x64.exe',
			filename: 'mumble_client-1.5.915.x64.exe',
			version: '1.5.915',
			size: '2.0MB',
			updatedAt: 10
		}
	);
	assert.deepEqual(
		stored.items.find((item) => item.id === 'rustdesk'),
		{
			...rustdesk,
			filename: 'rustdesk-1.4.9-x86_64.exe',
			version: '1.4.9',
			size: '1.0MB',
			updatedAt: 10
		}
	);
	assert.deepEqual(
		stored.items.find((item) => item.id === 'monkey'),
		monkey
	);
	assert.equal(
		bucket.readJson<{ sourceType?: string; version?: string }>(getDownloadBackupStateKey('mumble'))
			.sourceType,
		'official-release'
	);

	assetDownloads.length = 0;
	const second = await updateManagedSoftware({
		kv: undefined,
		primaryDownloadHostname: 'd.example.com',
		r2: bucket as unknown as R2Bucket,
		fetchImpl,
		backupLogger: quietLogger,
		now: () => 20
	});
	assert.equal(second.updated, 0);
	assert.equal(second.current, 2);
	assert.equal(second.failed, 0);
	assert.deepEqual(assetDownloads, []);
	assert.equal(mumbleFallbackChecks, 2);
	assert.equal(primaryOriginChecks, 1);
});
