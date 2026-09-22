import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rename, rm, symlink } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requestedProject = process.argv[2];
if (!requestedProject) {
  console.error('Usage: npm run dev:project -- <project-path>');
  process.exit(1);
}

const projectRoot = path.resolve(requestedProject);
const projectManifestPath = path.join(projectRoot, 'package.json');
const nodeModulesPath = path.join(projectRoot, 'node_modules');
const installedPackagePath = path.join(nodeModulesPath, 'vitemple');
const backupPath = path.join(nodeModulesPath, '.vitemple-npm-original');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const isWindows = process.platform === 'win32';

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

if (projectRoot === frameworkRoot) throw new Error('Choose an application project, not the Vitemple repository itself.');
if (!(await exists(projectManifestPath))) throw new Error(`No package.json found in ${projectRoot}`);
const projectManifest = JSON.parse(await readFile(projectManifestPath, 'utf8'));
if (!projectManifest.dependencies?.vitemple && !projectManifest.devDependencies?.vitemple) {
  throw new Error('The target project must keep vitemple declared in dependencies or devDependencies.');
}
if (!projectManifest.scripts?.dev) throw new Error('The target project needs an npm "dev" script so this tool can launch and restart it.');
if (!(await exists(installedPackagePath))) throw new Error(`No installed package at ${installedPackagePath}. Run npm install in the target project first.`);
if (await exists(backupPath)) throw new Error(`Backup already exists at ${backupPath}; restore it before starting another local override.`);

let packageWasMoved = false;
let linkWasCreated = false;
let devProcess;
let updating = false;
let queued = false;
let shuttingDown = false;
let stopCode = 0;
let timer;
const watchers = [];

function runNpm(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, args, {
      cwd,
      stdio: 'inherit',
      shell: isWindows,
    });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

function startProject() {
  devProcess = spawn(npmCommand, ['run', 'dev'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: isWindows,
    detached: !isWindows,
  });
  devProcess.once('error', (error) => console.error(`Could not start the target project's dev script: ${error.message}`));
  devProcess.once('exit', (code, signal) => {
    if (!shuttingDown && !updating) {
      console.log(`Target dev process exited (${signal ?? code ?? 'unknown'}); it will restart after the next Vitemple rebuild.`);
    }
  });
}

async function stopProject() {
  const child = devProcess;
  devProcess = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise((resolve) => child.once('exit', resolve));
  if (isWindows) {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    await new Promise((resolve) => killer.once('close', resolve));
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  }

  const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
  await Promise.race([exited, timeout]);
  if (child.exitCode === null && child.signalCode === null) {
    if (isWindows) {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      await new Promise((resolve) => killer.once('close', resolve));
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    await exited;
  }
}

async function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  try {
    await stopProject();
  } finally {
    try {
      if (linkWasCreated) {
        await rm(installedPackagePath, { recursive: true, force: true });
        linkWasCreated = false;
      }
    } finally {
      if (packageWasMoved) {
        await rename(backupPath, installedPackagePath);
        packageWasMoved = false;
      }
    }
  }
}

async function requestStop(code) {
  if (shuttingDown) return;
  stopCode = code;
  try { await cleanup(); }
  catch (error) { console.error(`Cleanup failed: ${error.message}`); stopCode = 1; }
  process.exit(stopCode);
}

process.once('SIGINT', () => { void requestStop(130); });
process.once('SIGTERM', () => { void requestStop(143); });

try {
  const result = await runNpm(['run', 'build'], frameworkRoot);
  if (result !== 0) throw new Error(`Vitemple build failed with exit code ${result}`);

  await mkdir(nodeModulesPath, { recursive: true });
  await rename(installedPackagePath, backupPath);
  packageWasMoved = true;
  await symlink(frameworkRoot, installedPackagePath, isWindows ? 'junction' : 'dir');
  linkWasCreated = true;

  console.log(`Using local Vitemple in ${installedPackagePath}`);
  console.log('The target package.json and lock file remain unchanged. Press Ctrl+C to restore the npm-installed package.');
  startProject();

  const scheduleRebuild = () => {
    if (shuttingDown) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void rebuildAndRestart(); }, 180);
  };
  const watchDirectory = (directory, recursive = true) => {
    watchers.push(watch(directory, { recursive }, scheduleRebuild));
  };
  for (const directory of ['src', 'scripts', 'types']) {
    const fullPath = path.join(frameworkRoot, directory);
    if (await exists(fullPath)) watchDirectory(fullPath);
  }
  watchers.push(watch(frameworkRoot, (_event, filename) => {
    if (['tsconfig.json', 'vite.config.ts'].includes(String(filename))) scheduleRebuild();
  }));

  console.log(`Watching Vitemple sources. Target project: ${projectRoot}`);
} catch (error) {
  console.error(error.message);
  await cleanup();
  process.exitCode = 1;
}

async function rebuildAndRestart() {
  if (updating || shuttingDown) { queued = true; return; }
  updating = true;
  do {
    queued = false;
    const result = await runNpm(['run', 'build'], frameworkRoot);
    if (result === 0 && !shuttingDown) {
      await stopProject();
      if (!shuttingDown) startProject();
      console.log('Vitemple rebuilt; target dev server restarted.');
    } else if (result !== 0) {
      console.error(`Vitemple rebuild failed with exit code ${result}; target server is still running with its previous loaded compiler.`);
    }
  } while (queued && !shuttingDown);
  updating = false;
}
