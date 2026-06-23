import { json, type RequestHandler } from '@sveltejs/kit';
import { signDownloadPath } from '$lib/admin-auth';
import type { DownloadItem, DownloadList } from '$lib/types';

const KV_KEY = 'downloads_list';

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
	'Cache-Control': 'no-store'
};

interface RustDeskPublicConfig {
	downloadUrl: string;
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

	if (item.storageType === 'r2' && item.url.startsWith('/api/admin/download/') && signingSecret) {
		url = await signDownloadPath(item.url, signingSecret);
	}

	return new URL(url, origin).toString();
}

export const OPTIONS: RequestHandler = async () => {
	return new Response(null, {
		status: 204,
		headers: corsHeaders
	});
};

export const GET: RequestHandler = async ({ platform, request }) => {
	try {
		const kv = platform?.env.APP_KV;
		if (!kv) {
			return json({ error: 'KV not available' }, { status: 500, headers: corsHeaders });
		}

		const data = await kv.get<DownloadList>(KV_KEY, 'json');
		const list = data || { items: [], downloadCount: 0, lastUpdated: Date.now() };
		const item = findRustDeskItem(list);

		if (!item?.rustdeskConfig) {
			return json(
				{ error: 'RustDesk config not configured' },
				{ status: 404, headers: corsHeaders }
			);
		}

		const origin = new URL(request.url).origin;
		const downloadUrl = await resolveDownloadUrl(item, origin, platform?.env.ADMIN_SIGNING_SECRET);

		return json(
			{
				downloadUrl,
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
