import type { DownloadItem, R2BackupState } from '../types.ts';
import { MAX_EXTERNAL_BACKUP_BYTES } from '../upload-limits.ts';
import { compareNumericVersions, extractComparableVersion } from '../utils/download-version.ts';
import {
	createR2DownloadBackupStore,
	getDownloadBackupFilename,
	getDownloadBackupState,
	getOriginDownloadFilename,
	getReadyDownloadBackupObjectKey,
	queueDownloadBackup,
	shouldPreferDownloadBackup,
	syncDownloadBackup,
	type DownloadBackupLogger
} from './download-backup.ts';
import { readDownloadList, writeDownloadList } from './download-list-store.ts';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ManagedSoftware = 'mumble' | 'rustdesk';

interface ManagedSoftwareDefinition {
	label: string;
	repositoryPath: string;
	latestReleaseUrl: string;
	assetPattern: RegExp;
	matchesItem(item: DownloadItem): boolean;
}

interface GitHubReleaseAsset {
	name?: unknown;
	browser_download_url?: unknown;
	size?: unknown;
}

interface GitHubLatestRelease {
	tag_name?: unknown;
	draft?: unknown;
	prerelease?: unknown;
	assets?: unknown;
}

export interface OfficialSoftwareRelease {
	product: ManagedSoftware;
	version: string;
	filename: string;
	downloadUrl: string;
	size: number;
}

export interface SoftwareUpdateItemResult {
	product: ManagedSoftware;
	label: string;
	itemId?: string;
	title?: string;
	status: 'updated' | 'current' | 'failed';
	version?: string;
	filename?: string;
	size?: string;
	selectedSource?: 'origin' | 'r2';
	r2Updated: boolean;
	error?: string;
}

export interface SoftwareUpdateSummary {
	total: number;
	updated: number;
	current: number;
	failed: number;
	results: SoftwareUpdateItemResult[];
}

interface UpdateManagedSoftwareOptions {
	kv: KVNamespace | undefined;
	r2: R2Bucket;
	fetchImpl?: FetchLike;
	backupLogger?: DownloadBackupLogger;
	now?: () => number;
}

const MANAGED_SOFTWARE: Record<ManagedSoftware, ManagedSoftwareDefinition> = {
	mumble: {
		label: 'Mumble',
		repositoryPath: 'mumble-voip/mumble',
		latestReleaseUrl: 'https://api.github.com/repos/mumble-voip/mumble/releases/latest',
		assetPattern: /^mumble_client-(\d+(?:\.\d+)+)\.x64\.exe$/iu,
		matchesItem(item) {
			if (item.storageType !== 'link' || item.platform !== 'windows') return false;
			const filenames = [getOriginDownloadFilename(item), item.filename || ''];
			return (
				item.title?.trim().toLowerCase() === 'mumble' ||
				filenames.some((filename) => /^mumble_client-/iu.test(filename))
			);
		}
	},
	rustdesk: {
		label: 'RustDesk',
		repositoryPath: 'rustdesk/rustdesk',
		latestReleaseUrl: 'https://api.github.com/repos/rustdesk/rustdesk/releases/latest',
		assetPattern: /^rustdesk-(\d+(?:\.\d+)+)-x86_64\.exe$/iu,
		matchesItem(item) {
			return (
				item.storageType === 'link' &&
				item.platform === 'windows' &&
				item.rustdeskConfig?.enabled === true
			);
		}
	}
};

const MANAGED_SOFTWARE_ORDER: ManagedSoftware[] = ['mumble', 'rustdesk'];
const RELEASE_REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESULT_ERROR_LENGTH = 300;

function resultError(error: unknown): string {
	return (error instanceof Error ? error.message : 'Unknown update error')
		.replace(/\s+/gu, ' ')
		.trim()
		.slice(0, MAX_RESULT_ERROR_LENGTH);
}

function parseOfficialAssetUrl(value: string, repositoryPath: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error('Official release returned an invalid asset URL');
	}
	if (
		parsed.protocol !== 'https:' ||
		parsed.hostname !== 'github.com' ||
		parsed.username ||
		parsed.password ||
		!parsed.pathname.startsWith(`/${repositoryPath}/releases/download/`)
	) {
		throw new Error('Official release returned an unexpected asset URL');
	}
	return parsed.toString();
}

