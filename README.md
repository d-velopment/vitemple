# Vitemple

[![npm version](https://img.shields.io/npm/v/vitemple?style=flat-square&color=2563eb)](https://www.npmjs.com/package/vitemple)
[![Vitemple powered](https://img.shields.io/badge/Vitemple-powered-2563eb?style=flat-square&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgYXJpYS1sYWJlbD0iVml0ZW1wbGUgbWFyayI%2BCgk8cGF0aCBkPSJNMS4yIDEuMmg0NS42TDI0IDQ2LjggMS4yIDEuMloiIGZpbGw9IiNmZmYiLz4KCTxwYXRoIGQ9Ik0xIDI0IDE4IDEzdjIyTDEgMjRaIiBmaWxsPSIjZmZmIi8%2BCgk8cGF0aCBkPSJtNDcgMjQtMTctMTF2MjJsMTctMTFaIiBmaWxsPSIjZmZmIi8%2BCjwvc3ZnPgo%3D)](https://github.com/d-velopment/vitemple)
[![Vite](https://img.shields.io/badge/Vite-powered-646cff?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-first-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Native DOM](https://img.shields.io/badge/rendering-native%20DOM-0f766e?style=flat-square)](#design-principles)
[![License](https://img.shields.io/badge/license-MIT-f59e0b?style=flat-square)](./LICENSE)

Vitemple lets you build static reactive multi-page sites with TypeScript-based HTML files, reusable components and native browser APIs.

[Read the full documentation →](https://d-velopment.github.io/vitemple/)

## Design principles

- **Native HTML output.** Vitemple does not create a virtual DOM or replace authored document structure.
- **Build-time composition.** HTML, CSS, and TypeScript slots are resolved recursively during compilation.
- **Multi-page builds.** Local page links are followed from the entry document, with each reachable page emitted to its matching output path.
- **TypeScript-first workflow.** TypeScript scripts are transpiled with Vite's esbuild transform.
- **ES modules.** Component scripts are combined into one minified `type="module"` script.
- **Scoped CSS.** Each component style is installed once in the document `<head>` and tagged with its source filename.
- **Minimal runtime.** Reactivity is opt-in through a single page-level `store`, available among all the components from the box.

## Installation

Install Vitemple in an application project:

```sh
npm install vitemple
```

On a brand new project you will receive a `src/index.html` that imports `src/components/hello.html` through a slot. Existing files are left unchanged. It also adds `start`, `dev`, and `build` scripts if they are not present in `package.json`.

The example project is available in the separate [vitemple-example GitHub repository](https://github.com/d-velopment/vitemple-example):

```sh
git clone https://github.com/d-velopment/vitemple-example.git
cd vitemple-example/basic
npm install
```

## Build and development

For the example project:

```sh
npm run build   # compile src/index.html into dist/index.html
npm run dev     # Vite server, rebuild on src changes, browser full reload
npm start       # serve generated dist with Vite Preview
```

For another local project, pass its path to the same watcher:

```sh
npm run dev:project -- /absolute/path/to/your-project
```

The command builds Vitemple, temporarily replaces that project's `node_modules/vitemple` with a link to this checkout, and launches the project's `npm run dev`. Saving Vitemple source rebuilds the package and restarts the target dev server. Press `Ctrl+C` to restore the original npm-installed package; the target `package.json` and lock file are never changed.

## Component syntax

Components are ordinary HTML files. Slots import HTML fragments or external assets:

```html
<main>
  <slot src="./components/card.html" title="Hello" />
  <slot src="./style.css" type="css" />
  <slot src="./scripts.ts" type="script" />
</main>
```

HTML slots are expanded recursively. Every slot attribute is available as a substitution in the imported fragment: `title="Hello"` replaces `{title}` and `{ title }`. The `src` and `type` attributes are available in the same way. Substitution happens before HTML, style, and script processing. Unknown placeholders remain unchanged for runtime use.

CSS slots are deduplicated, minified, and inserted into the authored `<head>` as `<style data-source="...">`. TypeScript slots are transpiled, relative imports are copied into `dist`, and bare package imports are bundled into the page module. `.ts` import extensions are rewritten to `.js`.

## Reusable templates

Use `type="template"` for markup that should be cloned at runtime:

```html
<slot src="./components/page.html" type="template" name="page" />
```

Vitemple emits a native `<template>` element. Its attributes include the source filename, optional `name`, and all passed slot attributes except `src`, `type`, and `name`:

```ts
const template = document.querySelector<HTMLTemplateElement>('#page');
const fragment = template?.content.cloneNode(true) as DocumentFragment;
container?.append(fragment);
```

Scripts inside a template are extracted and emitted once before `</body>`, wrapped in `DOMContentLoaded`. They do not run once per clone.

## Reactive store

The generated module provides one page-level store. Use `init` to supply defaults without overwriting values already restored from `sessionStorage`:

```ts
store.init({ ...store.value, counter: 0 });

store.subscribe((state) => {
  document.title = `Counter: ${state.counter}`;
});

store.update((state) => ({
  ...state,
  counter: state.counter + 1,
}));
```

The TypeScript declaration for the built-in `store` is included with the package and is loaded automatically when your project extends `vitemple/tsconfig.json`. Add your application files to `include`; no manual declaration-file reference is needed.

## Output

The compiler preserves the authored doctype and document elements. It does not synthesize `<html>`, `<head>`, or `<body>`. The generated HTML is compacted to one line; CSS and the combined module script are minified for delivery.

When building Vitemple itself, all emitted JavaScript modules in `dist`, including subdirectories, are minified through Vite's esbuild transform. Module paths and public exports are preserved. The test command runs against this minified output.

## File packs

The optional browser-native file pack utility combines named `Blob` or `File` objects into one uncompressed `.vpack` file. It has no runtime dependencies and is imported separately from the compiler.

In the **Pack** tab, select or drop files, choose a pack name, and download the result. In **Unpack**, drop one `.vpack` file to list its contents, download individual files, or choose **Download all**. Files are processed locally in the browser.

```ts
import {
  createFilePack,
  fetchFilePack,
} from "vitemple/file-pack";

const pack = createFilePack([
  { name: "level.json", blob: new Blob(['{"level":1}'], { type: "application/json" }) },
]);

for await (const { name, blob } of fetchFilePack("./files.vpack")) {
  console.log(name, blob.size);
}
```

`readFilePack` also accepts a local `Blob` or `ReadableStream<Uint8Array>`. Each file is yielded as soon as all its bytes arrive, in pack order. Media decoding, object URLs, and texture or audio cleanup remain the application's responsibility. See the [file pack documentation](./src/file-pack/README.md) for limits, cancellation, progress, and the container format.

## License

Vitemple is released under the [MIT License](./LICENSE).
