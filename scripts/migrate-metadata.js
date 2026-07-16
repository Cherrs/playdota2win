#!/usr/bin/env node
/**
 * 将历史 KV 元数据显式迁移到 R2 canonical 对象。
 * 默认只输出预览；永不覆盖已存在的 R2 对象。
 */

import { pathToFileURL } from 'node:url';
import {
	METADATA_TARGETS,
	combinedSourceSha256,
	normalizeAndDescribeSnapshot,
	parseStorageMode,
	readKvSnapshot,
	readOption,
	readR2Snapshot,
	writeR2Snapshot
} from './metadata-cli.js';

export function parseMigrationArguments(args) {
	const mode = parseStorageMode(args);
	const apply = args.includes('--apply');
	if (mode === 'remote' && apply && !args.includes('--confirm-single-operator-window')) {
		throw new Error('远程迁移需要单操作者维护窗口，确认后加上 --confirm-single-operator-window');
	}
	const initializeMissingEmpty = (readOption(args, '--initialize-missing-empty') || '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
	const validOptionalTargets = new Set(['categories', 'announcements']);
	if (
		initializeMissingEmpty.some((target) => !validOptionalTargets.has(target)) ||
		new Set(initializeMissingEmpty).size !== initializeMissingEmpty.length
	) {
		throw new Error(
			'--initialize-missing-empty 仅接受不重复的 categories,announcements；下载列表不能初始化为空'
		);
	}
	return {
		mode,
		apply,
		confirmedSourceSha256: readOption(args, '--confirm-source-sha256'),
		initializeMissingEmpty
	};
}

function assertStillMissing(entries, mode) {
	for (const { target } of entries) {
		if (readR2Snapshot(target, mode).exists) {
			throw new Error(`R2 ${target.r2Key} 在预检后出现，已中止以防止覆盖`);
		}
	}
}

function readMigrationSources(mode, initializeMissingEmpty) {
	const initializeEmpty = new Set(initializeMissingEmpty);
	return METADATA_TARGETS.map((target) => {
		const snapshot = readKvSnapshot(target, mode, {
			allowMissing: initializeEmpty.has(target.id)
		});
		return {
			target,
			snapshot: snapshot ?? normalizeAndDescribeSnapshot(target, { items: [], lastUpdated: 0 }),
			initializedEmpty: snapshot === undefined
		};
	});
}

function assertSourcesUnchanged(expectedSha256, mode, initializeMissingEmpty) {
	const currentSources = readMigrationSources(mode, initializeMissingEmpty);
	const currentSha256 = combinedSourceSha256(currentSources);
	if (currentSha256 !== expectedSha256) {
		throw new Error(`KV 来源在预检后已变化（当前汇总 SHA-256 ${currentSha256}），请重新预览`);
	}
}

function verifyWritten(entry, mode) {
	const stored = readR2Snapshot(entry.target, mode);
	if (!stored.exists || stored.snapshot.sha256 !== entry.snapshot.sha256) {
		throw new Error(`R2 ${entry.target.r2Key} 写入后校验失败`);
	}
}

async function main() {
	try {
		const options = parseMigrationArguments(process.argv.slice(2));
		const sources = readMigrationSources(options.mode, options.initializeMissingEmpty);
		const sourceSha256 = combinedSourceSha256(sources);

		console.log(`\n=== KV → R2 元数据迁移预检 (${options.mode}) ===\n`);
		for (const { target, snapshot, initializedEmpty } of sources) {
			console.log(
				`${target.label}: ${initializedEmpty ? `KV ${target.kvKey} 缺失，按显式选项初始化空列表` : `KV ${target.kvKey}`}, ${snapshot.itemCount} 项, SHA-256 ${snapshot.sha256}`
			);
		}
		console.log(`\n来源汇总 SHA-256: ${sourceSha256}`);

		const missing = [];
		for (const entry of sources) {
			const current = readR2Snapshot(entry.target, options.mode);
			if (!current.exists) {
				console.log(`R2 ${entry.target.r2Key}: 不存在，可迁移`);
				missing.push(entry);
				continue;
			}
			if (current.snapshot.sha256 === entry.snapshot.sha256) {
				console.log(`R2 ${entry.target.r2Key}: 已存在且与 KV 一致，跳过`);
				continue;
			}
			throw new Error(
				`R2 ${entry.target.r2Key} 已存在且与 KV 不同（R2 SHA-256 ${current.snapshot.sha256}），拒绝覆盖`
			);
		}

		if (missing.length === 0) {
			console.log('\n无需迁移：所有 canonical R2 对象已存在。');
			return;
		}
		if (!options.apply) {
			console.log(
				`\n本次仅预览，未写入。核对数量和哈希后，加上 --apply --confirm-source-sha256 ${sourceSha256}`
			);
			return;
		}
		if (options.confirmedSourceSha256 !== sourceSha256) {
			throw new Error(`--confirm-source-sha256 与当前 KV 来源不一致；当前值为 ${sourceSha256}`);
		}

		// Wrangler 4.110 暂无 R2 put 条件写参数，因此在写入前对所有目标二次检查。
		// 远程 apply 还必须显式确认单操作者维护窗口。
		assertSourcesUnchanged(sourceSha256, options.mode, options.initializeMissingEmpty);
		assertStillMissing(missing, options.mode);
		for (const entry of missing) {
			writeR2Snapshot(entry.target, entry.snapshot, options.mode);
			verifyWritten(entry, options.mode);
			console.log(`已迁移 R2 ${entry.target.r2Key}`);
		}
		console.log('\n迁移完成。KV 仅作为镜像保留，运行时以 R2 canonical 为准。');
	} catch (error) {
		console.error(`\n迁移已中止：${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	void main();
}
