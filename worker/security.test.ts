import assert from 'node:assert/strict';
import test from 'node:test';

import { isCrossOriginAdminMutation } from './security.ts';

const target = new URL('https://playdota2.win/api/admin');

test('blocks cross-origin state-changing admin requests', () => {
	assert.equal(
		isCrossOriginAdminMutation(
			new Request(target, {
				method: 'POST',
				headers: { Origin: 'https://evil.example.com' }
			}),
			target
		),
		true
	);
	assert.equal(
		isCrossOriginAdminMutation(
			new Request(target, {
				method: 'DELETE',
				headers: { 'Sec-Fetch-Site': 'cross-site' }
			}),
			target
		),
		true
	);
});

test('allows same-origin mutations and safe reads', () => {
	assert.equal(
		isCrossOriginAdminMutation(
			new Request(target, { method: 'POST', headers: { Origin: target.origin } }),
			target
		),
		false
	);
	assert.equal(
		isCrossOriginAdminMutation(
			new Request(target, {
				method: 'GET',
				headers: { Origin: 'https://evil.example.com' }
			}),
			target
		),
		false
	);
});
