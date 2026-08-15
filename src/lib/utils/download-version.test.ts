import assert from 'node:assert/strict';
import test from 'node:test';

import {
	compareNumericVersions,
	compareVersionedFilenames,
	extractComparableVersion
} from './download-version.ts';

test('extracts numeric versions without architecture suffixes', () => {
	assert.equal(extractComparableVersion('mumble_client-1.5.915.x64.exe'), '1.5.915');
	assert.equal(extractComparableVersion('rustdesk-1.4.9-x86_64.exe'), '1.4.9');
	assert.equal(
		extractComparableVersion('https://example.com/releases/v2.3.4/client.exe?token=hidden'),
		'2.3.4'
	);
	assert.equal(extractComparableVersion('syprdsetup.exe'), undefined);
});

test('compares dotted versions numerically and treats missing segments as zero', () => {
	assert.equal(compareNumericVersions('1.5.915', '1.5.901'), 1);
	assert.equal(compareNumericVersions('1.4.9', '1.4.10'), -1);
	assert.equal(compareNumericVersions('1.4.9.0', '1.4.9'), 0);
});

test('compares versions directly from source filenames', () => {
	assert.equal(
		compareVersionedFilenames('mumble_client-1.5.915.x64.exe', 'mumble_client-1.5.901.x64.exe'),
		1
	);
	assert.equal(
		compareVersionedFilenames('rustdesk-1.4.9-x86_64.exe', 'rustdesk-1.4.9-x86_64.exe'),
		0
	);
	assert.equal(compareVersionedFilenames('syprdsetup.exe', 'rustdesk-1.4.9-x86_64.exe'), null);
});
