import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const pages = [
	'index.html',
	'getting-started.html',
	'components.html',
	'store.html',
];
const storeStorageKey = 'vitemple-store:vitemple-docs';
let persistedStore;

for (const page of pages) {
	const html = await readFile(path.join(root, page), 'utf8');
	const dom = new JSDOM(html, {
		url: 'https://example.test/vitemple/' + page,
		runScripts: 'outside-only',
	});
	const { document } = dom.window;

	assert.equal(document.querySelectorAll('slot').length, 0, page + ': all slots compiled');
	assert.match(document.querySelector('footer').textContent, /Built with Vitemple/);
	assert.equal(document.querySelectorAll('h1').length, 1);

	for (const node of document.querySelectorAll('[href], [src]')) {
		const link = node.getAttribute('href') ?? node.getAttribute('src');
		if (/^(https?:|#)/.test(link)) continue;

		assert.ok(!link.startsWith('/'), 'local links must work under a subpath');
		await access(path.resolve(root, path.dirname(page), link.split('#')[0]));
	}

	if (page === 'store.html' && persistedStore) {
		dom.window.sessionStorage.setItem(storeStorageKey, persistedStore);
	}

	const module = document.querySelector('script[type="module"]');
	assert.ok(module);
	dom.window.eval(module.textContent.replace(/export\s*\{[^}]*\};?\s*$/, ''));

	const add = document.querySelector('[data-counter="1"]');
	const initialCount = Number(document.querySelector('[data-count]')?.textContent ?? 0);
	if (page === 'store.html') {
		assert.equal(initialCount, 1, 'store page restores counter from the previous page');
	}

	if (add) {
		add.click();
		assert.deepEqual(
			[...document.querySelectorAll('[data-count]')].map((node) => node.textContent),
			[String(initialCount + 1), String(initialCount + 1)],
		);

		document.querySelector('[data-counter="-1"]').click();
		assert.deepEqual(
			[...document.querySelectorAll('[data-count]')].map((node) => node.textContent),
			[String(initialCount), String(initialCount)],
		);

		if (page === 'index.html') add.click();
	}

	if (page === 'index.html') {
		persistedStore = dom.window.sessionStorage.getItem(storeStorageKey);
	}

	if (page === 'getting-started.html') {
		const snippets = [...document.querySelectorAll('pre code')].map((node) => node.textContent);
		assert.ok(snippets.some((snippet) => snippet.includes('\n  <head>\n    <meta')), 'code indentation preserved');
		assert.ok(snippets.some((snippet) => snippet.includes('Hello, {name}!')), 'placeholders kept literal');
	}

	let copied;
	Object.defineProperty(dom.window.navigator, 'clipboard', {
		value: { writeText: async (value) => { copied = value; } },
	});

	const copy = document.querySelector('.copy');
	if (copy) {
		copy.click();
		await Promise.resolve();
		assert.equal(copied, copy.closest('.codebox, .install').querySelector('code').textContent);
	}

	dom.window.close();
	console.log('PASS', page, '— links, slots, scripts, footer, copy and state');
}
