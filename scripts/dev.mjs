/**
 * Runs a Vite development server for a consuming project. It rebuilds output when source files change and triggers browser reloads after successful builds.
 */
import { createServer } from "vite";
import { compile } from "../dist/compiler.js";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

// ----------------------------------------------------------------- Development server setup
const projectRoot = process.cwd();
const args = process.argv.slice(2);
const entryArgument =
  args.find(

    /* Returns the first item that satisfies the requested condition. */ (
      arg,
    ) => !arg.startsWith("--"),

  ) ?? "src/index.html";
const valueAfter =

  /* Reads the value following a command-line option or returns its fallback. */ (
    flag,
    fallback,
  ) => {
    const index = args.indexOf(flag);
    return index === -1 ? fallback : args[index + 1];
  };

const entry = path.resolve(projectRoot, entryArgument);
const sourceRoot = path.dirname(entry);
const outdir = path.resolve(projectRoot, valueAfter("--outdir", "dist"));
const host = valueAfter("--host", "127.0.0.1");
const isWithin =

  /* Checks whether a resolved path is contained by a parent directory. */ (
    parent,
    child,
  ) => {
    const relative = path.relative(parent, child);
    return (
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative))
    );
  };

// Rebuilds the consuming project and invalidates Vite’s module graph.
async function rebuild() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await compile(entry, { outdir });
}

await rebuild();

const server = await createServer({
  configFile: false,
  root: outdir,
  server: { host, watch: { ignored: [outdir] } },
});
server.watcher.add(sourceRoot);

let timer;
let running = false;
let pending = false;

// ----------------------------------------------------------------- Rebuild scheduling and file watching
// Debounces source changes and queues one framework rebuild.
async function scheduleRebuild() {
  if (running) {
    pending = true;
    return;
  }

  running = true;
  try {
    await rebuild();
    server.moduleGraph.invalidateAll();
    server.ws.send({ type: "full-reload", path: "*" });
  } catch (error) {
    console.error(error);
    server.ws.send({
      type: "error",
      err: { message: String(error), stack: "" },
    });
  } finally {
    running = false;

    if (pending) {
      pending = false;
      await scheduleRebuild();
    }
  }
}

server.watcher.on(
  "all",

  /* Handles the all event and performs the required lifecycle work. */ (
    event,
    file,
  ) => {
    if (!["add", "change", "unlink"].includes(event)) return;

    const changedFile = path.resolve(file);
    if (!isWithin(sourceRoot, changedFile) || isWithin(outdir, changedFile))
      return;

    clearTimeout(timer);
    timer = setTimeout(

      /* Runs the scheduled action after the configured delay. */ () => {
        void scheduleRebuild();
      },

      150,
    );
  },

);

await server.listen();
server.printUrls();
