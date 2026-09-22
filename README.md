# Vitemple

[![npm version](https://img.shields.io/npm/v/vitemple?style=flat-square&color=2563eb)](https://www.npmjs.com/package/vitemple)
[![TypeScript](https://img.shields.io/badge/TypeScript-first-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-powered-646cff?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Native DOM](https://img.shields.io/badge/rendering-native%20DOM-0f766e?style=flat-square)](#design-principles)
[![License](https://img.shields.io/badge/license-MIT-f59e0b?style=flat-square)](./LICENSE)

Vitemple is a lightweight, reactive, TypeScript-first component compiler for native HTML and the DOM. It preserves authored markup and expands reusable `<slot>` imports at build time. Starting from one entry page—usually `index.html`—Vitemple follows local links to reachable HTML pages, copies their referenced assets, and emits the pages under matching paths. The result is compact, browser-ready HTML with native DOM APIs, scoped component styles, one bundled module script, and in-box reactivity through a shared `store`.

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

The example project is available in the separate [vitemple-example GitHub repository](https://github.com/d-velopment/vitemple-example):

```sh
git clone https://github.com/d-velopment/vitemple-example.git
cd vitemple-example/basic
npm install
```

## Build and development

Build a site from its HTML entry page with the CLI:

```sh
vitemple src/index.html --outdir dist
```

The CLI clears the output directory, compiles the entry page, then follows relative local `<a href>` links—including links inside expanded slots—to find other HTML pages. Each reachable page is emitted at its linked path: `about.html` becomes `dist/about.html`, while `guide/` resolves to `dist/guide/index.html`. External URLs and fragments are left untouched. Local assets referenced by markup, linked stylesheets, and component styles are copied with their relative paths preserved.

The package also includes a Vite development server for projects that use `src/index.html` and `dist` by default. It watches source files, rebuilds the linked pages and assets, and reloads the browser:

```sh
node node_modules/vitemple/scripts/dev.mjs
```

Pass an entry path before any options to use a different entry, for example `node node_modules/vitemple/scripts/dev.mjs app/index.html --outdir build`.

For the example project:

```sh
npm run build   # compile src/index.html into dist/index.html
npm run dev     # Vite server, rebuild on src changes, browser full reload
npm start       # serve generated dist with Vite Preview
```

To develop Vitemple against the documentation site, run this from the Vitemple repository:

```sh
npm run dev:docs
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

CSS slots are deduplicated, minified, and inserted into the authored `<head>` as `<style data-source="...">`. TypeScript slots are transpiled and their relative imports are copied into `dist`; `.ts` import extensions are rewritten to `.js`.

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

## License

Vitemple is released under the [MIT License](./LICENSE).
