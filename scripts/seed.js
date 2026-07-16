#!/usr/bin/env node
/**
 * 本地开发测试数据初始化。默认同时写入 KV 镜像和 R2 canonical 快照。
 * 远程重置只用于可丢弃的测试环境，必须显式确认当前 R2 对象的 SHA-256。
 */

import { pathToFileURL } from 'node:url';
import {
	METADATA_TARGETS,
	normalizeAndDescribeSnapshot,
	parseStorageMode,
	readOption,
	readR2Snapshot,
	writeKvSnapshot,
	writeR2Snapshot
} from './metadata-cli.js';

export const REMOTE_RESET_CONFIRMATION = 'RESET_REMOTE_TEST_DATA';

export function parseSeedArguments(args) {
	const mode = parseStorageMode(args);
	if (mode === 'remote' && readOption(args, '--confirm-reset') !== REMOTE_RESET_CONFIRMATION) {
		throw new Error(
			`远程 seed 默认禁止。仅可丢弃测试环境可使用 --confirm-reset ${REMOTE_RESET_CONFIRMATION}`
		);
	}
	return {
		mode,
		expectedSha256: Object.fromEntries(
			METADATA_TARGETS.map((target) => [
				target.id,
				readOption(args, `--expected-${target.id}-sha256`)
			])
		)
	};
}

export function assertExpectedRemoteTargets(currentTargets, expectedSha256) {
	const missingOptions = [];
	for (const { target, current } of currentTargets) {
		const actual = current.exists ? current.snapshot.sha256 : 'missing';
		if (!expectedSha256[target.id]) {
			missingOptions.push(`--expected-${target.id}-sha256 ${actual}`);
			continue;
		}
		if (expectedSha256[target.id] !== actual) {
			throw new Error(
				`${target.label} R2 快照已变化：期望 ${expectedSha256[target.id]}，实际 ${actual}`
			);
		}
	}
	if (missingOptions.length > 0) {
		throw new Error(`请核对当前快照后重试，并加上：${missingOptions.join(' ')}`);
	}
}

