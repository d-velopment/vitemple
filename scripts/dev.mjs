import { createServer } from 'vite';
import { compile } from '../dist/compiler.js';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const args = process.argv.slice(2);
const entryArgument = args.find((arg) => !arg.startsWith('--')) ?? 'src/index.html';
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};
const entry = path.resolve(projectRoot, entryArgument);
const sourceRoot = path.dirname(entry);
const outdir = path.resolve(projectRoot, valueAfter('--outdir', 'dist'));
const host = valueAfter('--host', '127.0.0.1');
const isWithin = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

async function rebuild() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await compile(entry, { outdir });
}

await rebuild();

const server = await createServer({
  configFile: false,
  root: outdir,
  server: { host, watch: { ignored: [outdir] } },
});
server.watcher.add(sourceRoot);

let timer;
let running = false;
let pending = false;
async function scheduleRebuild() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  try {
    await rebuild();
    server.moduleGraph.invalidateAll();
    server.ws.send({ type: 'full-reload', path: '*' });
  } catch (error) {
    console.error(error);
    server.ws.send({ type: 'error', err: { message: String(error), stack: '' } });
  } finally {
    running = false;
    if (pending) {
      pending = false;
      await scheduleRebuild();
    }
  }
}

server.watcher.on('all', (event, file) => {
  if (!['add', 'change', 'unlink'].includes(event)) return;
  const changedFile = path.resolve(file);
  if (!isWithin(sourceRoot, changedFile) || isWithin(outdir, changedFile)) return;
  clearTimeout(timer);
  timer = setTimeout(() => { void scheduleRebuild(); }, 150);
});

await server.listen();
server.printUrls();
