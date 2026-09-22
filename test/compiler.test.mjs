import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { compile } from '../dist/compiler.js';

test('keeps HTML, expands slots, moves styles, transpiles scripts', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><html><head></head><body><main><slot src="./child.html" /></main></body></html>');
  await writeFile(path.join(dir, 'child.html'), '<style>p { color: red }</style><script lang="ts">const n: number = 1;</script><p>Child</p>');
  const result = await compile(path.join(dir, 'index.html'), { outdir: path.join(dir, 'out') });
  const output = await readFile(result.html, 'utf8');
  assert.match(output, /<style data-source="child.html">\s*p\{color:red\}\s*<\/style>/);
  assert.match(output, /<script type="module">[\s\S]*export\{[^}]*store/);
  assert.match(output, /<p>\s*Child\s*<\/p>/); assert.doesNotMatch(output, /<slot/);
  assert.match(output, /^<!doctype html>\s*<html>\s*<head>\s*<style data-source="child.html">/i);
  assert.match(output, /export\{[^}]*store/);
});

test('discovers and builds locally linked HTML pages once', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'guide'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<html><body><slot src="./nav.html" /></body></html>');
  await writeFile(path.join(dir, 'nav.html'), '<nav><a href="./about.html#team">About</a><a href="guide/">Guide</a><a href="#top">Top</a><a href="https://example.com/outside.html">External</a></nav>');
  await writeFile(path.join(dir, 'about.html'), '<html><body><h1>About</h1><a href="./index.html">Home</a></body></html>');
  await writeFile(path.join(dir, 'guide', 'index.html'), '<html><head><style>.guide { background: url("../guide-bg.svg"); }</style></head><body><h1>Guide</h1><a href="../about.html">About</a></body></html>');
  await writeFile(path.join(dir, 'guide-bg.svg'), '<svg>guide background</svg>');

  const result = await compile(path.join(dir, 'index.html'), { outdir: path.join(dir, 'out') });

  assert.equal(result.html, path.join(dir, 'out', 'index.html'));
  assert.match(await readFile(path.join(dir, 'out', 'about.html'), 'utf8'), /<h1>About<\/h1>/);
  assert.match(await readFile(path.join(dir, 'out', 'guide', 'index.html'), 'utf8'), /<h1>Guide<\/h1>/);
  assert.match(await readFile(path.join(dir, 'out', 'guide-bg.svg'), 'utf8'), /guide background/);
});

test('copies local assets and assets referenced by copied CSS', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  await mkdir(path.join(dir, 'images'), { recursive: true });
  await mkdir(path.join(dir, 'downloads'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<html><head><link rel="stylesheet" href="./assets/site.css"></head><body><slot src="./child.html" /><img src="./images/logo.svg"><a href="./downloads/guide.pdf">Download</a></body></html>');
  await writeFile(path.join(dir, 'child.html'), '<style>.card { background-image: url("./images/component.svg"); }</style><p>Child</p>');
  await writeFile(path.join(dir, 'assets', 'site.css'), '.hero { background-image: url("../images/background.svg"); }');
  await writeFile(path.join(dir, 'images', 'logo.svg'), '<svg>logo</svg>');
  await writeFile(path.join(dir, 'images', 'background.svg'), '<svg>background</svg>');
  await writeFile(path.join(dir, 'images', 'component.svg'), '<svg>component</svg>');
  await writeFile(path.join(dir, 'downloads', 'guide.pdf'), 'pdf bytes');

  await compile(path.join(dir, 'index.html'), { outdir: path.join(dir, 'out') });

  assert.match(await readFile(path.join(dir, 'out', 'assets', 'site.css'), 'utf8'), /background\.svg/);
  assert.match(await readFile(path.join(dir, 'out', 'images', 'logo.svg'), 'utf8'), /logo/);
  assert.match(await readFile(path.join(dir, 'out', 'images', 'background.svg'), 'utf8'), /background/);
  assert.match(await readFile(path.join(dir, 'out', 'images', 'component.svg'), 'utf8'), /component/);
  assert.equal(await readFile(path.join(dir, 'out', 'downloads', 'guide.pdf'), 'utf8'), 'pdf bytes');
});

test('preserves the entry HTML filename in the output', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entry = path.join(dir, 'about.html');
  await writeFile(entry, '<html><body><h1>About</h1></body></html>');

  const result = await compile(entry, { outdir: path.join(dir, 'out') });

  assert.equal(result.html, path.join(dir, 'out', 'about.html'));
  assert.match(await readFile(result.html, 'utf8'), /<h1>About<\/h1>/);
});

