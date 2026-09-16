import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { compile } from '../dist/compiler.js';

test('keeps HTML, expands slots, moves styles, transpiles scripts', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><html><head></head><body><main><slot src="./child.html" /></main></body></html>');
  await writeFile(path.join(dir, 'child.html'), '<style>p { color: red }</style><script lang="ts">const n: number = 1;</script><p>Child</p>');
  const result = await compile(path.join(dir, 'index.html'), { outdir: path.join(dir, 'out') });
  const output = await readFile(result.html, 'utf8');
  assert.match(output, /<style data-source="child.html">\n\s+p \{ color: red \}\n\s+<\/style>/);
  assert.match(output, /<script data-temple-scoped="true">\n\s*\(\(\) =>/);
  assert.match(output, /<p>\s*Child\s*<\/p>/); assert.doesNotMatch(output, /<slot/);
  assert.match(output, /^<!doctype html>\s*<html>\s*<head>\s*<style data-source="child.html">/i);
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
  assert.match(output, /color: \{test\}/);
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
  assert.match(output, /<\/template>[\s\S]*<script>[\s\S]*DOMContentLoaded[\s\S]*console\.log/);
  assert.ok(output.indexOf('console.log') < output.indexOf('</body>'));
});
