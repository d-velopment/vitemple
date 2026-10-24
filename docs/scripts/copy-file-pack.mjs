/**
 * Copies the installed Vitemple file-pack browser module into the documentation's
 * local assets before build or dev starts. The copy is ignored by version control
 * and lets packer.js use a relative browser import on static hosts. Both modules
 * are copied unchanged by Vitemple; this step performs no bundling, transpilation,
 * or minification. Missing or unbuilt package modules fail the command directly.
 */
import { copyFile } from "node:fs/promises";

// ----------------------------------------------------------------- Local browser dependency
await copyFile(
  new URL(import.meta.resolve("vitemple/file-pack")),
  new URL("../src/assets/file-pack.js", import.meta.url),
);
