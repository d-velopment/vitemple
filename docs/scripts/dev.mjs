import { createServer } from 'vite';
import path from 'node:path';
import { build, root } from './build.mjs';
await build();
let timer, running = false, pending = false;
const server = await createServer({
  configFile: false,
  root: path.join(root, 'dist'),
  server: { host: '127.0.0.1', watch: { ignored: ['**/dist/**'] } },
});
server.watcher.add(path.join(root, 'src'));
async function rebuild() {
  if (running) { pending = true; return; }
  running = true;
  try { await build(); server.moduleGraph.invalidateAll(); server.ws.send({ type: 'full-reload', path: '*' }); }
  catch (error) { console.error(error); server.ws.send({ type: 'error', err: { message: String(error), stack: '' } }); }
  finally { running = false; if (pending) { pending = false; await rebuild(); } }
}
server.watcher.on('all', (event, file) => {
  if (!['add','change','unlink'].includes(event) || !file.startsWith(path.join(root, 'src') + path.sep)) return;
  clearTimeout(timer); timer = setTimeout(rebuild, 150);
});
await server.listen(); server.printUrls();
