# Temple

Temple is a tiny TypeScript/Vite component preprocessor. It keeps authored HTML as HTML. A `<slot src="./child.html" />` is replaced by the child fragment recursively; child styles are collected into the output document `<head>`, and scripts stay at the slot location inside `<script>` tags. No virtual DOM is generated.

```sh
npm install
npm run example   # builds ../temple-example/basic/src/index.html into ../temple-example/basic/dist/index.html
npm test
```

The standalone example is built from its own project after installing Temple:

```sh
cd ../temple-example/basic
npm install
npm run dev       # Vite dev server with rebuild and browser reload
```

Components may contain ordinary HTML, inline `<style>`, and `<script lang="ts">`. External assets use slots:

```html
<slot src="./child.html" />
<slot src="./style.css" type="css" />
<slot src="./analytics.ts" type="script" />
```

CSS is inserted once per compilation in `<head>`. TypeScript script slots are transpiled by Vite's esbuild transform and emitted as module scripts. HTML is kept as authored. Every slot attribute becomes a static substitution variable in the imported fragment: `test="Hello"` makes `{test}` or `{ test }` become `Hello`; `src` and `type` are available the same way. Values are not reactive. Substitution happens before HTML parsing, so it also works inside `<script>` and `<style>` blocks.

The generated file is pretty-printed with two-space indentation for easier inspection. Formatting changes whitespace between elements but does not add document elements or a doctype.

The implementation lives in [`src/compiler.ts`](src/compiler.ts). The runnable parent/child example is kept in the sibling project [`../temple-example/basic`](../temple-example/basic).

Every generated document receives one inline `type="module"` script before `</body>`. It contains the reactive runtime and all component scripts. The runtime exposes one project-wide `store` object with `{ value, set, update, subscribe }`.

`type="template"` emits a hidden native `<template>` element. Use `template.content.cloneNode(true)` to create repeated instances. Scripts inside a template do not execute automatically; initialize each clone explicitly after insertion.

The example cards demonstrate a shared reactive value through `globalThis.__templeShared`: both `+` and `−` buttons update the same counter, and each card subscription updates its own `<span>`. This is an example-level micro-runtime while the public reactive API is still being designed.
