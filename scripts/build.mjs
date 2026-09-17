import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const packageFile = new URL('../package.json', import.meta.url);
const packageJson = JSON.parse(await readFile(packageFile, 'utf8'));
const versionParts = String(packageJson.version ?? '0.0.0').split('.');
versionParts[2] = String(Number(versionParts[2] ?? 0) + 1);
packageJson.version = versionParts.join('.');
await writeFile(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`);

const lockFile = new URL('../package-lock.json', import.meta.url);
try {
  const lockJson = JSON.parse(await readFile(lockFile, 'utf8'));
  lockJson.version = packageJson.version;
  if (lockJson.packages?.['']) lockJson.packages[''].version = packageJson.version;
  await writeFile(lockFile, `${JSON.stringify(lockJson, null, 2)}\n`);
} catch {}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(command, ['tsc'], { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
