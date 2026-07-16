import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const R2_BUCKET = 'downloads';
export const KV_BINDING = 'APP_KV';

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value) {
	return Number.isSafeInteger(value) && value >= 0;
}

function validOptionalString(value, maxLength) {
	return value === undefined || (typeof value === 'string' && value.length <= maxLength);
}

function hasUniqueValidItems(value, maxItems, isValidItem) {
	if (
		!isRecord(value) ||
		!Array.isArray(value.items) ||
		value.items.length > maxItems ||
		!isNonNegativeSafeInteger(value.lastUpdated)
	) {
		return false;
	}
	const ids = new Set();
	for (const item of value.items) {
		if (!isValidItem(item) || ids.has(item.id)) return false;
		ids.add(item.id);
	}
	return true;
}

function isManagedR2Url(url, platform) {
	const match = /^\/api\/admin\/download\/uploads\/(windows|macos|linux)\/([0-9a-f-]+)$/iu.exec(
		url
	);
	return (
		match?.[1] === platform &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(match[2])
	);
}

function isPrivateLiteralHostname(hostname) {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
	if (
		normalized === 'localhost' ||
		normalized.endsWith('.localhost') ||
		normalized.endsWith('.local') ||
		normalized === 'metadata.google.internal' ||
		normalized === '::' ||
		normalized === '::1' ||
		/^(?:fc|fd|fe[89ab])/u.test(normalized)
	) {
		return true;
	}
	// Runtime validation fully parses IPv6. The migration CLI deliberately rejects all literal
	// IPv6 hosts rather than risk copying an alternate private-address representation.
	if (normalized.includes(':')) return true;
	const parts = normalized.split('.');
	if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return false;
	const octets = parts.map(Number);
	if (octets.some((octet) => octet < 0 || octet > 255)) return true;
	const [first, second] = octets;
	return (
		first === 0 ||
		first === 10 ||
		first === 127 ||
		(first === 100 && second >= 64 && second <= 127) ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168) ||
		first >= 224
	);
}

function isSafeExternalUrl(value, httpsOnly) {
	try {
		const url = new URL(value);
		return (
			(httpsOnly ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol)) &&
			!url.username &&
			!url.password &&
			!isPrivateLiteralHostname(url.hostname)
		);
	} catch {
		return false;
	}
}

function isDownloadItem(item) {
	if (!isRecord(item)) return false;
	if (
		typeof item.id !== 'string' ||
		item.id.length === 0 ||
		item.id.length > 128 ||
		!/^[a-z0-9_-]+$/iu.test(item.id) ||
		!['windows', 'macos', 'linux'].includes(item.platform) ||
		!['link', 'r2', 's3'].includes(item.storageType) ||
		typeof item.version !== 'string' ||
		item.version.length === 0 ||
		item.version.length > 128 ||
		typeof item.size !== 'string' ||
		item.size.length === 0 ||
		item.size.length > 128 ||
		typeof item.url !== 'string' ||
		item.url.length === 0 ||
		item.url.length > 4096 ||
		typeof item.enabled !== 'boolean' ||
		!isNonNegativeSafeInteger(item.createdAt) ||
		!isNonNegativeSafeInteger(item.updatedAt) ||
		!validOptionalString(item.categoryId, 128) ||
		!validOptionalString(item.title, 200) ||
		!validOptionalString(item.description, 4000) ||
		!validOptionalString(item.configGuide, 20_000) ||
		!validOptionalString(item.filename, 512) ||
		(item.downloadCount !== undefined && !isNonNegativeSafeInteger(item.downloadCount))
	) {
		return false;
	}
	if (item.storageType === 'r2' && !isManagedR2Url(item.url, item.platform)) return false;
	if (item.storageType === 'link' && !isSafeExternalUrl(item.url, false)) return false;
	if (item.storageType === 's3' && !isSafeExternalUrl(item.url, true)) return false;
	if (item.rustdeskConfig !== undefined) {
		const config = item.rustdeskConfig;
		if (
			!isRecord(config) ||
			config.enabled !== true ||
			typeof config.idServer !== 'string' ||
			config.idServer.length === 0 ||
			config.idServer.length > 255 ||
			typeof config.key !== 'string' ||
			config.key.length === 0 ||
			config.key.length > 4096
		) {
			return false;
		}
	}
	if (item.s3Config !== undefined) {
		if (!isRecord(item.s3Config)) return false;
		for (const field of ['endpoint', 'bucket', 'region', 'presignedUrl', 'publicUrl']) {
			if (!validOptionalString(item.s3Config[field], 4096)) return false;
		}
	}
	return true;
}

function isDownloadList(value) {
	return (
		hasUniqueValidItems(value, 1000, isDownloadItem) &&
		Number.isSafeInteger(value.downloadCount) &&
		value.downloadCount >= 0
	);
}

function isCategory(item) {
	return (
		isRecord(item) &&
		typeof item.id === 'string' &&
		item.id.length > 0 &&
		item.id.length <= 128 &&
		typeof item.name === 'string' &&
		item.name.length > 0 &&
		item.name.length <= 64 &&
		validOptionalString(item.icon, 32) &&
		validOptionalString(item.color, 9) &&
		(item.color === undefined ||
			/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu.test(item.color)) &&
		validOptionalString(item.description, 500) &&
		isNonNegativeSafeInteger(item.order) &&
		isNonNegativeSafeInteger(item.createdAt) &&
		isNonNegativeSafeInteger(item.updatedAt)
	);
}

function isCategoryList(value) {
	return hasUniqueValidItems(value, 200, isCategory);
}

