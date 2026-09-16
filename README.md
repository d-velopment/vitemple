# Temple

Temple is a tiny TypeScript/Vite component preprocessor. It keeps authored HTML as HTML. A `<slot src="./child.html" />` is replaced by the child fragment recursively; child styles are collected into the output document `<head>`, and scripts stay at the slot location inside `<script>` tags. No virtual DOM is generated.

```sh
npm install
npm run dev       # Vite development example
npm run example   # writes examples/basic/dist/index.html
npm test
```

Components may contain ordinary HTML, inline `<style>`, and `<script lang="ts">`. External assets use slots:

```html
<slot src="./child.html" />
<slot src="./style.css" type="css" />
<slot src="./analytics.ts" type="script" />
```

CSS is inserted once per compilation in `<head>`. TypeScript script slots are transpiled by Vite's esbuild transform and emitted as module scripts. HTML is kept as authored. Every slot attribute becomes a static substitution variable in the imported fragment: `test="Hello"` makes `{test}` or `{ test }` become `Hello`; `src` and `type` are available the same way. Values are not reactive. Substitution happens before HTML parsing, so it also works inside `<script>` and `<style>` blocks.

The generated file is pretty-printed with two-space indentation for easier inspection. Formatting changes whitespace between elements but does not add document elements or a doctype.

The implementation lives in [`src/compiler.ts`](src/compiler.ts); the runnable parent/child example is in [`examples/basic`](examples/basic).

`type="template"` emits a hidden native `<template>` element. Use `template.content.cloneNode(true)` to create repeated instances. Scripts inside a template do not execute automatically; initialize each clone explicitly after insertion.
