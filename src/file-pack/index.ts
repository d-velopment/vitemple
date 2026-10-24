/**
 * Packs named browser Blobs and Files into an uncompressed VPK1 container and reads
 * that container incrementally from a Blob or byte stream. A UTF-8 JSON manifest
 * describes sequential payloads; source bytes are preserved without codecs,
 * Base64, dependencies, filesystem access, or engine-specific decoding. Readers
 * enforce configurable budgets, report consumed bytes, support abort signals, and
 * cancel their input on failure or early iteration exit. Consumers own returned
 * Blobs, object URLs, decoded media, and any rendering-engine integration.
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

interface ManifestEntry {
  name: string;
  type: string;
  size: number;
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
function validateManifest(value: unknown, limits: FilePackLimits): ManifestEntry[] {
  if (!Array.isArray(value) || value.length > limits.maxFiles) {
    throw new Error("Invalid file pack manifest or too many files.");
  }

  const entries: ManifestEntry[] = [];
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

// ----------------------------------------------------------------- Browser-side packing
// Assembles a container from known-size Blobs without decoding or reading all files into JS buffers.
export function createFilePack(
  files: Iterable<FilePackEntry>,
  overrides?: Partial<FilePackLimits>,
): Blob {
  const limits = resolveLimits(overrides);
  const payloads: Blob[] = [];
  const manifest: ManifestEntry[] = [];
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
  private chunk: Uint8Array = new Uint8Array();
  private offset = 0;
  private loaded = 0;
  total: number | null = null;

  // Owns one locked input reader; cancellation and lock release belong to readFilePack.
  constructor(
    private reader: ReadableStreamDefaultReader<Uint8Array>,
    private options: FilePackReadOptions,
  ) {}

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
    let remaining = size;
    this.options.signal?.throwIfAborted();

    while (remaining > 0) {
      if (!(await this.available())) {
        throw new Error("File pack ended before all declared bytes arrived.");
      }

      const length = Math.min(remaining, this.chunk.byteLength - this.offset);
      parts.push(this.chunk.subarray(this.offset, this.offset + length) as BlobPart);
      this.offset += length;
      remaining -= length;
      this.loaded += length;
      this.report();
    }

    return new Blob(parts, { type });
  }

  // Reports logical container progress independently of HTTP Content-Length or content encoding.
  report(): void {
    this.options.onProgress?.({ loaded: this.loaded, total: this.total });
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
  options.signal?.throwIfAborted();
  const reader = (input instanceof Blob ? input.stream() : input).getReader();
  const bytes = new PackReader(reader, options);
  let complete = false;

  // Stops an in-flight read immediately when the caller aborts the operation.
  const abort = (): void => {
    void cancelInput(reader, options.signal?.reason);
  };

  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const header = new DataView(await (await bytes.read(HEADER_BYTES)).arrayBuffer());

    if (header.getUint32(0, true) !== MAGIC) {
      throw new Error("Unsupported file pack signature or version; expected VPK1.");
    }

    const metadataSize = header.getUint32(4, true);

    if (metadataSize > limits.maxManifestBytes) {
      throw new RangeError("File pack manifest exceeds the size limit.");
    }

    const metadata = await (await bytes.read(metadataSize)).arrayBuffer();
    const manifest = validateManifest(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(metadata)),
      limits,
    );
    let total = HEADER_BYTES + metadataSize;
    for (const entry of manifest) total += entry.size;

    if (!Number.isSafeInteger(total)) {
      throw new RangeError("File pack size exceeds the safe integer range.");
    }

    bytes.total = total;
    bytes.report();
    for (const entry of manifest) {
      const blob = await bytes.read(entry.size, entry.type);
      options.signal?.throwIfAborted();
      yield { name: entry.name, blob };
    }

    await bytes.finish();
    complete = true;
  } finally {
    options.signal?.removeEventListener("abort", abort);

    if (!complete) {
      await cancelInput(reader, options.signal?.reason);
    }

    reader.releaseLock();
  }
}

// Fetches a static pack with native HTTP caching and delegates incremental parsing to readFilePack.
export async function* fetchFilePack(
  url: string | URL,
  options: FilePackReadOptions = {},
): AsyncGenerator<FilePackEntry, void, unknown> {
  resolveLimits(options.limits);
  const response = await fetch(url, { signal: options.signal });

  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Unable to fetch file pack: HTTP ${response.status}.`);
  }

  yield* readFilePack(response.body, options);
}