test('transpiles inline script type=ts blocks in HTML', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'index.html'), '<html><body><script type=\"ts\">interface Message { text: string } const message: Message = { text: \'ready\' }; console.log(message.text);</script></body></html>');
  const result = await compile(path.join(dir, 'index.html'), { outdir: path.join(dir, 'out') });
  const output = await readFile(result.html, 'utf8');
  assert.doesNotMatch(output, /interface Message|message\s*:\s*Message|text\s*:\s*string/);
  assert.match(output, /console\.log/);
  assert.doesNotMatch(output, /type=\"ts\"/);
});

test('store runtime internals do not collide with component script names', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entry = path.join(dir, 'index.html');
  await writeFile(entry, '<html><body><slot src="./component.ts" type="script" /></body></html>');
  await writeFile(path.join(dir, 'component.ts'), "const current = 23; const storageKey = 'component'; const persist = () => {}; const listeners = []; store.init({ counter: current }); document.body.dataset.counter = String(store.value.counter);");

  const result = await compile(entry, { outdir: path.join(dir, 'out') });
  const html = await readFile(result.html, 'utf8');
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);

  const dom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only' });
  dom.window.eval(script.replace(/export\s*\{[^}]*\};?\s*$/, ''));
  assert.equal(dom.window.document.body.dataset.counter, '23');
  dom.window.close();
});

test('store.init fills missing fields and preserves restored values', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entry = path.join(dir, 'index.html');
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'store-test-app' }));
  await writeFile(entry, '<html><body><script type="ts">store.init({ ...store.value, counter: 0 }); document.body.dataset.counter = String(store.value.counter);</script></body></html>');
  const result = await compile(entry, { outdir: path.join(dir, 'out') });
  const html = await readFile(result.html, 'utf8');
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const executable = script.replace(/export\s*\{[^}]*\};?\s*$/, '');

  const emptyStoreDom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only' });
  emptyStoreDom.window.eval(executable);
  assert.equal(emptyStoreDom.window.document.body.dataset.counter, '0');
  assert.deepEqual(JSON.parse(emptyStoreDom.window.sessionStorage.getItem('vitemple-store:store-test-app')), { counter: 0 });
  emptyStoreDom.window.close();

  const restoredStoreDom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only' });
  restoredStoreDom.window.sessionStorage.setItem('vitemple-store:store-test-app', JSON.stringify({ counter: 12 }));
  restoredStoreDom.window.eval(executable);
  assert.equal(restoredStoreDom.window.document.body.dataset.counter, '12');
  assert.deepEqual(JSON.parse(restoredStoreDom.window.sessionStorage.getItem('vitemple-store:store-test-app')), { counter: 12 });
  restoredStoreDom.window.close();
});

test('reports circular slots', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'a.html'), '<slot src="./b.html" />'); await writeFile(path.join(dir, 'b.html'), '<slot src="./a.html" />');
  await assert.rejects(compile(path.join(dir, 'a.html'), { outdir: path.join(dir, 'out') }), /Circular component import/);
});

test('copies relative script imports into dist', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'index.html'), '<slot src="./scripts/main.ts" type="script" />');
  await mkdir(path.join(dir, 'scripts'), { recursive: true });
  await writeFile(path.join(dir, 'scripts/main.ts'), "import { value } from './lib/value.js'; console.log(value);");
  await mkdir(path.join(dir, 'scripts/lib'), { recursive: true });
  await writeFile(path.join(dir, 'scripts/lib/value.js'), 'export const value = 1;');
  await compile(path.join(dir, 'index.html'), { outdir: path.join(dir, 'out') });
  await access(path.join(dir, 'out/scripts/lib/value.js'));
  await assert.rejects(access(path.join(dir, 'out/scripts/main.ts')));
});

