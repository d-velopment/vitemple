# What's New

A concise record of Vitemple releases and the latest repository changes.

## 0.2.5

### Added

- Multi-page builds that discover reachable local HTML pages through relative `<a href>` links, including links introduced by expanded slots.
- Automatic copying of local assets referenced by page markup, linked CSS files, and component styles, preserving their relative paths in the output.
- A packaged Vite development server that watches project sources, rebuilds the page graph, serves the generated site, and reloads the browser.
- A local framework watcher for developing Vitemple against the documentation site or another installed project without changing its declared npm dependency.
- Inline TypeScript support in HTML through `<script type="ts">`; TypeScript syntax is transpiled during the Vitemple build.
- `store.init()` to set missing defaults without overwriting values restored from `sessionStorage`, alongside automatic persistence and restoration of the shared store across pages in the same tab.
- Project-specific `sessionStorage` keys derived from the nearest application `package.json` name, keeping stores isolated between apps on the same origin.
- A guarded install scaffold that creates an initial `src/index.html` and a slot-imported `components/hello.html` with a TypeScript color-changing heading in a new project.
- Default `start`, `dev`, and `build` scripts added during installation when the project does not define them.

### Improved

- The compiler preserves each entry page's filename and emits linked pages at paths matching their local URLs; `index.html` remains the conventional default entry.
- The documentation site now builds from its home page, relying on Vitemple to discover and compile its linked pages.
- Documentation guidance and examples for native HTML composition, reusable templates, and the shared store.

## 0.1.7

### Improved

- Updated the package README to describe Vitemple as reactive and link to the full online documentation.
- Added the GitHub repository and documentation homepage to the published package metadata.

The published compiler and runtime files are unchanged from `0.1.5`.

## 0.1.5

First public npm release of Vitemple.

### Added

- Recursive build-time composition of native HTML files through `<slot>` imports, with slot attributes available as placeholders in imported content.
- CSS slot collection and deduplication into the document `<head>`.
- TypeScript and JavaScript script slots, combined into a browser-ready ES module; relative imports are copied into `dist` and TypeScript imports are rewritten to `.js`.
- Native `<template>` output for reusable fragments, with template scripts emitted once at the end of the page.
- A built-in shared store with `set`, `update`, and `subscribe` methods and TypeScript declarations.
- Compact output that preserves the authored HTML document structure and uses native DOM APIs without a virtual DOM.
