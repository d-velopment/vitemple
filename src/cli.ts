#!/usr/bin/env node
import { compile } from './compiler.js';

const [entry, flag, outdir] = process.argv.slice(2);
if (!entry || (flag && flag !== '--outdir') || (flag && !outdir)) {
  console.error('Usage: node dist/cli.js <component.html> [--outdir <directory>]');
  process.exitCode = 1;
} else {
  try {
    const result = await compile(entry, { outdir: outdir ?? 'build' });
    console.log(`Built ${result.html}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
