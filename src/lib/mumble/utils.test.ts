import assert from 'node:assert/strict';
import test from 'node:test';

import { dedupeChannels } from './utils.ts';

test('dedupeChannels removes duplicate channel ids while preserving the richer channel entry', () => {
	const channels = [
		{ id: 0, name: 'Root', parentId: 0, description: '' },
		{ id: 2, name: '怪猎', parentId: 0, description: '默认频道' },
		{ id: 5, name: 'poe2', parentId: 0, description: '' },
		{ id: 2, name: '', parentId: 0, description: '' }
	];

	assert.deepEqual(dedupeChannels(channels), [
		{ id: 0, name: 'Root', parentId: 0, description: '' },
		{ id: 2, name: '怪猎', parentId: 0, description: '默认频道' },
		{ id: 5, name: 'poe2', parentId: 0, description: '' }
	]);
});
