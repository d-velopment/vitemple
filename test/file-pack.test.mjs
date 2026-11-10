/**
 * Verifies the public VPK1 packing and extraction APIs against independent byte
 * fixtures, controlled streams, and mocked HTTP responses. The tests check the
 * on-disk layout, validation, byte boundaries, and cancellation without a live
 * server or access to the network. Fetch mocks are scoped to individual tests.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createFilePack,
  fetchFilePack,
  fetchFilePackFile,
  fetchFilePackList,
  readFilePack,
  readFilePackFile,
} from "vitemple/file-pack";

// ----------------------------------------------------------------- Independent container and transport fixtures

const PACK_URL = "https://example.test/files.vpack";
const TARGET_NAME = "media/фото.bin";
const PACK_TAG = '"pack-1"';

// Encodes a fixture from raw metadata and payload bytes, independently of createFilePack.
function fixture(padding = 3, target = Uint8Array.of(0, 255, 128, 1)) {
  const entries = [
    { name: "before.bin", type: "", size: padding },
    { name: TARGET_NAME, type: "application/octet-stream", size: target.length },
    { name: "empty.txt", type: "text/plain", size: 0 },
    { name: "tail.txt", type: "text/plain", size: 4 },
  ];

  const manifest = Buffer.from(JSON.stringify(entries, null, 2));
  const header = Buffer.alloc(8);
  header.write("VPK1");
  header.writeUInt32LE(manifest.length, 4);
  const prefixEnd = header.length + manifest.length;
  const targetStart = prefixEnd + padding;

  const bytes = Buffer.concat([
    header,
    manifest,
    Buffer.alloc(padding, 42),
    target,
    Buffer.from("tail"),
  ]);

  return { bytes, entries, prefixEnd, targetStart, targetEnd: targetStart + target.length, target };
}

// Supplies chunks only on demand so the tests can detect reads past a target boundary.
function trackedBody(chunks) {
  const state = { delivered: 0, cancellations: 0 };

  const body = new ReadableStream(
    {

      // Delivers the next chunk or closes the stream when the fixture is exhausted.
      pull(controller) {
        const chunk = chunks[state.delivered];
        if (chunk) {
          state.delivered++;
          controller.enqueue(chunk);
        } else {
          controller.close();
        }

      },

      // Records cancellation so consumers cannot silently leave an unread tail open.
      cancel() {
        state.cancellations++;
      },

    },
    { highWaterMark: 0 },
  );

  return { body, state };
}

// Creates an inclusive HTTP partial response with a known representation size.
function partial(pack, start, end, etag = PACK_TAG) {
  const headers = new Headers({ "Content-Range": `bytes ${start}-${end}/${pack.bytes.length}` });
  if (etag) {
    headers.set("ETag", etag);
  }

  return new Response(pack.bytes.subarray(start, end + 1), { status: 206, headers });
}

// Queues responses, records requested ranges, and fails if any unexpected fetch is attempted.
function mockFetch(t, ...responses) {
  const calls = [];

  t.mock.method(
    globalThis,
    "fetch",

    // Records request headers and returns the next response without accessing the network.
    async (url, options) => {
      assert.equal(url, PACK_URL);
      const response = responses[calls.length];
      assert.ok(response, "unexpected fetch request");
      const headers = new Headers(options?.headers);
      calls.push([headers.get("Range"), headers.get("If-Range")]);
      return response;
    },

  );

  return calls;
}

// Collects a reader through EOF so its final validation is exercised.
async function collect(reader) {
  const files = [];
  for await (const file of reader) files.push(file);
  return files;
}

// Checks binary contents and the manifest MIME type without decoding the file as text.
async function assertTarget(blob, pack) {
  assert.equal(blob.type, "application/octet-stream");
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), pack.target);
}

// ----------------------------------------------------------------- Packing and full local reads

test(
  "createFilePack writes the VPK1 header, UTF-8 manifest, and contiguous original bytes",

  // Inspects the emitted bytes directly so matching reader and writer bugs cannot mask each other.
  async () => {
    const bytes = Uint8Array.of(0, 128, 255);

    const blob = createFilePack([
      { name: TARGET_NAME, blob: new Blob([bytes], { type: "application/octet-stream" }) },
      { name: "empty.txt", blob: new Blob([], { type: "text/plain" }) },
      { name: "tail.txt", blob: new Blob(["tail"], { type: "text/plain" }) },
    ]);

    const output = Buffer.from(await blob.arrayBuffer());
    assert.equal(output.toString("ascii", 0, 4), "VPK1");
    const prefixEnd = 8 + output.readUInt32LE(4);

    assert.deepEqual(JSON.parse(output.toString("utf8", 8, prefixEnd)), [
      { name: TARGET_NAME, type: "application/octet-stream", size: 3 },
      { name: "empty.txt", type: "text/plain", size: 0 },
      { name: "tail.txt", type: "text/plain", size: 4 },
    ]);

    assert.deepEqual(output.subarray(prefixEnd), Buffer.concat([bytes, Buffer.from("tail")]));
  },

);

test(
  "createFilePack rejects duplicate names and oversized manifests",

  // Verifies validation before the pack is handed to the caller.
  () => {
    const entry = { name: "same.txt", blob: new Blob(["bytes"]) };

    assert.throws(

      // Attempts to pack two entries with the same logical name.
      () => createFilePack([entry, entry]),

      /duplicate name/,
    );

    assert.throws(

      // Attempts to pack a valid entry under a manifest budget that is too small.
      () => createFilePack([entry], { maxManifestBytes: 1 }),

      /manifest exceeds the size limit/,
    );

  },

);

test(
  "readFilePack handles split metadata and payloads, preserving order and MIME types",

  // Splits the independent fixture inside the header, manifest, and target file.
  async () => {
    const pack = fixture();

    const { body, state } = trackedBody([
      pack.bytes.subarray(0, 3),
      pack.bytes.subarray(3, 9),
      pack.bytes.subarray(9, pack.targetStart + 1),
      pack.bytes.subarray(pack.targetStart + 1),
    ]);

    const files = await collect(readFilePack(body));
    assert.equal(files.length, pack.entries.length);
    for (const [index, file] of files.entries()) assert.equal(file.name, pack.entries[index].name);
    await assertTarget(files[1].blob, pack);
    assert.equal(files[2].blob.size, 0);
    assert.equal(files[2].blob.type, "text/plain");
    assert.equal(await files[3].blob.text(), "tail");
    assert.equal(state.cancellations, 0);
    assert.equal(body.locked, false);
  },

);

test(
  "readFilePack rejects a bad signature, truncated payload, and trailing data",

  // Uses distinct malformed containers so an early error cannot hide missing EOF validation.
  async () => {
    const { bytes } = fixture();
    const badSignature = Buffer.from(bytes);
    badSignature[0] = 0;
    await assert.rejects(collect(readFilePack(new Blob([badSignature]))), /signature/);
    await assert.rejects(collect(readFilePack(new Blob([bytes.subarray(0, -1)]))), /ended before/);
    await assert.rejects(collect(readFilePack(new Blob([bytes, "extra"]))), /Unexpected bytes/);
  },

);

test(
  "readFilePack cancels the source when iteration ends early",

  // Stops after the first file and checks that no later payload chunk was pulled.
  async () => {
    const pack = fixture();

    const { body, state } = trackedBody([
      pack.bytes.subarray(0, pack.targetStart),
      pack.bytes.subarray(pack.targetStart),
    ]);

    const iterator = readFilePack(body);
    assert.equal((await iterator.next()).value.name, "before.bin");
    await iterator.return();
    assert.deepEqual(state, { delivered: 1, cancellations: 1 });
    assert.equal(body.locked, false);
  },

);

// ----------------------------------------------------------------- Single-file local reads

test(
  "readFilePackFile slices a Blob without streaming preceding entries",

  // Disallows streaming on the input Blob and checks the selected and empty entries.
  async (t) => {
    const pack = fixture();
    const input = new Blob([pack.bytes]);

    t.mock.method(
      input,
      "stream",

      // Fails if local extraction scans the Blob instead of using its slice API.
      () => assert.fail("local extraction must not stream the pack"),

    );

    await assertTarget(await readFilePackFile(input, TARGET_NAME), pack);
    const empty = await readFilePackFile(input, "empty.txt");
    assert.equal(empty.size, 0);
    assert.equal(empty.type, "text/plain");
    await assert.rejects(readFilePackFile(input, "missing.bin"), /File not found/);
  },

);

test(
  "readFilePackFile stops a stream after the selected payload",

  // Leaves the tail in a separate chunk and verifies the returned file and cancelled stream.
  async () => {
    const pack = fixture();

    const { body, state } = trackedBody([
      pack.bytes.subarray(0, pack.targetStart + 1),
      pack.bytes.subarray(pack.targetStart + 1, pack.targetEnd),
      pack.bytes.subarray(pack.targetEnd),
    ]);

    await assertTarget(await readFilePackFile(body, TARGET_NAME), pack);
    assert.deepEqual(state, { delivered: 2, cancellations: 1 });
    assert.equal(body.locked, false);
  },

);

test(
  "readFilePackFile cancels a pending stream read on abort",
  { timeout: 1000 },

  // Aborts while a read is pending and checks that both the read and the reader lock are released.
  async () => {
    const aborter = new AbortController();
    let cancelled = false;

    const body = new ReadableStream(
      {

        // Triggers abort without delivering any bytes to the pending read.
        pull() {
          aborter.abort();
        },

        // Records whether the pending read was cancelled upstream.
        cancel() {
          cancelled = true;
        },

      },
      { highWaterMark: 0 },
    );

    await assert.rejects(readFilePackFile(body, TARGET_NAME, { signal: aborter.signal }), { name: "AbortError" });
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  },

);

// ----------------------------------------------------------------- Full fetch and metadata-only fetch

test(
  "fetchFilePack yields every file and rejects HTTP errors",

  // Checks a complete response followed by an error response through the public generator.
  async (t) => {
    const pack = fixture();
    const calls = mockFetch(t, new Response(pack.bytes), new Response("not found", { status: 404 }));
    const files = await collect(fetchFilePack(PACK_URL));
    assert.equal(files.length, pack.entries.length);
    assert.equal(files[1].name, TARGET_NAME);
    await assertTarget(files[1].blob, pack);
    await assert.rejects(collect(fetchFilePack(PACK_URL)), /HTTP 404/);
    assert.deepEqual(calls, [[null, null], [null, null]]);
  },

);

test(
  "fetchFilePackList reads only the prefix even when a chunk includes payload bytes",

  // Checks metadata, progress, and upstream cancellation with the payload still queued.
  async (t) => {
    const pack = fixture();

    const { body, state } = trackedBody([
      pack.bytes.subarray(0, 4),
      pack.bytes.subarray(4, pack.prefixEnd + 1),
      pack.bytes.subarray(pack.prefixEnd + 1),
    ]);

    mockFetch(t, new Response(body));
    const updates = [];

    const list = await fetchFilePackList(PACK_URL, {

      // Captures logical bytes consumed rather than the size of received chunks.
      onProgress(progress) {
        updates.push(progress);
      },

    });

    assert.deepEqual(list, pack.entries);
    assert.deepEqual(updates.at(-1), { loaded: pack.prefixEnd, total: pack.bytes.length });
    assert.deepEqual(state, { delivered: 2, cancellations: 1 });
    assert.equal(body.locked, false);
  },

);

test(
  "fetchFilePackList rejects an over-budget manifest before reading it",

  // Supplies the header separately to ensure the manifest and payload are never pulled.
  async (t) => {
    const pack = fixture();
    const { body, state } = trackedBody([pack.bytes.subarray(0, 8), pack.bytes.subarray(8)]);
    mockFetch(t, new Response(body));
    await assert.rejects(fetchFilePackList(PACK_URL, { limits: { maxManifestBytes: 1 } }), /manifest exceeds/);
    assert.deepEqual(state, { delivered: 1, cancellations: 1 });
    assert.equal(body.locked, false);
  },

);

// ----------------------------------------------------------------- HTTP byte ranges and sequential fallback

test(
  "fetchFilePackFile requests only the prefix and selected range with If-Range",

  // Asserts exact inclusive offsets using an independent, noncompact Unicode manifest.
  async (t) => {
    const pack = fixture();

    const calls = mockFetch(
      t,
      partial(pack, 0, 7),
      partial(pack, 8, pack.prefixEnd - 1),
      partial(pack, pack.targetStart, pack.targetEnd - 1),
    );

    await assertTarget(await fetchFilePackFile(PACK_URL, TARGET_NAME), pack);

    assert.deepEqual(calls, [
      ["bytes=0-7", null],
      [`bytes=8-${pack.prefixEnd - 1}`, PACK_TAG],
      [`bytes=${pack.targetStart}-${pack.targetEnd - 1}`, PACK_TAG],
    ]);

  },

);

test(
  "fetchFilePackFile reuses a full response and cancels it after the target",

  // Simulates a server ignoring Range and ensures no second request or tail read occurs.
  async (t) => {
    const pack = fixture();
    const { body, state } = trackedBody([pack.bytes.subarray(0, pack.targetEnd), pack.bytes.subarray(pack.targetEnd)]);
    const calls = mockFetch(t, new Response(body));
    await assertTarget(await fetchFilePackFile(PACK_URL, TARGET_NAME), pack);
    assert.deepEqual(calls, [["bytes=0-7", null]]);
    assert.deepEqual(state, { delivered: 1, cancellations: 1 });
  },

);

test(
  "fetchFilePackFile reparses the manifest when If-Range returns a replacement pack",

  // Changes the target's offset and bytes to catch reuse of a stale manifest.
  async (t) => {
    const original = fixture();
    const replacement = fixture(125, Uint8Array.of(4, 8, 15, 16, 23, 42));

    const { body, state } = trackedBody([
      replacement.bytes.subarray(0, replacement.targetEnd),
      replacement.bytes.subarray(replacement.targetEnd),
    ]);

    const calls = mockFetch(t, partial(original, 0, 7), partial(original, 8, original.prefixEnd - 1), new Response(body));
    await assertTarget(await fetchFilePackFile(PACK_URL, TARGET_NAME), replacement);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[2], [`bytes=${original.targetStart}-${original.targetEnd - 1}`, PACK_TAG]);
    assert.deepEqual(state, { delivered: 1, cancellations: 1 });
  },

);

test(
  "fetchFilePackFile falls back when Content-Range is inaccessible",

  // Simulates a cross-origin partial response without the headers needed to verify its range.
  async (t) => {
    const pack = fixture();
    const probe = trackedBody([pack.bytes.subarray(0, 8)]);
    const calls = mockFetch(t, new Response(probe.body, { status: 206 }), new Response(pack.bytes));
    await assertTarget(await fetchFilePackFile(PACK_URL, TARGET_NAME), pack);
    assert.deepEqual(calls, [["bytes=0-7", null], [null, null]]);
    assert.deepEqual(probe.state, { delivered: 0, cancellations: 1 });
  },

);

test(
  "fetchFilePackFile allows untagged ranges for immutable packs and skips empty payload requests",

  // Reads a typed zero-byte entry without requiring an invalid or unnecessary third range.
  async (t) => {
    const pack = fixture();
    const calls = mockFetch(t, partial(pack, 0, 7, null), partial(pack, 8, pack.prefixEnd - 1, null));
    const blob = await fetchFilePackFile(PACK_URL, "empty.txt", { immutable: true });
    assert.equal(blob.size, 0);
    assert.equal(blob.type, "text/plain");
    assert.deepEqual(calls, [["bytes=0-7", null], [`bytes=8-${pack.prefixEnd - 1}`, null]]);
  },

);

test(
  "fetchFilePackFile discards a target range that starts at the wrong offset",

  // Returns a plausible response of the correct length containing the wrong bytes.
  async (t) => {
    const pack = fixture();

    const calls = mockFetch(
      t,
      partial(pack, 0, 7),
      partial(pack, 8, pack.prefixEnd - 1),
      partial(pack, pack.targetStart - 1, pack.targetEnd - 2),
      new Response(pack.bytes),
    );

    await assertTarget(await fetchFilePackFile(PACK_URL, TARGET_NAME), pack);
    assert.equal(calls.length, 4);
    assert.deepEqual(calls.at(-1), [null, null]);
  },

);

test(
  "fetchFilePackFile rejects a target range whose body is shorter than advertised",

  // Supplies a correct Content-Range header but omits the final byte of the response body.
  async (t) => {
    const pack = fixture();

    const truncated = new Response(pack.bytes.subarray(pack.targetStart, pack.targetEnd - 1), {
      status: 206,
      headers: {
        "Content-Range": `bytes ${pack.targetStart}-${pack.targetEnd - 1}/${pack.bytes.length}`,
        ETag: PACK_TAG,
      },
    });

    mockFetch(t, partial(pack, 0, 7), partial(pack, 8, pack.prefixEnd - 1), truncated);
    await assert.rejects(fetchFilePackFile(PACK_URL, TARGET_NAME), /ended before/);
  },

);
