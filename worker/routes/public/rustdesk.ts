import { json, type RequestHandler } from '../../http';
import { signDownloadPath } from '$lib/admin-auth';
import { generateDownloadToken } from '$lib/auth';
import {
	createR2DownloadBackupStore,
	getDownloadBackupFilename,
	getDownloadBackupState,
	getOriginDownloadFilename,
	getReadyDownloadBackupObjectKey,
	shouldPreferDownloadBackup
} from '$lib/server/download-backup';
import { readDownloadList } from '$lib/server/download-list-store';
import { getManagedUploadKey } from '$lib/server/download-object';
import { extractComparableVersion } from '$lib/utils/download-version';
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

interface ResolvedRustDeskDownload {
	url: string;
	filename?: string;
}

async function resolveDownload(
	item: DownloadItem,
	origin: string,
	signingSecret: string | undefined,
	r2: R2Bucket | undefined
): Promise<ResolvedRustDeskDownload> {
	let url = item.url;
	let filename = item.filename;

	if (item.storageType === 'link') {
		filename = getOriginDownloadFilename(item);
		if (r2) {
			const backupState = await getDownloadBackupState(createR2DownloadBackupStore(r2), item.id);
			const backupKey = shouldPreferDownloadBackup(item, backupState)
				? getReadyDownloadBackupObjectKey(item, backupState)
				: undefined;
			let backupExists = false;
			if (backupKey) {
				try {
					backupExists = (await r2.head(backupKey)) !== null;
				} catch (error) {
					console.error({
						component: 'rustdesk_config',
						event_name: 'rustdesk_backup_inspection_failed',
						item_id: item.id,
						error_message: error instanceof Error ? error.message : String(error)
					});
				}
			}

			if (backupKey && backupExists) {
				if (!signingSecret) throw new Error('R2 download signing is not configured');
				filename = getDownloadBackupFilename(backupState) || filename;
				const token = await generateDownloadToken(backupKey, signingSecret);
				const search = new URLSearchParams({ token, filename });
				url = `/api/downloads/relay/${backupKey}?${search.toString()}`;
			} else if (backupKey) {
				console.warn({
					component: 'rustdesk_config',
					event_name: 'newer_rustdesk_backup_unavailable',
					item_id: item.id
				});
			}
		}
	}

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
	return { url: resolved.toString(), filename };
}

function resolveVersion(item: DownloadItem, download: ResolvedRustDeskDownload): string {
	const candidates = [download.filename, download.url].filter(
		(value): value is string => typeof value === 'string' && value.trim().length > 0
	);

	for (const candidate of candidates) {
		const version = extractComparableVersion(candidate);
		if (version) {
			return version;
		}
	}
	return typeof item.version === 'string' ? item.version.trim() : '';
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
		const download = await resolveDownload(item, origin, platform?.env?.ADMIN_SIGNING_SECRET, r2);

		return json(
			{
				downloadUrl: download.url,
				version: resolveVersion(item, download),
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