function createSeedData(now) {
	const categories = {
		items: [
			{
				id: 'cat-windows',
				name: 'Windows 客户端',
				icon: '🪟',
				color: '#0078D4',
				description: 'Windows 平台专用客户端',
				order: 1,
				createdAt: now,
				updatedAt: now
			},
			{
				id: 'cat-macos',
				name: 'macOS 客户端',
				icon: '🍎',
				color: '#555555',
				description: 'macOS 平台专用客户端',
				order: 2,
				createdAt: now,
				updatedAt: now
			},
			{
				id: 'cat-plugin',
				name: '脚本插件',
				icon: '🔧',
				color: '#6B4C9A',
				description: '辅助脚本与增强插件',
				order: 3,
				createdAt: now,
				updatedAt: now
			},
			{
				id: 'cat-config',
				name: '配置文件',
				icon: '⚙️',
				color: '#FF6B9D',
				description: '游戏配置与设置文件',
				order: 4,
				createdAt: now,
				updatedAt: now
			}
		],
		lastUpdated: now
	};

	const downloads = {
		items: [
			{
				id: 'dl-001',
				platform: 'windows',
				categoryId: 'cat-windows',
				title: 'Dota2 Win 助手 (Windows)',
				description: '专为 Windows 优化的 Dota2 辅助客户端，支持英雄数据实时分析、对局复盘功能。',
				configGuide:
					'## 安装指南\n\n1. 下载并解压安装包\n2. 运行 `setup.exe` 以管理员身份安装\n3. 启动游戏后打开助手\n\n### 配置说明\n\n```\nconfig_path = C:\\Users\\你的用户名\\AppData\\Roaming\\Dota2Win\n```\n\n> 首次使用需要在设置中填写 Steam ID',
				filename: 'dota2win-v2.1.0-windows.zip',
				version: 'v2.1.0',
				size: '45.2 MB',
				storageType: 'link',
				url: 'https://example.com/downloads/dota2win-v2.1.0-windows.zip',
				createdAt: now - 86400000 * 3,
				updatedAt: now - 86400000,
				enabled: true
			},
			{
				id: 'dl-002',
				platform: 'windows',
				categoryId: 'cat-windows',
				title: 'Dota2 Win 助手 (Windows) 旧版',
				description: '稳定版本，适合低配置电脑使用。',
				filename: 'dota2win-v1.9.5-windows.zip',
				version: 'v1.9.5',
				size: '38.7 MB',
				storageType: 'link',
				url: 'https://example.com/downloads/dota2win-v1.9.5-windows.zip',
				createdAt: now - 86400000 * 30,
				updatedAt: now - 86400000 * 30,
				enabled: true
			},
			{
				id: 'dl-003',
				platform: 'macos',
				categoryId: 'cat-macos',
				title: 'Dota2 Win 助手 (macOS)',
				description: '适配 Apple Silicon (M1/M2/M3) 和 Intel 双架构，流畅运行无需 Rosetta。',
				configGuide:
					'## macOS 安装说明\n\n1. 下载 `.dmg` 文件并打开\n2. 将应用拖入 Applications 文件夹\n3. 首次启动需要在 **系统设置 → 隐私与安全性** 中允许运行\n\n### 权限设置\n\n```bash\nxattr -cr /Applications/Dota2Win.app\n```',
				filename: 'dota2win-v2.1.0-macos.dmg',
				version: 'v2.1.0',
				size: '52.8 MB',
				storageType: 'link',
				url: 'https://example.com/downloads/dota2win-v2.1.0-macos.dmg',
				createdAt: now - 86400000 * 3,
				updatedAt: now - 86400000,
				enabled: true
			},
			{
				id: 'dl-004',
				platform: 'windows',
				categoryId: 'cat-plugin',
				title: '英雄对线分析插件',
				description: '实时显示当前对线英雄的克制关系、出装建议和技能加点推荐。',
				configGuide:
					'## 插件安装\n\n将插件文件放入主程序的 `plugins/` 目录后重启即可生效。\n\n支持的版本: v2.0.0 及以上',
				filename: 'hero-analysis-plugin-v1.2.0.zip',
				version: 'v1.2.0',
				size: '2.1 MB',
				storageType: 'link',
				url: 'https://example.com/downloads/hero-analysis-plugin-v1.2.0.zip',
				createdAt: now - 86400000 * 7,
				updatedAt: now - 86400000 * 2,
				enabled: true
			},
			{
				id: 'dl-005',
				platform: 'windows',
				categoryId: 'cat-config',
				title: '推荐游戏配置包',
				description: '针对竞技模式优化的 autoexec.cfg 配置，包含视角、快捷键和画质预设。',
				configGuide:
					'## 使用方法\n\n将 `autoexec.cfg` 复制到:\n```\nC:\\Program Files (x86)\\Steam\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\\n```\n\n然后在 Steam 启动选项中添加: `-console`',
				filename: 'recommended-config-v3.zip',
				version: 'v3.0',
				size: '128 KB',
				storageType: 'link',
				url: 'https://example.com/downloads/recommended-config-v3.zip',
				createdAt: now - 86400000 * 14,
				updatedAt: now - 86400000 * 5,
				enabled: true
			},
			{
				id: 'dl-006',
				platform: 'linux',
				categoryId: 'cat-plugin',
				title: '地图感知增强脚本 (Linux)',
				description: 'Linux 平台下的小地图增强显示脚本，支持自定义图标和颜色。',
				filename: 'minimap-enhancer-linux-v0.9.0.tar.gz',
				version: 'v0.9.0',
				size: '1.4 MB',
				storageType: 'link',
				url: 'https://example.com/downloads/minimap-enhancer-linux-v0.9.0.tar.gz',
				createdAt: now - 86400000 * 2,
				updatedAt: now - 86400000 * 2,
				enabled: false
			}
		],
		// 仅保留兼容字段；项目不再把这个静态值当作实时统计。
		downloadCount: 0,
		lastUpdated: now
	};

	const announcements = { items: [], lastUpdated: now };

	return { downloads, categories, announcements };
}

async function main() {
	try {
		const { mode, expectedSha256 } = parseSeedArguments(process.argv.slice(2));
		const data = createSeedData(Date.now());
		const seedTargets = METADATA_TARGETS.map((target) => ({
			target,
			snapshot: normalizeAndDescribeSnapshot(target, data[target.id])
		}));

		console.log(
			`\n=== Dota2Win ${mode === 'remote' ? '远程测试环境重置' : '本地数据初始化'} ===\n`
		);
		if (mode === 'remote') {
			const currentTargets = seedTargets.map(({ target }) => ({
				target,
				current: readR2Snapshot(target, mode)
			}));
			for (const { target, current } of currentTargets) {
				console.log(
					`${target.label}: ${current.exists ? `${current.snapshot.itemCount} 项, SHA-256 ${current.snapshot.sha256}` : '不存在'}`
				);
			}
			assertExpectedRemoteTargets(currentTargets, expectedSha256);

			// Wrangler 4.110 的 r2 object put 没有条件写参数。写入前二次检查，
			// 使变更在单操作者维护窗口内尽可能防止覆盖并发更新。
			const rechecked = seedTargets.map(({ target }) => ({
				target,
				current: readR2Snapshot(target, mode)
			}));
			assertExpectedRemoteTargets(rechecked, expectedSha256);
		}

		for (const entry of seedTargets) writeR2Snapshot(entry.target, entry.snapshot, mode);
		for (const entry of seedTargets) writeKvSnapshot(entry.target, entry.snapshot, mode);

		console.log('\n初始化完成!');
		console.log(`  分类: ${data.categories.items.length} 个`);
		console.log(`  下载项: ${data.downloads.items.length} 个 (1 个已禁用)`);
		console.log(`  公告: ${data.announcements.items.length} 个`);
		if (mode === 'local') console.log('\n现在运行 `npm run preview` 即可查看测试数据。');
	} catch (error) {
		console.error(`\n初始化已取消：${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	void main();
}
