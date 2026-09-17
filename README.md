# Vitemple

[![npm version](https://img.shields.io/npm/v/vitemple?style=flat-square&color=2563eb)](https://www.npmjs.com/package/vitemple)
[![TypeScript](https://img.shields.io/badge/TypeScript-first-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-powered-646cff?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Native DOM](https://img.shields.io/badge/rendering-native%20DOM-0f766e?style=flat-square)](#design-principles)
[![License](https://img.shields.io/badge/license-MIT-f59e0b?style=flat-square)](./LICENSE)

Vitemple is a lightweight reactive TypeScript-first component preprocessor for native HTML and the DOM. It keeps authored markup intact and expands reusable `<slot>` imports at build time. The result is a compact, browser-ready `index.html` with native DOM APIs, scoped component styles, one bundled module script, and in-box reactivity through a shared `store`.

## Design principles

- **Native HTML output.** Vitemple does not create a virtual DOM or replace authored document structure.
- **Build-time composition.** HTML, CSS, and TypeScript slots are resolved recursively during compilation.
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

Build a component entry file with the CLI:

```sh
vitemple src/index.html --outdir dist
```

For the example project:

```sh
npm run build   # compile src/index.html into dist/index.html
npm run dev     # Vite server, rebuild on src changes, browser full reload
npm start       # serve generated dist with Vite Preview
```

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

The generated module provides one page-level store:

```ts
store.set({ counter: 0 });

store.subscribe((state) => {
  document.title = `Counter: ${state.counter}`;
});

store.update((state) => ({
  ...state,
  counter: state.counter + 1,
}));
```

The TypeScript declaration for `store` is included with the package. Extend `vitemple/tsconfig.json` and include `node_modules/vitemple/src/components.d.ts` in an application configuration.

## Output

The compiler preserves the authored doctype and document elements. It does not synthesize `<html>`, `<head>`, or `<body>`. The generated HTML is compacted to one line; CSS and the combined module script are minified for delivery.

## License

Vitemple is released under the [MIT License](./LICENSE).
