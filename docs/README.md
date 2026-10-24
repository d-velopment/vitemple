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

Upload the contents of `docs/dist/` to any static host. All local links and assets use relative URLs, so the output also works under a subdirectory. Content and navigation work without JavaScript; JavaScript enables copy buttons, the live store demo, and Vitemple Packer. No remote fonts or image services are required.

`src/index.html` is the landing page. `src/getting-started.html`, `src/components.html` and `src/store.html` provide the guides. `src/packer.html` embeds the browser-only Pack and Unpack tools with the shared header, sidebar, and footer. Shared partials live in `src/components/`; assets live in `src/assets/`.

The docs builder uses the installed `vitemple` compiler and follows local page links. Vitemple Packer lives entirely in this documentation site: its page is `src/packer.html`, its interface is `src/assets/packer.js`, and its scoped styles are `src/assets/packer.css`. The page imports the original `packer.js` as an ES module, which Vitemple copies to `dist/assets/packer.js` without rebuilding or minifying it. Before build or dev starts, `scripts/copy-file-pack.mjs` copies the installed `vitemple/file-pack` module into the ignored `src/assets/file-pack.js`; Vitemple copies it alongside the interface for static hosting. JavaScript and CSS edits in the docs are watched by the dev server. Restart the docs command after updating the installed file-pack library. See [file-pack README](../src/file-pack/README.md) for API examples, limits, and the container format. Code samples encode whitespace as HTML entities to preserve indentation through HTML minification.
