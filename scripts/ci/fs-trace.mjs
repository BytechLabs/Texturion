/**
 * Preloaded into vitest's workers (NODE_OPTIONS=--import) when CI records test
 * history. Writes one line per (test file, path) pair the test touched, so a
 * pull request can rerun a source-scanning guard when a file it scans changes.
 *
 *   r  a file was read or probed (read, stat, exists, open)
 *   l  a directory was listed (readdir, opendir, glob)
 *   s  the test started a process or worker, so what it read is unknown
 *
 * Paths outside the repository, under node_modules or under .git are dropped.
 * The current test file is the one vitest's worker state names; work done
 * outside a test file (vitest's own process) is not recorded.
 */
import childProcess from "node:child_process";
// oxlint-disable-next-line unicorn/import-style -- The tracer patches the mutable filesystem module.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join, relative as relativePath, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import workerThreads from "node:worker_threads";

const OUT_DIR = process.env.LOONEXT_FS_TRACE_DIR;
const ROOT = process.env.LOONEXT_FS_TRACE_ROOT;

const READS = [
  "readFileSync", "readFile", "existsSync", "exists", "statSync", "stat", "lstatSync", "lstat",
  "accessSync", "access", "openSync", "open", "realpathSync", "realpath", "readlinkSync",
  "readlink", "createReadStream",
];
const PROMISE_READS = ["readFile", "stat", "lstat", "access", "open", "realpath", "readlink"];
const LISTS = ["readdirSync", "readdir", "opendirSync", "opendir"];
const PROMISE_LISTS = ["readdir", "opendir"];
const GLOBS = ["globSync", "glob"];
const SPAWNS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"];

if (OUT_DIR && ROOT) install(resolve(ROOT), OUT_DIR);

function install(root, outDir) {
  const { appendFileSync, mkdirSync } = fs;
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${process.pid}-${workerThreads.threadId}.ndjson`);
  const seen = new Set();
  const rootPrefix = root + sep;

  const record = (kind, target) => {
    const testFile = globalThis.__vitest_worker__?.filepath;
    if (!testFile) return;
    const key = `${testFile}\0${kind}\0${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    appendFileSync(outFile, `${JSON.stringify({ t: testFile, k: kind, p: target })}\n`);
  };

  const inRepo = (value) => {
    let target = value;
    if (target instanceof URL) target = fileURLToPath(target);
    else if (Buffer.isBuffer(target)) target = target.toString();
    if (typeof target !== "string") return null;
    if (target.startsWith("file:")) target = fileURLToPath(target);
    const absolute = resolve(target);
    if (absolute !== root && !absolute.startsWith(rootPrefix)) return null;
    const relative = relativePath(root, absolute).split(sep).join("/");
    if (relative.split("/").some((part) => part === "node_modules" || part === ".git")) return null;
    return relative;
  };

  const wrap = (owner, name, kind, pathOf = (args) => args[0]) => {
    const original = owner[name];
    if (typeof original !== "function") return;
    const wrapped = function (...args) {
      try {
        if (kind === "s") record("s", "");
        else {
          const target = inRepo(pathOf(args));
          if (target !== null) record(kind, target);
        }
      } catch {
        // Recording must never change what the test sees.
      }
      return Reflect.apply(original, this, args);
    };
    // Keeps util.promisify.custom and realpath.native working on the wrapper.
    for (const key of Reflect.ownKeys(original)) {
      if (!["length", "name", "prototype", "arguments", "caller"].includes(key)) {
        wrapped[key] = original[key];
      }
    }
    owner[name] = wrapped;
  };

  // A glob lists its static prefix: the directory before the first wildcard.
  const globBase = (args) => {
    const [pattern, options] = args;
    const first = Array.isArray(pattern) ? pattern[0] : pattern;
    const cwd = typeof options?.cwd === "string" ? options.cwd : process.cwd();
    if (typeof first !== "string") return cwd;
    const parts = first.split(/[\\/]/);
    const index = parts.findIndex((part) => /[*?[\]{}!]/.test(part));
    return resolve(cwd, ...(index === -1 ? parts.slice(0, -1) : parts.slice(0, index)));
  };

  for (const name of READS) wrap(fs, name, "r");
  for (const name of LISTS) wrap(fs, name, "l");
  for (const name of GLOBS) wrap(fs, name, "l", globBase);
  for (const name of PROMISE_READS) wrap(fs.promises, name, "r");
  for (const name of PROMISE_LISTS) wrap(fs.promises, name, "l");
  wrap(fs.promises, "glob", "l", globBase);
  if (fs.realpathSync.native) wrap(fs.realpathSync, "native", "r");
  for (const name of SPAWNS) wrap(childProcess, name, "s");

  const OriginalWorker = workerThreads.Worker;
  workerThreads.Worker = class extends OriginalWorker {
    constructor(...args) {
      record("s", "");
      super(...args);
    }
  };

  syncBuiltinESMExports();
}
