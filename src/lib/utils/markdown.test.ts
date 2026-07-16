import assert from 'node:assert/strict';
import test from 'node:test';

import { getGuideAction, getSafePublicUrl, parseMarkdown } from './markdown.ts';

test('escapes raw HTML and link attributes', () => {
	const result = parseMarkdown(
		'<img src=x onerror=alert(1)> [x](https://example.com/" onmouseover="x)'
	);

	assert.doesNotMatch(result, /<img/i);
	assert.doesNotMatch(result, /<a\s/i);
	assert.doesNotMatch(result, /href=/i);
	assert.match(result, /&lt;img/);
});

test('renders only allowlisted Markdown link protocols', () => {
	const result = parseMarkdown(
		'[safe](https://example.com/path?a=1&b=2) [voice](mumble://voice.example.com) [bad](javascript:alert(1))'
	);

	assert.match(result, /href="https:\/\/example\.com\/path\?a=1&amp;b=2"/);
	assert.match(result, /href="mumble:\/\/voice\.example\.com"/);
	assert.doesNotMatch(result, /href="javascript:/i);
});

test('rejects credentials, protocol-relative URLs and unsafe guide actions', () => {
	assert.equal(getSafePublicUrl('https://user:pass@example.com'), null);
	assert.equal(getSafePublicUrl('//evil.example.com'), null);
	assert.equal(getGuideAction('open: javascript:alert(1)'), null);
	assert.deepEqual(getGuideAction('打开：mumble://voice.example.com'), {
		type: 'open',
		value: 'mumble://voice.example.com'
	});
});

test('preserves basic formatting without allowing raw markup', () => {
	assert.equal(
		parseMarkdown('# Hello\n- **bold**\n- `code`'),
		'<h3>Hello</h3><ul><li><strong>bold</strong></li><li><code>code</code></li></ul>'
	);
});
