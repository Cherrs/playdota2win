import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePublicHttpsUrl } from './public-url.ts';

test('accepts only public absolute HTTPS URLs for direct S3 access', () => {
	assert.equal(
		normalizePublicHttpsUrl(' https://s3.example.com/file?signature=abc '),
		'https://s3.example.com/file?signature=abc'
	);
	for (const value of [
		'http://s3.example.com/file',
		'/relative',
		'https://user:secret@s3.example.com/file',
		'https://127.0.0.1/file',
		'https://10.0.0.1/file',
		'https://[::1]/file',
		'https://[fd00::1]/file',
		'https://[::ffff:127.0.0.1]/file',
		'https://service.local/file'
	]) {
		assert.throws(() => normalizePublicHttpsUrl(value));
	}
});
