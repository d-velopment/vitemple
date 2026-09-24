import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.env.INIT_CWD;
if (!projectRoot || path.resolve(projectRoot) === path.resolve(new URL('..', import.meta.url).pathname)) process.exit(0);

const sourceDirectory = path.join(projectRoot, 'src');
const entryFile = path.join(sourceDirectory, 'index.html');
let createdStarter = false;
try {
	await access(entryFile);
} catch {
	await mkdir(sourceDirectory, { recursive: true });
	await writeFile(entryFile, `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<link rel="icon" href="./favicon.svg" type="image/svg+xml" />
		<title>Hello, Vitemple</title>
		<style>
			html,
			body {
				margin: 0;
				min-height: 100%;
			}
			body {
				min-height: 100vh;
				background: antiquewhite;
				display: grid;
				place-items: center;
			}
		</style>
	</head>
	<body>
		<div>
			<slot src="./components/hello.html" />
		</div>
	</body>
</html>
`);
	createdStarter = true;
	console.log(`Vitemple: created ${path.relative(projectRoot, entryFile)}`);
}

if (createdStarter) {
	const faviconFile = path.join(sourceDirectory, 'favicon.svg');
	await copyFile(new URL('../favicon.svg', import.meta.url), faviconFile);
	console.log(`Vitemple: created ${path.relative(projectRoot, faviconFile)}`);
	const componentDirectory = path.join(sourceDirectory, 'components');
	const componentFile = path.join(componentDirectory, 'hello.html');
	await mkdir(componentDirectory, { recursive: true });
	await writeFile(componentFile, `<style>
	h1 {
		font-family: sans-serif;
		transition: color 500ms ease;
	}
</style>

<h1>Hello, world!</h1>

<script type="ts">
	const title: HTMLHeadingElement | null = document.querySelector('h1');
	const colors = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a'] as const;

	setInterval(() => {
		if (title) title.style.color = colors[Math.floor(Math.random() * colors.length)];
	}, 1000);
</script>
`);
	console.log(`Vitemple: created ${path.relative(projectRoot, componentFile)}`);
}

const packageFile = path.join(projectRoot, 'package.json');
let packageJson;
try {
	packageJson = JSON.parse(await readFile(packageFile, 'utf8'));
} catch (error) {
	if (error.code !== 'ENOENT') throw error;
	const frameworkPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
	packageJson = {
		name: path.basename(projectRoot),
		version: '1.0.0',
		description: '',
		main: 'index.js',
		scripts: {},
		keywords: [],
		author: '',
		license: 'ISC',
		dependencies: { vitemple: `^${frameworkPackage.version}` },
	};
}
const scripts = packageJson.scripts ?? {};
const defaults = {
	start: 'npm run build && node node_modules/vitemple/scripts/preview.mjs',
	dev: 'node node_modules/vitemple/scripts/dev.mjs',
	build: 'vitemple src/index.html --outdir dist',
};
const nextScripts = {};
let changed = false;
for (const [name, command] of Object.entries(defaults)) {
	const previousVitempleStart = 'node node_modules/vitemple/scripts/preview.mjs';
	if (name === 'start' && scripts[name] === previousVitempleStart) {
		nextScripts[name] = command;
		changed = true;
	} else {
		nextScripts[name] = scripts[name] ?? command;
		if (!scripts[name]) changed = true;
	}
}
for (const [name, command] of Object.entries(scripts)) {
	if (!(name in defaults)) nextScripts[name] = command;
}
if (changed) {
	packageJson.scripts = nextScripts;
	await writeFile(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`);
	console.log('Vitemple: added start, dev, and build scripts to package.json');
}
