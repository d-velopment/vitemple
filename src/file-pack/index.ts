/**
 * Packs named browser Blobs and Files into an uncompressed VPK1 container and reads
 * that container incrementally from a Blob or byte stream. A UTF-8 JSON manifest
 * describes sequential payloads; source bytes are preserved without codecs,
 * Base64, dependencies, filesystem access, or engine-specific decoding. Readers
 * enforce configurable budgets, report consumed bytes, support abort signals, and
 * cancel their input on failure, early iteration exit, or after listing a pack's
 * manifest. Named files can also be sliced from local Blobs or retrieved with
 * HTTP ranges, falling back to a sequential scan when ranges are unavailable.
 * Consumers own returned Blobs, object URLs, and decoded media.
 */

export interface FilePackEntry {
  name: string;
  blob: Blob;
}

export interface FilePackLimits {
  maxManifestBytes: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export interface FilePackProgress {
  loaded: number;
  total: number | null;
}

export interface FilePackReadOptions {
  limits?: Partial<FilePackLimits>;
  signal?: AbortSignal;

  // Reports bytes consumed by the parser; total is unknown until the manifest is validated.
  onProgress?: (progress: FilePackProgress) => void;
}

export interface FilePackListEntry {
  name: string;
  type: string;
  size: number;
}

export interface FilePackFetchOptions extends FilePackReadOptions {
  // Allows byte ranges without a strong ETag when the URL always serves the same bytes.
  immutable?: boolean;
}

interface PackManifest {
  entries: FilePackListEntry[];
  payloadOffset: number;
  total: number;
}

// ----------------------------------------------------------------- Container metadata and validation
const MAGIC = 0x314b5056;
const HEADER_BYTES = 8;
const DEFAULT_LIMITS: FilePackLimits = {
  maxManifestBytes: 4 * 1024 * 1024,
  maxFiles: 10000,
  maxFileBytes: 512 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
};

// Resolves resource budgets and rejects invalid limits before reading or allocating payloads.
function resolveLimits(overrides?: Partial<FilePackLimits>): FilePackLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError("File pack limits must be non-negative safe integers.");
    }

  }

  return limits;
}

// Validates manifest structure, unique logical names, and file budgets without resolving paths.
function validateManifest(value: unknown, limits: FilePackLimits): FilePackListEntry[] {
  if (!Array.isArray(value) || value.length > limits.maxFiles) {
    throw new Error("Invalid file pack manifest or too many files.");
  }

  const entries: FilePackListEntry[] = [];
  const names = new Set<string>();
  let total = 0;
  for (const item of value) {
    if (
      !item ||
      typeof item.name !== "string" ||
      !item.name.length ||
      item.name.length > 4096 ||
      item.name.includes("\0") ||
      names.has(item.name) ||
      typeof item.type !== "string" ||
      item.type.length > 255 ||
      /[^\x20-\x7e]/.test(item.type) ||
      !Number.isSafeInteger(item.size) ||
      item.size < 0 ||
      item.size > limits.maxFileBytes
    ) {
      throw new Error("Invalid file pack entry, duplicate name, or file too large.");
    }

    total += item.size;

    if (!Number.isSafeInteger(total) || total > limits.maxTotalBytes) {
      throw new RangeError("File pack payload exceeds the total size limit.");
    }

    names.add(item.name);
    entries.push({ name: item.name, type: item.type, size: item.size });
  }

  return entries;
}

// Checks the VPK1 signature and bounds the manifest before allocating or requesting it.
function readManifestSize(buffer: ArrayBuffer, limits: FilePackLimits): number {
  if (buffer.byteLength !== HEADER_BYTES) {
    throw new Error("File pack ended before all declared bytes arrived.");
  }

  const header = new DataView(buffer);

  if (header.getUint32(0, true) !== MAGIC) {
    throw new Error("Unsupported file pack signature or version; expected VPK1.");
  }

  const size = header.getUint32(4, true);

  if (size > limits.maxManifestBytes) {
    throw new RangeError("File pack manifest exceeds the size limit.");
  }

  return size;
}

// Decodes the metadata and computes offsets from the original UTF-8 length.
function parseManifest(metadata: ArrayBuffer, limits: FilePackLimits): PackManifest {
  const entries = validateManifest(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(metadata)),
    limits,
  );

  const payloadOffset = HEADER_BYTES + metadata.byteLength;
  let total = payloadOffset;
  for (const entry of entries) total += entry.size;

  if (!Number.isSafeInteger(total)) {
    throw new RangeError("File pack size exceeds the safe integer range.");
  }

  return { entries, payloadOffset, total };
}