test('transpiles imported TypeScript and rewrites extension', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'index.html'), '<slot src="./main.ts" type="script" />');
  await writeFile(path.join(dir, 'main.ts'), "import { value } from './extra.ts'; console.log(value);");
  await writeFile(path.join(dir, 'extra.ts'), 'export const value: number = 42;');
  await compile(path.join(dir, 'index.html'), { outdir: path.join(dir, 'out') });
  const output = await readFile(path.join(dir, 'out', 'extra.js'), 'utf8');
  assert.match(output, /const value = 42/);
  assert.match(await readFile(path.join(dir, 'out', 'index.html'), 'utf8'), /\.\/extra\.js/);
});

test('substitutes slot params through child markup', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'index.html'), '<slot src="./child.html" test="123" />');
  await writeFile(path.join(dir, 'child.html'), '<article id="{ test }"><span>{test}</span></article>');
  const result = await compile(path.join(dir, 'index.html'), { outdir: path.join(dir, 'out') });
  const output = await readFile(result.html, 'utf8');
  assert.match(output, /<article id="123">[\s\S]*<span>[\s\S]*123[\s\S]*<\/span>/);
});

test('passes every slot attribute as a substitution', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'index.html'), '<slot src="./card.html" test="Hello" moreParams="More" />');
  await writeFile(path.join(dir, 'card.html'), '<h2>{test}</h2><p>{ moreParams }</p><small>{src}</small>');
  const result = await compile(path.join(dir, 'index.html'), { outdir: path.join(dir, 'out') });
  assert.match(await readFile(result.html, 'utf8'), /Hello[\s\S]*More[\s\S]*\.\/card\.html/);
});

test('does not substitute params inside style blocks', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'index.html'), '<head></head><slot src="./card.html" test="red" /><slot src="./card.html" test="blue" />');
  await writeFile(path.join(dir, 'card.html'), '<style>.x { color: {test}; }</style><p>{test}</p>');
  const result = await compile(path.join(dir, 'index.html'), { outdir: path.join(dir, 'out') });
  const output = await readFile(result.html, 'utf8');
  assert.equal((output.match(/data-source="card.html"/g) ?? []).length, 1);
  assert.match(output, /color:\{test\}/);
  assert.match(output, /red/); assert.match(output, /blue/);
});

test('emits reusable native templates', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'index.html'), '<main><slot src="./card.html" type="template" name="card" data-kind="person" test="yes" /></main>');
  await writeFile(path.join(dir, 'card.html'), '<article><h2>{test}</h2></article>');
  const result = await compile(path.join(dir, 'index.html'), { outdir: path.join(dir, 'out') });
  const output = await readFile(result.html, 'utf8');
  assert.match(output, /<template data-source="card.html" id="card" name="card" data-kind="person" test="yes">[\s\S]*<article>/);
  assert.doesNotMatch(output, /<template[^>]+\bsrc=/);
  assert.doesNotMatch(output, /<template[^>]+\btype=/);
  assert.match(output, /<\/template>\s*<\/main>/);
});

test('keeps unknown placeholders for runtime replacement', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'index.html'), '<slot src="./card.html" type="template" />');
  await writeFile(path.join(dir, 'card.html'), '<p>{value}</p>');
  const result = await compile(path.join(dir, 'index.html'), { outdir: path.join(dir, 'out') });
  assert.match(await readFile(result.html, 'utf8'), /\{value\}/);
});

test('moves template scripts out and emits them once before body end', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'index.html'), '<body><slot src="./card.html" type="template" name="card" /><slot src="./card.html" type="template" name="card2" /></body>');
  await writeFile(path.join(dir, 'card.html'), '<article>Card</article><script>console.log("card");</script>');
  const result = await compile(path.join(dir, 'index.html'), { outdir: path.join(dir, 'out') });
  const output = await readFile(result.html, 'utf8');
  assert.equal((output.match(/console\.log\("card"\)/g) ?? []).length, 1);
  assert.match(output, /<\/template>[\s\S]*<script type="module">[\s\S]*DOMContentLoaded[\s\S]*console\.log/);
  assert.ok(output.indexOf('console.log') < output.indexOf('</body>'));
});
