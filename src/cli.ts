#!/usr/bin/env node
/**
 * Runs the Vitemple command-line build. It validates command arguments, prepares the output directory, and delegates page compilation to the compiler module.
 */
import { compile } from "./compiler.js";
import { rm } from "node:fs/promises";
import path from "node:path";

// ----------------------------------------------------------------- CLI argument validation and build execution
const [entry, ...args] = process.argv.slice(2);
let outdir = "build";
let invalid = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--outdir" && args[index + 1]) {
    outdir = args[++index];
  } else {
    invalid = true;
  }
}

if (!entry || invalid) {
  console.error("Usage: node dist/cli.js <entry.html> [--outdir <directory>]");
  process.exitCode = 1;
} else {
  try {
    const outputDirectory = path.resolve(outdir);
    await rm(outputDirectory, { recursive: true, force: true });
    const result = await compile(entry, { outdir: outputDirectory });
    console.log(`Built ${result.html}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