// Finds a logical name and derives its absolute byte offset without reading other entries.
function locateFile(manifest: PackManifest, name: string): FilePackListEntry & { offset: number } {
  let offset = manifest.payloadOffset;
  for (const entry of manifest.entries) {
    if (entry.name === name) {
      return { ...entry, offset };
    }

    offset += entry.size;
  }

  throw new Error(`File not found in pack: ${name}`);
}

// ----------------------------------------------------------------- Browser-side packing
// Assembles a container from known-size Blobs without decoding or reading all files into JS buffers.
export function createFilePack(
  files: Iterable<FilePackEntry>,
  overrides?: Partial<FilePackLimits>,
): Blob {
  const limits = resolveLimits(overrides);
  const payloads: Blob[] = [];
  const manifest: FilePackListEntry[] = [];
  for (const file of files) {
    if (!(file.blob instanceof Blob) || manifest.length >= limits.maxFiles) {
      throw new Error("File pack entries must contain Blobs and respect the file count limit.");
    }

    manifest.push({ name: file.name, type: file.blob.type, size: file.blob.size });
    payloads.push(file.blob);
  }

  validateManifest(manifest, limits);
  const metadata = new TextEncoder().encode(JSON.stringify(manifest));

  if (metadata.byteLength > limits.maxManifestBytes || metadata.byteLength > 0xffffffff) {
    throw new RangeError("File pack manifest exceeds the size limit.");
  }

  const header = new ArrayBuffer(HEADER_BYTES);
  const view = new DataView(header);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, metadata.byteLength, true);
  return new Blob([header, metadata, ...payloads], { type: "application/octet-stream" });
}

// ----------------------------------------------------------------- Incremental byte reading
// Cancels upstream work while preserving any original parsing, callback, or abort error.
async function cancelInput(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason?: unknown,
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // An already failed source must not replace the error that triggered cleanup.
  }
}

class PackReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private chunk: Uint8Array = new Uint8Array();
  private offset = 0;
  private loaded = 0;
  private total: number | null = null;

  // Locks the input and subscribes to cancellation until the reader is closed.
  constructor(
    input: Blob | ReadableStream<Uint8Array>,
    private options: FilePackReadOptions,
    progress?: FilePackProgress,
  ) {
    options.signal?.throwIfAborted();
    this.loaded = progress?.loaded ?? 0;
    this.total = progress?.total ?? null;
    this.reader = (input instanceof Blob ? input.stream() : input).getReader();
    options.signal?.addEventListener("abort", this.abort, { once: true });
  }

  // Cancels any pending read as soon as the caller's signal aborts.
  private readonly abort = (): void => {
    void cancelInput(this.reader, this.options.signal?.reason);
  };

  // Cancels unread data unless EOF was verified, then releases the input lock.
  async close(complete = false): Promise<void> {
    this.options.signal?.removeEventListener("abort", this.abort);

    if (!complete) {
      await cancelInput(this.reader, this.options.signal?.reason);
    }

    this.reader.releaseLock();
  }

  // Gets a nonempty byte chunk and observes cancellation even when buffered data remains.
  private async available(): Promise<boolean> {
    this.options.signal?.throwIfAborted();

    while (this.offset === this.chunk.byteLength) {
      const result = await this.reader.read();
      this.options.signal?.throwIfAborted();

      if (result.done) {
        return false;
      }

      if (!(result.value instanceof Uint8Array)) {
        throw new TypeError("File pack input must be a Uint8Array stream.");
      }

      this.chunk = result.value;
      this.offset = 0;
    }

    return true;
  }

  // Collects exactly one bounded section using chunk slices, avoiding repeated buffer concatenation.
  async read(size: number, type = ""): Promise<Blob> {
    const parts: BlobPart[] = [];
    await this.consume(size, parts);
    return new Blob(parts, { type });
  }

  // Advances through preceding payloads without retaining their chunks or creating Blobs.
  async skip(size: number): Promise<void> {
    await this.consume(size);
  }

  // Advances exactly the requested byte count and retains slices only for reads.
  private async consume(size: number, parts?: BlobPart[]): Promise<void> {
    let remaining = size;
    this.options.signal?.throwIfAborted();

    while (remaining > 0) {
      if (!(await this.available())) {
        throw new Error("File pack ended before all declared bytes arrived.");
      }

      const length = Math.min(remaining, this.chunk.byteLength - this.offset);
      parts?.push(this.chunk.subarray(this.offset, this.offset + length) as BlobPart);
      this.offset += length;
      remaining -= length;
      this.loaded += length;
      this.report();
    }

    this.options.signal?.throwIfAborted();
  }

  // Reports logical container progress independently of HTTP Content-Length or content encoding.
  private report(): void {
    this.options.onProgress?.({ loaded: this.loaded, total: this.total });
  }

  // Parses and validates the declared JSON prefix, retaining any buffered bytes for full reads.
  async readManifest(limits: FilePackLimits): Promise<PackManifest> {
    const header = await (await this.read(HEADER_BYTES)).arrayBuffer();
    const metadataSize = readManifestSize(header, limits);
    const metadata = await (await this.read(metadataSize)).arrayBuffer();
    const manifest = parseManifest(metadata, limits);
    this.total = manifest.total;
    this.report();
    this.options.signal?.throwIfAborted();
    return manifest;
  }

  // Verifies EOF so trailing payloads or concatenated containers are not silently accepted.
  async finish(): Promise<void> {
    if (await this.available()) {
      throw new Error("Unexpected bytes after the file pack payload.");
    }

  }
}

