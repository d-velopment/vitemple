# Vitemple documentation

The documentation is built with Vitemple itself. Each page imports the shared header, footer and counter components through `<slot>`. The live counters use the generated shared `store`.

Install the documentation dependencies (including Vitemple from npm):

```sh
cd docs
npm ci
npm run dev
```

Production:

```sh
npm run build
npm test
npm run preview
```

Upload the contents of `docs/dist/` to any static host. All local links and assets use relative URLs, so the output also works under a subdirectory. Content and navigation work without JavaScript; JavaScript enables copy buttons and the live store demo. No remote fonts or image services are required.

`src/index.html` is the landing page. `src/getting-started`, `src/components/index.html` and `src/store` provide the guides. Shared partials live in `src/components/`; assets live in `src/assets/`.

The docs builder imports `compile` from the published `vitemple` npm dependency and compiles each page. It does not copy or compile framework sources. Code samples encode whitespace as HTML entities to preserve indentation through HTML minification. `components/index.html` is explicitly built alongside the other pages; the remaining files in that folder are partials.
