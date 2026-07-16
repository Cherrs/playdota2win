import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createManagedUploadKey,
	createManagedUploadUrl,
	getManagedUploadKey,
	isManagedUploadKey
} from './download-object.ts';

const id = '123e4567-e89b-42d3-a456-426614174000';

test('accepts only application-owned upload objects', () => {
	const key = createManagedUploadKey('windows', id);
	assert.equal(key, `uploads/windows/${id}`);
	assert.equal(isManagedUploadKey(key, 'windows'), true);
	assert.equal(getManagedUploadKey(createManagedUploadUrl(key), 'windows'), key);
	assert.equal(getManagedUploadKey(createManagedUploadUrl(key), 'linux'), null);
});

test('rejects metadata, backups, traversal and arbitrary upload paths', () => {
	for (const key of [
		'.metadata/downloads-list.json',
		'.security/failure-counters/x.json',
		'backups/item/file',
		'uploads/windows/../../.metadata/downloads-list.json',
		'uploads/windows/not-a-uuid',
		'uploads/other/123e4567-e89b-42d3-a456-426614174000'
	]) {
		assert.equal(isManagedUploadKey(key), false, key);
	}
	assert.equal(getManagedUploadKey('/api/admin/download/.metadata/downloads-list.json'), null);
	assert.equal(getManagedUploadKey('https://example.com/file'), null);
});
