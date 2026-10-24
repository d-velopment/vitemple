# Vitemple Packer

Vitemple Packer is part of the documentation at `docs/src/packer.html`. With the documentation dependencies installed, run `npm run dev` from the `docs` directory and open `/packer.html`. The interface and styles live in `docs/src/assets/packer.js` and `docs/src/assets/packer.css`; the interface is copied unchanged as a browser ES module, alongside a local copy of the installed file-pack library. Restart the docs command after updating that library. Files are never uploaded.

The **Pack** tab accepts individual files, accumulates multiple selections, rejects duplicate filenames, and downloads one `.vpack` file. Clear the selection to start another pack. The **Unpack** tab accepts one `.vpack` file through drag-and-drop or a picker. Once the whole container is validated, each entry becomes a download link. Files with an `image/*` MIME type show a 32 × 32 thumbnail beside their name, reusing the same Blob URL; unsupported or corrupt images keep a working filename link without a thumbnail. **Download all** requests files sequentially as separate downloads; browsers may require permission or block bulk downloads, in which case individual links remain available. Logical paths are flattened into download filenames. Replacing or clearing a pack releases the previous links and cancels unfinished parsing and queued downloads.

## API

Import the standalone browser module from `vitemple/file-pack`. It does not import the compiler, Node.js modules, codecs, or rendering engines.

- `createFilePack(entries, limits?)` returns a `Blob`. Each entry is `{ name, blob }`; a `File` is also a `Blob`. Names are unique logical keys, not filesystem extraction paths. Files are stored in iteration order and retain their original bytes and MIME types.
- `readFilePack(blobOrByteStream, options?)` returns an async generator of `{ name, blob }`. A file is available after all its own bytes arrive; later files need not have arrived. Successful completion also checks that the input has no trailing bytes. Read to the end to validate the whole container.
- `fetchFilePack(url, options?)` fetches a static pack and delegates to the same reader. Fetch uses normal browser HTTP caching; the module does not maintain a second cache.

Read options accept `signal`, `onProgress`, and `limits`. Progress contains `{ loaded, total }`, measured in consumed container bytes. `total` is `null` until the manifest has been read and validated; HTTP compression and missing `Content-Length` do not affect this calculation. Callback exceptions fail the operation and cancel the input. Aborting or breaking out of iteration also cancels the underlying stream and releases its reader lock.

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

## VPK1 format

```text
Offset  Size       Content
0       4 bytes    ASCII "VPK1" (signature and version)
4       4 bytes    Unsigned UTF-8 manifest length, little-endian
8       N bytes    UTF-8 JSON array of { name, type, size }
8 + N   Remaining  Original file bytes concatenated in manifest order
```

No alignment padding, directory records, absolute offsets, or footer are present. `size` is a non-negative safe integer in bytes. Empty files and empty packs are supported. The manifest is available before the payload, so a reader can identify file boundaries without scanning or fetching the end of the pack.