function isAnnouncement(item) {
	return (
		isRecord(item) &&
		typeof item.id === 'string' &&
		item.id.length > 0 &&
		item.id.length <= 128 &&
		typeof item.title === 'string' &&
		item.title.length > 0 &&
		item.title.length <= 200 &&
		typeof item.content === 'string' &&
		item.content.length > 0 &&
		item.content.length <= 20_000 &&
		typeof item.visible === 'boolean' &&
		typeof item.pinned === 'boolean' &&
		isNonNegativeSafeInteger(item.createdAt) &&
		isNonNegativeSafeInteger(item.updatedAt)
	);
}

function isAnnouncementList(value) {
	return hasUniqueValidItems(value, 200, isAnnouncement);
}

export const METADATA_TARGETS = [
	{
		id: 'downloads',
		label: '下载列表',
		kvKey: 'downloads_list',
		r2Key: '.metadata/downloads-list.json',
		isValid: isDownloadList
	},
	{
		id: 'categories',
		label: '分类列表',
		kvKey: 'categories_list',
		r2Key: '.metadata/categories-list.json',
		isValid: isCategoryList
	},
	{
		id: 'announcements',
		label: '公告列表',
		kvKey: 'announcements',
		r2Key: '.metadata/announcements-list.json',
		isValid: isAnnouncementList
	}
];

export function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

export function normalizeAndDescribeSnapshot(target, value) {
	if (!target.isValid(value)) {
		throw new Error(`KV ${target.kvKey} 不是有效的${target.label}快照`);
	}
	const json = JSON.stringify(value);
	return {
		value,
		json,
		sha256: sha256(json),
		itemCount: value.items.length
	};
}

export function combinedSourceSha256(snapshots) {
	return sha256(
		snapshots
			.map(({ target, snapshot }) => `${target.kvKey}:${snapshot.sha256}`)
			.sort()
			.join('\n')
	);
}

export function readOption(args, name) {
	const exactIndex = args.indexOf(name);
	if (exactIndex !== -1) {
		const value = args[exactIndex + 1];
		if (!value || value.startsWith('--')) throw new Error(`${name} 缺少参数值`);
		return value;
	}
	const prefix = `${name}=`;
	const entry = args.find((arg) => arg.startsWith(prefix));
	return entry?.slice(prefix.length);
}

export function parseStorageMode(args) {
	const remote = args.includes('--remote');
	const local = args.includes('--local');
	if (remote && local) throw new Error('--local 和 --remote 不能同时使用');
	return remote ? 'remote' : 'local';
}

export function runWrangler(args, { capture = false, allowFailure = false } = {}) {
	const result = spawnSync('npx', ['--no-install', 'wrangler', ...args], {
		cwd: process.cwd(),
		encoding: 'utf8',
		stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
	});
	if (result.error) throw result.error;
	if (!allowFailure && result.status !== 0) {
		throw new Error(`Wrangler 命令失败（退出码 ${result.status ?? '未知'}）`);
	}
	return result;
}

function modeFlag(mode) {
	return mode === 'remote' ? '--remote' : '--local';
}

export function readKvSnapshot(target, mode, { allowMissing = false } = {}) {
	const result = runWrangler(
		['kv', 'key', 'get', target.kvKey, '--binding', KV_BINDING, '--text', modeFlag(mode)],
		{ capture: true }
	);
	const raw = result.stdout.trim();
	if (!raw || /^Value not found$/iu.test(raw)) {
		if (allowMissing) return undefined;
		throw new Error(`KV ${target.kvKey} 不存在或为空`);
	}
	let value;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new Error(`KV ${target.kvKey} 不是有效 JSON`);
	}
	return normalizeAndDescribeSnapshot(target, value);
}

export function readR2Snapshot(target, mode) {
	const directory = mkdtempSync(join(tmpdir(), 'playdota2win-r2-read-'));
	const file = join(directory, 'snapshot.json');
	try {
		const result = runWrangler(
			['r2', 'object', 'get', `${R2_BUCKET}/${target.r2Key}`, modeFlag(mode), '--file', file],
			{ capture: true, allowFailure: true }
		);
		if (result.status !== 0) {
			const diagnostic = `${result.stdout}\n${result.stderr}`;
			if (/specified key does not exist/i.test(diagnostic)) return { exists: false };
			throw new Error(`无法检查 R2 ${target.r2Key}：${result.stderr.trim() || '未知错误'}`);
		}
		const raw = readFileSync(file, 'utf8');
		let value;
		try {
			value = JSON.parse(raw);
		} catch {
			throw new Error(`R2 ${target.r2Key} 不是有效 JSON`);
		}
		return { exists: true, snapshot: normalizeAndDescribeSnapshot(target, value) };
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

export function writeKvSnapshot(target, snapshot, mode) {
	const directory = mkdtempSync(join(tmpdir(), 'playdota2win-kv-write-'));
	const file = join(directory, 'snapshot.json');
	try {
		writeFileSync(file, snapshot.json, { encoding: 'utf8', mode: 0o600 });
		runWrangler([
			'kv',
			'key',
			'put',
			target.kvKey,
			'--binding',
			KV_BINDING,
			modeFlag(mode),
			'--path',
			file
		]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

export function writeR2Snapshot(target, snapshot, mode) {
	const directory = mkdtempSync(join(tmpdir(), 'playdota2win-r2-write-'));
	const file = join(directory, 'snapshot.json');
	try {
		writeFileSync(file, snapshot.json, { encoding: 'utf8', mode: 0o600 });
		runWrangler([
			'r2',
			'object',
			'put',
			`${R2_BUCKET}/${target.r2Key}`,
			modeFlag(mode),
			'--content-type',
			'application/json; charset=utf-8',
			'--file',
			file
		]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
