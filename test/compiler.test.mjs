import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { compile } from '../dist/compiler.js';

test('keeps HTML, expands slots, moves styles, transpiles scripts', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><html><head></head><body><main><slot src="./child.html" /></main></body></html>');
  await writeFile(path.join(dir, 'child.html'), '<style>p { color: red }</style><script lang="ts">const n: number = 1;</script><p>Child</p>');
  const result = await compile(path.join(dir, 'index.html'), { outdir: path.join(dir, 'out') });
  const output = await readFile(result.html, 'utf8');
  assert.match(output, /<style>\n\s+p \{ color: red \}\n\s+<\/style>/);
  assert.match(output, /<script type="module">\n\s+const n = 1;/);
  assert.match(output, /<p>\s*Child\s*<\/p>/); assert.doesNotMatch(output, /<slot/);
  assert.match(output, /^<!doctype html>\s*<html>\s*<head>\s*<style>/i);
});

test('reports circular slots', async t => {
  const dir = await mkdtemp(path.resolve('.temple-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'a.html'), '<slot src="./b.html" />'); await writeFile(path.join(dir, 'b.html'), '<slot src="./a.html" />');
  await assert.rejects(compile(path.join(dir, 'a.html'), { outdir: path.join(dir, 'out') }), /Circular component import/);
});
