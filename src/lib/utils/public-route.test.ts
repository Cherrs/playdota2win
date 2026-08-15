import assert from 'node:assert/strict';
import test from 'node:test';

import { isPublicDownloadPath } from './public-route.ts';

test('recognizes only public download page paths', () => {
	assert.equal(isPublicDownloadPath('/'), true);
	assert.equal(isPublicDownloadPath('/download'), true);
	assert.equal(isPublicDownloadPath('/download/'), true);
	assert.equal(isPublicDownloadPath('/admin'), false);
	assert.equal(isPublicDownloadPath('/assets/index.js'), false);
});