// ----------------------------------------------------------------- Public stream and network readers

// Yields each complete file before later payloads arrive; early exit cancels the input stream.
export async function* readFilePack(
  input: Blob | ReadableStream<Uint8Array>,
  options: FilePackReadOptions = {},
): AsyncGenerator<FilePackEntry, void, unknown> {
  const limits = resolveLimits(options.limits);
  const bytes = new PackReader(input, options);
  let complete = false;

  try {
    const { entries } = await bytes.readManifest(limits);
    for (const entry of entries) {
      const blob = await bytes.read(entry.size, entry.type);
      options.signal?.throwIfAborted();
      yield { name: entry.name, blob };
    }

    await bytes.finish();
    complete = true;
  } finally {
    await bytes.close(complete);
  }

}

// Opens a response body with native HTTP caching and rejects unusable HTTP responses.
async function fetchPackBody(
  url: string | URL,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(url, { signal });

  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Unable to fetch file pack: HTTP ${response.status}.`);
  }

  return response.body;
}

// Returns the validated file list and cancels the response without parsing any payloads.
export async function fetchFilePackList(
  url: string | URL,
  options: FilePackReadOptions = {},
): Promise<FilePackListEntry[]> {
  const limits = resolveLimits(options.limits);
  const body = await fetchPackBody(url, options.signal);
  const bytes = new PackReader(body, options);

  try {
    return (await bytes.readManifest(limits)).entries;
  } finally {
    await bytes.close();
  }

}

// Fetches a static pack and delegates incremental file extraction to readFilePack.
export async function* fetchFilePack(
  url: string | URL,
  options: FilePackReadOptions = {},
): AsyncGenerator<FilePackEntry, void, unknown> {
  resolveLimits(options.limits);
  yield* readFilePack(await fetchPackBody(url, options.signal), options);
}

// ----------------------------------------------------------------- Single-file extraction

// Reads only as far as the named file and cancels any remaining stream data.
async function readStreamFile(
  input: ReadableStream<Uint8Array>,
  name: string,
  limits: FilePackLimits,
  options: FilePackReadOptions,
): Promise<Blob> {
  const bytes = new PackReader(input, options);

  try {
    const manifest = await bytes.readManifest(limits);
    const file = locateFile(manifest, name);

    if (file.size === 0) {
      return new Blob([], { type: file.type });
    }

    await bytes.skip(file.offset - manifest.payloadOffset);
    return await bytes.read(file.size, file.type);
  } finally {
    await bytes.close();
  }

}

// Slices a local pack directly or scans a stream up to the named file.
export async function readFilePackFile(
  input: Blob | ReadableStream<Uint8Array>,
  name: string,
  options: FilePackReadOptions = {},
): Promise<Blob> {
  const limits = resolveLimits(options.limits);
  options.signal?.throwIfAborted();

  if (!(input instanceof Blob)) {
    return readStreamFile(input, name, limits, options);
  }

  const header = await input.slice(0, HEADER_BYTES).arrayBuffer();
  const size = readManifestSize(header, limits);

  if (HEADER_BYTES + size > input.size) {
    throw new Error("File pack ended before all declared bytes arrived.");
  }

  const metadata = await input.slice(HEADER_BYTES, HEADER_BYTES + size).arrayBuffer();
  options.signal?.throwIfAborted();
  const manifest = parseManifest(metadata, limits);

  if (manifest.total !== input.size) {
    throw new Error("File pack size does not match its manifest.");
  }

  const file = locateFile(manifest, name);

  options.onProgress?.({ loaded: manifest.payloadOffset + file.size, total: manifest.total });
  options.signal?.throwIfAborted();
  return input.slice(file.offset, file.offset + file.size, file.type);
}

// ----------------------------------------------------------------- HTTP range retrieval and fallback

interface PackRangeIdentity {
  etag: string | null;
  total: number;
}

type PackRangeResponse =
  | { kind: "full"; body: ReadableStream<Uint8Array> }
  | ({ kind: "partial"; body: ReadableStream<Uint8Array> } & PackRangeIdentity);

// Requests one range, retaining a full response for reuse and discarding unsafe partial responses.
async function requestPackRange(
  url: string | URL,
  start: number,
  end: number,
  signal?: AbortSignal,
  identity?: PackRangeIdentity,
): Promise<PackRangeResponse | undefined> {
  const headers = new Headers({ Range: `bytes=${start}-${end}` });

  if (identity?.etag) {
    headers.set("If-Range", identity.etag);
  }

  let response: Response;

  try {
    response = await fetch(url, { headers, signal });
  } catch (error) {
    signal?.throwIfAborted();

    if (error instanceof TypeError) {
      return undefined;
    }

    throw error;
  }

  const body = response.body;

  if (response.status === 200 && body) {
    return { kind: "full", body };
  }

  if (response.status === 206 && body) {
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get("Content-Range") ?? "");
    const total = Number(range?.[3]);
    const encoding = response.headers.get("Content-Encoding")?.toLowerCase();
    const tag = response.headers.get("ETag");
    const etag = tag && /^"[^"\r\n]*"$/.test(tag) ? tag : null;

    if (
      (!encoding || encoding === "identity") &&
      Number(range?.[1]) === start &&
      Number(range?.[2]) === end &&
      Number.isSafeInteger(total) && total > end &&
      (!identity || (total === identity.total && (!identity.etag || etag === identity.etag)))
    ) {
      return { kind: "partial", body, etag, total };
    }

  }

  await body?.cancel();

  if (response.status === 206 || response.status === 416) {
    return undefined;
  }

  throw new Error(`Unable to fetch file pack: HTTP ${response.status}.`);
}

// Reads exactly one accepted range and checks its actual body length before returning it.
async function readPackRange(
  body: ReadableStream<Uint8Array>,
  size: number,
  options: FilePackReadOptions,
  type = "",
  progress?: FilePackProgress,
): Promise<Blob> {
  const bytes = new PackReader(body, options, progress);
  let complete = false;

  try {
    const blob = await bytes.read(size, type);
    await bytes.finish();
    complete = true;
    return blob;
  } finally {
    await bytes.close(complete);
  }

}

// Retrieves the header, manifest, and target range from one stable representation when possible.
async function fetchRangedFile(
  url: string | URL,
  name: string,
  limits: FilePackLimits,
  options: FilePackFetchOptions,
): Promise<Blob | undefined> {
  const { signal } = options;
  const first = await requestPackRange(url, 0, HEADER_BYTES - 1, signal);

  if (first?.kind === "full") {
    return readStreamFile(first.body, name, limits, options);
  }

  if (!first) {
    return undefined;
  }

  if (!first.etag && !options.immutable) {
    await first.body.cancel();
    return undefined;
  }

  const header = await readPackRange(first.body, HEADER_BYTES, { signal });
  const size = readManifestSize(await header.arrayBuffer(), limits);

  if (size === 0 || HEADER_BYTES + size > first.total) {
    throw new Error("Invalid file pack manifest length.");
  }

  const next = await requestPackRange(url, HEADER_BYTES, HEADER_BYTES + size - 1, signal, first);

  if (next?.kind === "full") {
    return readStreamFile(next.body, name, limits, options);
  }

  if (!next) {
    return undefined;
  }

  const metadata = await readPackRange(next.body, size, { signal });
  const manifest = parseManifest(await metadata.arrayBuffer(), limits);

  if (manifest.total !== first.total) {
    throw new Error("File pack size does not match its manifest.");
  }

  const file = locateFile(manifest, name);

  if (file.size === 0) {
    options.onProgress?.({ loaded: manifest.payloadOffset, total: manifest.total });
    signal?.throwIfAborted();
    return new Blob([], { type: file.type });
  }

  const target = await requestPackRange(url, file.offset, file.offset + file.size - 1, signal, first);

  if (target?.kind === "full") {
    return readStreamFile(target.body, name, limits, options);
  }

  if (!target) {
    return undefined;
  }

  return readPackRange(target.body, file.size, options, file.type, {
    loaded: manifest.payloadOffset,
    total: manifest.total,
  });
}

// Downloads one file, reusing a full response or falling back to a bounded sequential scan.
export async function fetchFilePackFile(
  url: string | URL,
  name: string,
  options: FilePackFetchOptions = {},
): Promise<Blob> {
  const limits = resolveLimits(options.limits);
  const blob = await fetchRangedFile(url, name, limits, options);

  if (blob) {
    return blob;
  }

  return readStreamFile(await fetchPackBody(url, options.signal), name, limits, options);
}
