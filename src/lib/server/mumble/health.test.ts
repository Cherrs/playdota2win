import assert from 'node:assert/strict';
import test from 'node:test';
import { isMumbleHealthy } from './health.ts';

test('accepts v2 readiness only when the HTTP status and upstream probe succeed', () => {
	assert.equal(isMumbleHealthy(true, '{"upstream_tcp_reachable":true,"builtin_turn":true}'), true);
	assert.equal(isMumbleHealthy(true, '{"upstream_tcp_reachable":false}'), false);
	assert.equal(isMumbleHealthy(false, '{"upstream_tcp_reachable":true}'), false);
	assert.equal(isMumbleHealthy(true, '{"upstream_tcp_reachable":"true"}'), false);
	assert.equal(isMumbleHealthy(true, '<html>access challenge</html>'), false);
	assert.equal(isMumbleHealthy(true, 'ok'), true);
});
