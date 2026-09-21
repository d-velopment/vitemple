import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { compile } from 'vitemple';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const root = fileURLToPath(new URL('..', import.meta.url));
export async function build() {
  const source = path.join(root, 'src');
  const output = path.join(root, 'dist');
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory() && !['components','assets'].includes(item.name)) await walk(file);
      else if (item.name === 'index.html') await compile(file, { outdir: path.join(output, path.relative(source, dir)) });
    }
  }
  await walk(source);
  await compile(path.join(source, 'components/index.html'), { outdir: path.join(output, 'components') });
  await cp(path.join(source, 'assets'), path.join(output, 'assets'), { recursive: true, filter: file => !file.endsWith('.ts') });
  console.log('Documentation built in docs/dist');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
