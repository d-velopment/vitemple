# Vitemple Packer

[![npm version](https://img.shields.io/npm/v/vitemple?style=flat-square&color=2563eb)](https://www.npmjs.com/package/vitemple)
[![Vitemple powered](https://img.shields.io/badge/Vitemple-powered-2563eb?style=flat-square&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgYXJpYS1sYWJlbD0iVml0ZW1wbGUgbWFyayI%2BCgk8cGF0aCBkPSJNMS4yIDEuMmg0NS42TDI0IDQ2LjggMS4yIDEuMloiIGZpbGw9IiNmZmYiLz4KCTxwYXRoIGQ9Ik0xIDI0IDE4IDEzdjIyTDEgMjRaIiBmaWxsPSIjZmZmIi8%2BCgk8cGF0aCBkPSJtNDcgMjQtMTctMTF2MjJsMTctMTFaIiBmaWxsPSIjZmZmIi8%2BCjwvc3ZnPgo%3D)](https://github.com/d-velopment/vitemple)
[![Vite](https://img.shields.io/badge/Vite-powered-646cff?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-first-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Native DOM](https://img.shields.io/badge/rendering-native%20DOM-0f766e?style=flat-square)](../../README.md#design-principles)
[![License](https://img.shields.io/badge/license-MIT-f59e0b?style=flat-square)](../../LICENSE)

Vitemple Packer is a browser-native library that groups files of different types into a single uncompressed `.vpack` archive. Download the entire pack in one HTTP request when you need all its assets, or use HTTP byte ranges to download a specific file without downloading the whole archive when the server supports range requests. Each file keeps its name, MIME type, and original bytes.

The manifest is at the start of the pack, so you can list its contents before downloading the file payloads. Stream all files and use each as it arrives, or extract just one by name. Local packs can be sliced directly. Over HTTP, byte ranges let the reader request only the metadata and selected file when the server supports them. Otherwise, the reader scans sequentially and stops once it has the selected file.

[Example →](https://d-velopment.github.io/vitemple-packer/)

## API

Import the standalone browser module from `vitemple/file-pack`. It does not import the compiler, Node.js modules, codecs, or rendering engines.

- `createFilePack(entries, limits?)` returns a `Blob`. Each entry is `{ name, blob }`; a `File` is also a `Blob`. Names are unique logical keys, not filesystem extraction paths. Files are stored in iteration order and retain their original bytes and MIME types.
- `readFilePack(blobOrByteStream, options?)` returns an async generator of `{ name, blob }`. A file is available after all its own bytes arrive; later files need not have arrived. Successful completion also checks that the input has no trailing bytes. Read to the end to validate the whole container.
- `fetchFilePack(url, options?)` fetches a static pack and delegates to the same reader. Fetch uses normal browser HTTP caching; the module does not maintain a second cache.
- `fetchFilePackList(url, options?)` returns a `Promise<FilePackListEntry[]>`, with `{ name, type, size }` for each entry in manifest order. It reads and validates the header and manifest, then cancels the rest of the response. It does not read or verify file payloads. The network may already have buffered bytes past the manifest.
- `readFilePackFile(blobOrByteStream, name, options?)` returns a `Promise<Blob>` for an exact logical name. A `Blob` or `File` is sliced directly; a stream is scanned through the target and then cancelled. The promise rejects if the name is missing.
- `fetchFilePackFile(url, name, options?)` returns the same typed `Blob` over HTTP. It requests the header, manifest, and selected file with byte ranges. A full response is reused for sequential reading; when ranges cannot be used, the reader skips preceding bytes without creating Blobs and cancels the response after the target. Both single-file APIs support the usual read options.

Read options accept `signal`, `onProgress`, and `limits`. Progress contains `{ loaded, total }`, measured in consumed container bytes. `total` is `null` until the manifest has been read and validated; HTTP compression and missing `Content-Length` do not affect this calculation. Callback exceptions fail the operation and cancel the input. Aborting or breaking out of iteration also cancels the underlying stream and releases its reader lock.

For `fetchFilePackList`, `total` still describes the full declared pack size. `loaded` stops at the end of the manifest.

For single-file reads, `total` also describes the full pack. With a local slice or successful range requests, `loaded` counts the prefix and selected file, not the skipped files. With a sequential stream, it counts the bytes consumed through the selected file.

Serve `.vpack` without HTTP content encoding to enable byte ranges. By default, partial responses must have a strong `ETag` so the requests can use `If-Range` and avoid mixing pack versions. If a URL always serves exactly the same bytes (for example, its path includes a content hash), pass `{ immutable: true }` to allow ranges without a strong `ETag`. For cross-origin requests, expose `Content-Range`, `ETag`, and `Content-Encoding` via CORS and allow `If-Range` if used. A server or browser can buffer more data than the parser consumes during a sequential read.

Default budgets, configurable for both packing and reading:

| Limit | Default |
| --- | --- |
| `maxManifestBytes` | 4 MiB |
| `maxFiles` | 10,000 |
| `maxFileBytes` | 512 MiB |
| `maxTotalBytes` | 2 GiB of payload bytes |

All limits must be non-negative safe integers. Entry names are limited to 4,096 UTF-16 code units and cannot be empty or contain NUL. MIME types contain at most 255 printable ASCII characters. Unknown signatures, invalid UTF-8 or JSON, duplicate names, unsafe sizes, truncated input, and trailing data are rejected. VPK1 has no content checksum, authentication, compression, or encryption.

Packing uses existing Blobs directly instead of converting every file to an `ArrayBuffer`. Reading buffers one complete file before yielding it, plus the manifest and a source chunk. This is not a constant-memory media decoder: retaining returned Blobs or decoded resources retains their storage, and browser Blob implementations may make internal copies. Consumers own decoding, object URL creation/revocation, GPU textures, and audio resources.

Atlas JSON and other files may reference neighboring resources. The container preserves these references as bytes; application or engine adapters must resolve those logical names within the pack. Packing images together does not create a texture atlas.

## Examples

Create a pack in memory and read one file from it. The name passed to `readFilePackFile` matches the `name` assigned when packing:

```js
import { createFilePack, readFilePackFile } from "vitemple/file-pack";

const pack = createFilePack([
  { name: "hello.txt", blob: new Blob(["Hello!"], { type: "text/plain" }) },
  { name: "settings.json", blob: new Blob(["{}"], { type: "application/json" }) },
]);

const file = await readFilePackFile(pack, "hello.txt");
console.log(await file.text()); // Hello!
```

For a pack on a server, see the [`fetchFilePackFile` example](#try-the-hosted-example) using a public `.vpack` and a file it contains.

List a pack's files without waiting for the payloads:

```js
import { fetchFilePackList } from "vitemple/file-pack";

const files = await fetchFilePackList("/files.vpack");
console.table(files);
```

Fetch a pack from a server:

```js
import { fetchFilePack } from "vitemple/file-pack";

for await (const { name, blob } of fetchFilePack("/files.vpack")) {
  console.log(name, blob);

  // Image source:
  // const imageSrc = URL.createObjectURL(blob);
  // image.src = imageSrc;
  // Call URL.revokeObjectURL(imageSrc) when no longer needed.

  // Base64 with MIME type: "data:image/png;base64,..."
  // const reader = new FileReader();
  // Handles the completed conversion and reads the data URL.
  // reader.onload = () => console.log(reader.result);
  // reader.readAsDataURL(blob);
}
```

Read a local file already selected through an `<input type="file">`:

```js
import { readFilePack } from "vitemple/file-pack";

const file = document.querySelector('input[type="file"]').files[0];

for await (const { name, blob } of readFilePack(file)) {
  console.log(name, blob);

  // Image source:
  // const imageSrc = URL.createObjectURL(blob);
  // image.src = imageSrc;
  // Call URL.revokeObjectURL(imageSrc) when no longer needed.

  // Base64 with MIME type: "data:image/png;base64,..."
  // const reader = new FileReader();
  // Handles the completed conversion and reads the data URL.
  // reader.onload = () => console.log(reader.result);
  // reader.readAsDataURL(blob);
}
```

The commented image examples assume `image` is an existing `<img>` element. Use them for files with an `image/*` MIME type. Keep the object URL valid while the image is in use, then revoke it when replacing or removing the image.

The reader restores each file's MIME type from the manifest into `blob.type`. `FileReader.readAsDataURL(blob)` automatically includes that type in its result, such as `data:image/png;base64,...`; there is no need to add the type manually. The result is a complete data URL, including the MIME prefix, rather than just the Base64 payload. Neither approach requires saving the extracted file to disk.

### Try the hosted example

Use this public pack to try all three fetch APIs:

```js
import {
  fetchFilePackList,
  fetchFilePack,
  fetchFilePackFile,
} from "vitemple/file-pack";

const url = "https://d-velopment.github.io/vitemple-packer/assets/example.vpack";

// List the three entries without reading their payloads.
console.table(await fetchFilePackList(url));

// Extract every file in manifest order.
for await (const { name, blob } of fetchFilePack(url)) {
  console.log(name, blob.type, blob.size);
}

// Extract only the requested image.
const background = await fetchFilePackFile(url, "background.jpg");
console.log(background.type, background.size); // image/jpeg, 356873
```

The single-file call uses HTTP Range when it can verify the partial responses. When the browser cannot access the required headers on a cross-origin response, it reads sequentially instead. To see an early stop in that mode, request `winamp-startup.mp3`, the first entry in the sample pack.

## VPK1 format

```text
Offset  Size       Content
0       4 bytes    ASCII "VPK1" (signature and version)
4       4 bytes    Unsigned UTF-8 manifest length, little-endian
8       N bytes    UTF-8 JSON array of { name, type, size }
8 + N   Remaining  Original file bytes concatenated in manifest order
```

No alignment padding, directory records, absolute offsets, or footer are present. `size` is a non-negative safe integer in bytes. Empty files and empty packs are supported. The manifest is available before the payload, so a reader can identify file boundaries without scanning or fetching the end of the pack.
