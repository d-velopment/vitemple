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

CSS is inserted once per compilation in `<head>`. TypeScript script slots are transpiled by Vite's esbuild transform and emitted as module scripts. HTML is intentionally not interpreted: expressions, attributes, and event handlers remain exactly as authored for the browser. `params` is accepted syntactically for forward compatibility but is not evaluated in this static mode.

The generated file is pretty-printed with two-space indentation for easier inspection. Formatting changes whitespace between elements but does not add document elements or a doctype.

The implementation lives in [`src/compiler.ts`](src/compiler.ts); the runnable parent/child example is in [`examples/basic`](examples/basic).
