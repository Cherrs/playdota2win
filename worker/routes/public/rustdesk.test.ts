import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';

import type { RequestEvent, RequestHandler } from '../../http.ts';
import type { DownloadItem, DownloadList, R2BackupState } from '../../../src/lib/types.ts';
import { getDownloadBackupStateKey } from '../../../src/lib/server/download-backup.ts';
import { DOWNLOAD_LIST_R2_KEY } from '../../../src/lib/server/download-list-store.ts';

const root = resolve(import.meta.dirname, '../../..');
let vite: ViteDevServer;
let getRustDeskConfig: RequestHandler;

test.before(async () => {
	vite = await createServer({
		root,
		configFile: false,
		appType: 'custom',
		logLevel: 'silent',
		server: { middlewareMode: true },
		resolve: { alias: { $lib: resolve(root, 'src/lib') } }
	});
	const route = (await vite.ssrLoadModule('/worker/routes/public/rustdesk.ts')) as {
		GET: RequestHandler;
	};
	getRustDeskConfig = route.GET;
});

test.after(async () => {
	await vite.close();
});

function rustDeskItem(): DownloadItem {
	return {
		id: 'rustdesk',
		platform: 'windows',
		title: 'RustDesk',
		filename: 'rustdesk-9.9.9-x86_64.exe',
		version: '9.9.9',
		size: '23.3MB',
		storageType: 'link',
		url: 'https://downloads.example.com/rustdesk-1.4.9-x86_64.exe',
		rustdeskConfig: { enabled: true, idServer: 'id.example.com', key: 'public-key' },
		createdAt: 1,
		updatedAt: 1,
		enabled: true
	};
}

function createBucket(item: DownloadItem, state: R2BackupState): R2Bucket {
	const list: DownloadList = { items: [item], downloadCount: 0, lastUpdated: 1 };
	const values = new Map<string, string>([
		[DOWNLOAD_LIST_R2_KEY, JSON.stringify(list)],
		[getDownloadBackupStateKey(item.id), JSON.stringify(state)]
	]);
	return {
		async get(key: string) {
			const value = values.get(key);
			if (value === undefined) return null;
			return {
				etag: `${key}-etag`,
				async text() {
					return value;
				},
				async json<T>() {
					return JSON.parse(value) as T;
				}
			} as R2ObjectBody;
		},
		async head(key: string) {
			return key === state.objectKey ? ({ key } as R2Object) : null;
		}
	} as R2Bucket;
}

async function getConfig(item: DownloadItem, state: R2BackupState) {
	const request = new Request('https://example.com/api/rustdesk');
	const response = await getRustDeskConfig({
		request,
		url: new URL(request.url),
		params: {},
		cookies: { set() {}, delete() {} },
		fetch,
		platform: {
			env: {
				UPLOADS_BUCKET: createBucket(item, state),
				ADMIN_SIGNING_SECRET: 'test-signing-secret'
			} as Env
		}
	} satisfies RequestEvent);
	return { response, body: (await response.json()) as Record<string, unknown> };
}

test('RustDesk API uses a strictly newer R2 release and reports its filename version', async () => {
	const item = rustDeskItem();
	const { response, body } = await getConfig(item, {
		status: 'ready',
		sourceUrl:
			'https://github.com/rustdesk/rustdesk/releases/download/1.5.0/rustdesk-1.5.0-x86_64.exe',
		filename: 'rustdesk-1.5.0-x86_64.exe',
		version: '1.5.0',
		sourceType: 'official-release',
		operationId: 'release-1.5.0',
		objectKey: 'mirrors/rustdesk/release-1.5.0',
		updatedAt: 1,
		size: 10
	});

	assert.equal(response.status, 200);
	assert.equal(body.version, '1.5.0');
	assert.match(
		String(body.downloadUrl),
		/^https:\/\/example\.com\/api\/downloads\/relay\/mirrors\/rustdesk\/release-1\.5\.0\?/u
	);
	assert.match(String(body.downloadUrl), /filename=rustdesk-1.5.0-x86_64.exe/u);
});

test('RustDesk API keeps the original link when the R2 release version is equal', async () => {
	const item = rustDeskItem();
	const { response, body } = await getConfig(item, {
		status: 'ready',
		sourceUrl:
			'https://github.com/rustdesk/rustdesk/releases/download/1.4.9/rustdesk-1.4.9-x86_64.exe',
		filename: 'rustdesk-1.4.9-x86_64.exe',
		version: '1.4.9',
		sourceType: 'official-release',
		operationId: 'release-1.4.9',
		objectKey: 'mirrors/rustdesk/release-1.4.9',
		updatedAt: 1,
		size: 10
	});

	assert.equal(response.status, 200);
	assert.equal(body.version, '1.4.9');
	assert.equal(body.downloadUrl, item.url);
});
