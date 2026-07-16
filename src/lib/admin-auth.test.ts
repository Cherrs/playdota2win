import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ADMIN_SESSION_COOKIE,
	issueAdminJwt,
	requireAdminAuth,
	signDownloadPath,
	timingSafeEqualSecrets,
	verifySignedUrl
} from './admin-auth.ts';

const SECRET = 'admin-jwt-secret-for-tests';

test('admin authentication accepts only the session cookie contract', async () => {
	const token = await issueAdminJwt(SECRET);
	const cookieRequest = new Request('https://example.com/api/admin', {
		headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}` }
	});
	const bearerRequest = new Request('https://example.com/api/admin', {
		headers: { Authorization: `Bearer ${token}` }
	});

	assert.equal(await requireAdminAuth(cookieRequest, SECRET), true);
	assert.equal(await requireAdminAuth(bearerRequest, SECRET), false);
});

test('uses constant-time secret equality semantics', async () => {
	assert.equal(await timingSafeEqualSecrets('correct', 'correct'), true);
	assert.equal(await timingSafeEqualSecrets('wrong', 'correct'), false);
	assert.equal(await timingSafeEqualSecrets('', 'correct'), false);
});

test('verifies signed paths with Web Crypto and rejects malformed signatures', async () => {
	const signed = await signDownloadPath('/api/admin/download/example.zip', SECRET, 60_000);
	assert.equal(await verifySignedUrl(new URL(`https://example.com${signed}`), SECRET), true);

	const tampered = new URL(`https://example.com${signed}`);
	tampered.pathname = '/api/admin/download/other.zip';
	assert.equal(await verifySignedUrl(tampered, SECRET), false);

	const malformed = new URL(`https://example.com${signed}`);
	malformed.searchParams.set('sig', 'not-hex');
	assert.equal(await verifySignedUrl(malformed, SECRET), false);
});
