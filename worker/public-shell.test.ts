import assert from 'node:assert/strict';
import test from 'node:test';

import { PUBLIC_SHELL_HTML, shouldPrerenderPublicShell } from './public-shell.ts';

test('public shell contains visible title, navigation and card placeholders', () => {
	assert.match(PUBLIC_SHELL_HTML, /<h1>PlayDota2Win/u);
	assert.match(PUBLIC_SHELL_HTML, /aria-label="主导航"/u);
	assert.match(PUBLIC_SHELL_HTML, /aria-label="下载分类"/u);
	assert.equal(PUBLIC_SHELL_HTML.match(/class="initial-shell__card"/gu)?.length, 3);
});

test('prerenders only GET responses for public HTML routes', () => {
	const html = new Response('<div id="root"></div>', {
		headers: { 'Content-Type': 'text/html; charset=utf-8' }
	});

	assert.equal(
		shouldPrerenderPublicShell(
			new Request('https://playdota2.win/download'),
			new URL('https://playdota2.win/download'),
			html
		),
		true
	);
	assert.equal(
		shouldPrerenderPublicShell(
			new Request('https://playdota2.win/admin'),
			new URL('https://playdota2.win/admin'),
			html
		),
		false
	);
	assert.equal(
		shouldPrerenderPublicShell(
			new Request('https://playdota2.win/', { method: 'HEAD' }),
			new URL('https://playdota2.win/'),
			html
		),
		false
	);
});
