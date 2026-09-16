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
