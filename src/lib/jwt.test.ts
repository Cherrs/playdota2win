import assert from 'node:assert/strict';
import test from 'node:test';

import { signJwt, verifyJwt } from './jwt.ts';

const SECRET = 'test-secret-that-is-long-enough';

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const now = Math.floor(Date.now() / 1000);
	return { sub: 'admin', iat: now, exp: now + 3600, ...overrides };
}

test('accepts a valid, strictly shaped admin JWT', async () => {
	const token = await signJwt(claims(), SECRET);
	const result = await verifyJwt(token, SECRET);

	assert.equal(result.valid, true);
	assert.equal(result.payload?.sub, 'admin');
});

test('rejects tampered signatures and algorithm confusion', async () => {
	const token = await signJwt(claims(), SECRET);
	assert.equal((await verifyJwt(`${token.slice(0, -1)}x`, SECRET)).valid, false);

	const noneHeader = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
	const [, payload, signature] = token.split('.');
	assert.equal((await verifyJwt(`${noneHeader}.${payload}.${signature}`, SECRET)).valid, false);
});

test('requires admin subject and integer iat/exp claims', async () => {
	for (const payload of [
		claims({ sub: 'user' }),
		claims({ iat: undefined }),
		claims({ exp: undefined }),
		claims({ exp: 'tomorrow' })
	]) {
		assert.equal((await verifyJwt(await signJwt(payload, SECRET), SECRET)).valid, false);
	}
});

test('rejects expired and unreasonably future-issued tokens', async () => {
	const now = Math.floor(Date.now() / 1000);
	const expired = await signJwt(claims({ iat: now - 120, exp: now - 1 }), SECRET);
	const future = await signJwt(claims({ iat: now + 120, exp: now + 3600 }), SECRET);

	assert.equal((await verifyJwt(expired, SECRET)).valid, false);
	assert.equal((await verifyJwt(future, SECRET)).valid, false);
});

test('returns false for malformed JWT input instead of throwing', async () => {
	for (const token of ['', 'not-a-jwt', 'a.b.c', `${'x'.repeat(4097)}.b.c`]) {
		assert.equal((await verifyJwt(token, SECRET)).valid, false);
	}
});
