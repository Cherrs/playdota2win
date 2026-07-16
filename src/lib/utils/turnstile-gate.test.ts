import assert from 'node:assert/strict';
import test from 'node:test';

import { getTurnstileGateState } from './turnstile-gate.ts';

test('does not require Turnstile before the password failure threshold', () => {
	assert.deepEqual(getTurnstileGateState(2, 3, '', ''), {
		required: false,
		unavailable: false
	});
});

test('requires Turnstile after the threshold when both keys are configured', () => {
	assert.deepEqual(getTurnstileGateState(3, 3, 'site-key', 'secret-key'), {
		required: true,
		unavailable: false
	});
});

test('blocks explicitly instead of waiting for an unusable widget when keys are missing', () => {
	assert.deepEqual(getTurnstileGateState(3, 3, 'site-key', ''), {
		required: false,
		unavailable: true
	});
});
