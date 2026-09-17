import { createServer } from 'vite';
import { compile } from './dist/compiler.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, 'src');
const entry = path.join(sourceRoot, 'index.html');
const outdir = path.join(projectRoot, 'dist');

const server = await createServer({
  root: sourceRoot,
  plugins: [{
    name: 'temple-live-build',
    async transformIndexHtml() {
      const result = await compile(entry, { outdir });
      const html = await readFile(result.html, 'utf8');
      const viteClient = '<script type="module" src="/@vite/client"></script>';
      return /<head\b[^>]*>/i.test(html)
        ? html.replace(/(<head\b[^>]*>)/i, `$1${viteClient}`)
        : `${viteClient}${html}`;
    },
    configureServer(viteServer) {
      viteServer.watcher.add(sourceRoot);
      viteServer.watcher.on('change', async (file) => {
        if (!file.startsWith(sourceRoot)) return;
        try {
          await compile(entry, { outdir });
          viteServer.ws.send({ type: 'full-reload' });
        } catch (error) {
          viteServer.ws.send({ type: 'error', err: { message: String(error) } });
        }
      });
    },
  }],
});

await server.listen();
server.printUrls();
