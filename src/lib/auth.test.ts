import assert from 'node:assert/strict';
import test from 'node:test';

import { DOWNLOAD_TOKEN_EXPIRY, generateDownloadToken, verifyDownloadToken } from './auth.ts';

const SECRET = 'test-download-signing-secret';
const NOW = Date.UTC(2026, 6, 13, 10, 0, 0);

test('accepts an R2 relay token only for its bound object path', async () => {
	const token = await generateDownloadToken('downloads/item-1/file.zip', SECRET, NOW);

	assert.equal(await verifyDownloadToken(token, 'downloads/item-1/file.zip', SECRET, NOW), true);
	assert.equal(await verifyDownloadToken(token, 'downloads/item-2/file.zip', SECRET, NOW), false);
});

test('expires an R2 relay token after five minutes', async () => {
	const path = 'downloads/item-1/file.zip';
	const token = await generateDownloadToken(path, SECRET, NOW);

	assert.equal(
		await verifyDownloadToken(token, path, SECRET, NOW + DOWNLOAD_TOKEN_EXPIRY - 1_000),
		true
	);
	assert.equal(await verifyDownloadToken(token, path, SECRET, NOW + DOWNLOAD_TOKEN_EXPIRY), false);
});

test('rejects tampered, legacy, and wrongly signed relay tokens', async () => {
	const path = 'downloads/item-1/file.zip';
	const token = await generateDownloadToken(path, SECRET, NOW);
	const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

	assert.equal(await verifyDownloadToken(tampered, path, SECRET, NOW), false);
	assert.equal(await verifyDownloadToken('legacy-token', path, SECRET, NOW), false);
	assert.equal(await verifyDownloadToken(token, path, 'different-secret', NOW), false);
	assert.equal(await verifyDownloadToken(token, path, undefined, NOW), false);
});
