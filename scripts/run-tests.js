import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function collectTests(directory, suffix) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...collectTests(path, suffix));
		else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(path);
	}
	return files.sort();
}

const tests = [
	...collectTests('src', '.test.ts'),
	...collectTests('worker', '.test.ts'),
	...collectTests('scripts', '.test.js')
].sort();
if (tests.length === 0) {
	console.error('No tests found under src/, worker/, or scripts/');
	process.exit(1);
}

const result = spawnSync(process.execPath, ['--experimental-transform-types', '--test', ...tests], {
	stdio: 'inherit'
});

process.exit(result.status ?? 1);
