import { json, type RequestHandler } from '../../http';
import { signDownloadPath } from '$lib/admin-auth';
import { readDownloadList } from '$lib/server/download-list-store';
import { getManagedUploadKey } from '$lib/server/download-object';
import { extractVersion } from '$lib/utils/parseFilename';
import type { DownloadItem, DownloadList } from '$lib/types';

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
	'Cache-Control': 'no-store'
};

interface RustDeskPublicConfig {
	downloadUrl: string;
	version: string;
	idServer: string;
	key: string;
}

function findRustDeskItem(list: DownloadList): DownloadItem | undefined {
	return list.items.find(
		(item) =>
			item.enabled &&
			item.rustdeskConfig?.enabled === true &&
			Boolean(item.rustdeskConfig.idServer) &&
			Boolean(item.rustdeskConfig.key)
	);
}

async function resolveDownloadUrl(
	item: DownloadItem,
	origin: string,
	signingSecret?: string
): Promise<string> {
	let url = item.url;

	if (item.storageType === 'r2') {
		if (!getManagedUploadKey(item.url, item.platform) || !signingSecret) {
			throw new Error('Managed R2 download is not configured safely');
		}
		url = await signDownloadPath(item.url, signingSecret);
	}

	const resolved = new URL(url, origin);
	if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
		throw new Error('RustDesk download URL must use HTTP(S)');
	}
	return resolved.toString();
}

function resolveVersion(item: DownloadItem, downloadUrl: string): string {
	const storedVersion = typeof item.version === 'string' ? item.version.trim() : '';
	if (storedVersion) {
		return storedVersion;
	}

	const candidates = [item.filename, item.url, downloadUrl].filter(
		(value): value is string => typeof value === 'string' && value.trim().length > 0
	);

	for (const candidate of candidates) {
		const version = extractVersion(candidate);
		if (version) {
			return version;
		}
	}

	return '';
}

export const OPTIONS: RequestHandler = async () => {
	return new Response(null, {
		status: 204,
		headers: corsHeaders
	});
};

export const GET: RequestHandler = async ({ platform, request }) => {
	try {
		const kv = platform?.env?.APP_KV;
		const r2 = platform?.env?.UPLOADS_BUCKET;
		if (!kv && !r2) {
			return json({ error: 'Storage not available' }, { status: 500, headers: corsHeaders });
		}

		const { list } = await readDownloadList(kv, r2);
		const item = findRustDeskItem(list);

		if (!item?.rustdeskConfig) {
			return json(
				{ error: 'RustDesk config not configured' },
				{ status: 404, headers: corsHeaders }
			);
		}

		const origin = new URL(request.url).origin;
		const downloadUrl = await resolveDownloadUrl(item, origin, platform?.env?.ADMIN_SIGNING_SECRET);

		return json(
			{
				downloadUrl,
				version: resolveVersion(item, downloadUrl),
				idServer: item.rustdeskConfig.idServer,
				key: item.rustdeskConfig.key
			} satisfies RustDeskPublicConfig,
			{ headers: corsHeaders }
		);
	} catch (error) {
		console.error('Error fetching RustDesk config:', error);
		return json(
			{ error: 'Failed to fetch RustDesk config' },
			{ status: 500, headers: corsHeaders }
		);
	}
};