export function parseOfficialSoftwareRelease(
	product: ManagedSoftware,
	value: unknown
): OfficialSoftwareRelease {
	const definition = MANAGED_SOFTWARE[product];
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${definition.label} latest release response is invalid`);
	}
	const release = value as GitHubLatestRelease;
	if (release.draft === true || release.prerelease === true) {
		throw new Error(`${definition.label} latest release is not stable`);
	}
	if (!Array.isArray(release.assets)) {
		throw new Error(`${definition.label} latest release has no assets`);
	}

	const matchingAssets = (release.assets as GitHubReleaseAsset[]).filter(
		(asset) => typeof asset.name === 'string' && definition.assetPattern.test(asset.name)
	);
	if (matchingAssets.length !== 1) {
		throw new Error(
			`${definition.label} latest release must contain exactly one supported Windows asset`
		);
	}

	const asset = matchingAssets[0];
	const filename = asset.name as string;
	const filenameMatch = filename.match(definition.assetPattern);
	const version = filenameMatch?.[1];
	if (!version) throw new Error(`${definition.label} asset filename has no comparable version`);

	const tagVersion =
		typeof release.tag_name === 'string' ? extractComparableVersion(release.tag_name) : undefined;
	if (!tagVersion || compareNumericVersions(tagVersion, version) !== 0) {
		throw new Error(`${definition.label} release tag and asset filename versions do not match`);
	}
	if (
		typeof asset.size !== 'number' ||
		!Number.isSafeInteger(asset.size) ||
		asset.size <= 0 ||
		asset.size > MAX_EXTERNAL_BACKUP_BYTES
	) {
		throw new Error(`${definition.label} release asset size is invalid`);
	}
	if (typeof asset.browser_download_url !== 'string') {
		throw new Error(`${definition.label} release asset URL is missing`);
	}

	return {
		product,
		version,
		filename,
		downloadUrl: parseOfficialAssetUrl(asset.browser_download_url, definition.repositoryPath),
		size: asset.size
	};
}

export function findManagedSoftwareItem(
	items: DownloadItem[],
	product: ManagedSoftware
): DownloadItem {
	const definition = MANAGED_SOFTWARE[product];
	const matches = items.filter((item) => definition.matchesItem(item));
	if (matches.length !== 1) {
		throw new Error(
			matches.length === 0
				? `No unique ${definition.label} download item is configured`
				: `Multiple ${definition.label} download items match the update rule`
		);
	}
	return matches[0];
}

async function fetchOfficialSoftwareRelease(
	product: ManagedSoftware,
	fetchImpl: FetchLike
): Promise<OfficialSoftwareRelease> {
	const definition = MANAGED_SOFTWARE[product];
	const response = await fetchImpl(definition.latestReleaseUrl, {
		method: 'GET',
		signal: AbortSignal.timeout(RELEASE_REQUEST_TIMEOUT_MS),
		headers: {
			Accept: 'application/vnd.github+json',
			'User-Agent': 'playdota2win-software-updater',
			'X-GitHub-Api-Version': '2022-11-28'
		}
	});
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`${definition.label} release check returned HTTP ${response.status}`);
	}
	return parseOfficialSoftwareRelease(product, await response.json());
}

function formatDownloadSize(bytes: number): string {
	const mebibytes = bytes / (1024 * 1024);
	return `${mebibytes.toFixed(1)}MB`;
}

async function getExistingReadyBackup(
	item: DownloadItem,
	state: R2BackupState | undefined,
	r2: R2Bucket
): Promise<R2BackupState | undefined> {
	const objectKey = getReadyDownloadBackupObjectKey(item, state);
	if (!objectKey) return undefined;
	try {
		return (await r2.head(objectKey)) ? state : undefined;
	} catch (error) {
		console.error({
			component: 'software_update',
			event_name: 'software_update_backup_inspection_failed',
			item_id: item.id,
			error_message: resultError(error)
		});
		return undefined;
	}
}

function selectedMetadata(
	item: DownloadItem,
	release: OfficialSoftwareRelease,
	state: R2BackupState | undefined
): {
	filename: string;
	version: string;
	size: string;
	selectedSource: 'origin' | 'r2';
} {
	if (shouldPreferDownloadBackup(item, state)) {
		const filename = getDownloadBackupFilename(state);
		const version = filename ? extractComparableVersion(filename) : undefined;
		if (!filename || !version) throw new Error('R2 backup filename has no comparable version');
		return {
			filename,
			version,
			size: state?.size ? formatDownloadSize(state.size) : item.size,
			selectedSource: 'r2'
		};
	}

	const filename = getOriginDownloadFilename(item);
	const version = extractComparableVersion(filename);
	if (!version) throw new Error('Original download filename has no comparable version');
	return {
		filename,
		version,
		size:
			compareNumericVersions(version, release.version) === 0
				? formatDownloadSize(release.size)
				: item.size,
		selectedSource: 'origin'
	};
}

export async function updateManagedSoftware(
	options: UpdateManagedSoftwareOptions
): Promise<SoftwareUpdateSummary> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const now = options.now ?? Date.now;
	const snapshot = await readDownloadList(options.kv, options.r2);
	const backupStore = createR2DownloadBackupStore(options.r2);
	const updatedItems = new Map<string, DownloadItem>();
	const results: SoftwareUpdateItemResult[] = [];

	for (const product of MANAGED_SOFTWARE_ORDER) {
		const definition = MANAGED_SOFTWARE[product];
		let item: DownloadItem | undefined;
		let r2Updated = false;
		try {
			item = findManagedSoftwareItem(snapshot.list.items, product);
			const release = await fetchOfficialSoftwareRelease(product, fetchImpl);
			const originFilename = getOriginDownloadFilename(item);
			const originVersion = extractComparableVersion(originFilename);
			if (!originVersion) {
				throw new Error(`${definition.label} original link filename has no comparable version`);
			}

			let backupState = await getExistingReadyBackup(
				item,
				await getDownloadBackupState(backupStore, item.id),
				options.r2
			);
			const backupFilename = getDownloadBackupFilename(backupState);
			const backupVersion = backupFilename ? extractComparableVersion(backupFilename) : undefined;
			const releaseNotOlderThanOrigin = compareNumericVersions(release.version, originVersion) >= 0;
			const releaseNewerThanBackup =
				!backupVersion || compareNumericVersions(release.version, backupVersion) > 0;

			if (releaseNotOlderThanOrigin && releaseNewerThanBackup) {
				const releaseItem: DownloadItem = {
					...item,
					url: release.downloadUrl,
					filename: release.filename,
					version: release.version,
					size: formatDownloadSize(release.size)
				};
				const queued = await queueDownloadBackup(backupStore, releaseItem, {
					logger: options.backupLogger,
					sourceType: 'official-release',
					trigger: 'release_update'
				});
				const synced = await syncDownloadBackup(releaseItem, backupStore, options.r2, {
					fetchImpl,
					logger: options.backupLogger,
					operationId: queued.operationId,
					sourceType: 'official-release',
					trigger: 'release_update'
				});
				const syncedFilename = getDownloadBackupFilename(synced);
				const syncedVersion = syncedFilename ? extractComparableVersion(syncedFilename) : undefined;
				if (
					synced.status !== 'ready' ||
					synced.error ||
					!syncedVersion ||
					compareNumericVersions(syncedVersion, release.version) !== 0
				) {
					throw new Error(synced.error || `${definition.label} R2 update did not complete`);
				}
				backupState = synced;
				r2Updated = true;
			}

			const selected = selectedMetadata(item, release, backupState);
			const metadataChanged =
				item.filename !== selected.filename ||
				item.version !== selected.version ||
				item.size !== selected.size;
			if (metadataChanged) {
				updatedItems.set(item.id, {
					...item,
					filename: selected.filename,
					version: selected.version,
					size: selected.size,
					updatedAt: now()
				});
			}

			results.push({
				product,
				label: definition.label,
				itemId: item.id,
				title: item.title,
				status: r2Updated || metadataChanged ? 'updated' : 'current',
				version: selected.version,
				filename: selected.filename,
				size: selected.size,
				selectedSource: selected.selectedSource,
				r2Updated
			});
		} catch (error) {
			results.push({
				product,
				label: definition.label,
				itemId: item?.id,
				title: item?.title,
				status: 'failed',
				r2Updated,
				error: resultError(error)
			});
		}
	}

	if (updatedItems.size > 0) {
		await writeDownloadList(
			snapshot,
			{
				...snapshot.list,
				items: snapshot.list.items.map((item) => updatedItems.get(item.id) || item)
			},
			options.kv,
			options.r2
		);
	}

	return {
		total: results.length,
		updated: results.filter((result) => result.status === 'updated').length,
		current: results.filter((result) => result.status === 'current').length,
		failed: results.filter((result) => result.status === 'failed').length,
		results
	};
}
