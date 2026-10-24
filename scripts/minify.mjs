/**
 * Minifies every emitted JavaScript module under Vitemple's dist directory using
 * the esbuild transform provided by the installed Vite dependency. This runs
 * after TypeScript compilation, preserves module paths and public exports, and
 * leaves declaration files alone. It removes code comments without bundling
 * dependencies; native CLI shebangs are retained by the transform. Filesystem or
 * transform failures propagate so build and test commands fail instead of
 * publishing partially processed output.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transformWithEsbuild } from "vite";

// ----------------------------------------------------------------- Recursive JavaScript minification
// Processes compiled modules in place, including nested utility directories, using the compiler's ES2022 target.
async function minifyDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await minifyDirectory(new URL(`${entry.name}/`, directory));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      const file = new URL(entry.name, directory);
      const source = await readFile(file, "utf8");
      const result = await transformWithEsbuild(source, fileURLToPath(file), {
        target: "es2022",
        format: "esm",
        minify: true,
        legalComments: "none",
        sourcemap: false,
      });
      await writeFile(file, result.code);
    }

  }
}

// ----------------------------------------------------------------- Build output processing
await minifyDirectory(new URL("../dist/", import.meta.url));
