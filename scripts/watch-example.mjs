import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve('examples');
let timer;
let running = false;
let queued = false;

function buildExample() {
  if (running) { queued = true; return; }
  running = true;
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'example'], { stdio: 'inherit' });
  child.on('close', () => {
    running = false;
    if (queued) { queued = false; buildExample(); }
  });
}

buildExample();
watch(root, { recursive: true }, (_event, filename) => {
  if (!filename || filename.split(path.sep).includes('dist')) return;
  clearTimeout(timer);
  timer = setTimeout(buildExample, 120);
});
console.log(`Watching ${root} (dist folders are ignored)`);
