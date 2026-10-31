#!/usr/bin/env node
/**
 * No live production secret in any file under the checkout.
 *
 *   node scripts/check-local-secrets.mjs              committable files only
 *   node scripts/check-local-secrets.mjs --all        gitignored files too
 *   node scripts/check-local-secrets.mjs --root <dir> another clone
 *
 * WHY. The repository is public, and agents work in it holding production
 * keys (docs/RIG.md and its 2026-10-30 amendment). The default mode is the
 * push gate: every file git would stage, tracked or new, so a key pasted into
 * a fixture, a runbook or a scratch file is refused before it is published.
 * `--all` adds the gitignored files, which is the reach check FA1 relies on:
 * it is how a production block in `apps/api/.dev.vars` is found, and on a
 * machine that still holds one it fails by design.
 *
 * WHAT IT READS. Five shapes, each a credential that reaches production on
 * its own: a live Stripe secret or restricted key, a Telnyx v2 key (there is
 * one Telnyx account and it is production's), a Supabase secret key, and a
 * Postgres URL with a password for a Supabase pooler or database host. The
 * Supabase CLI's published local key, and obvious placeholders, are not
 * secrets and pass. Each file is read as written and with its JSON and URL
 * escapes undone, UTF-16 is decoded, and any other binary is read for its
 * ASCII runs: transcripts, request logs and Windows "Unicode" files are where
 * pasted keys end up.
 *
 * WHAT IT PRINTS. The file and the shape's name, never the text that matched:
 * this output lands in agent transcripts and CI logs, which would otherwise
 * become the leak.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A shape must start a token, so a prefix buried inside an identifier is not read as one. */
const START = "(?<![A-Za-z0-9_-])";

export const SHAPES = [
  { name: "stripe-live-secret-key", pattern: new RegExp(`${START}sk_live_[A-Za-z0-9]{20,}`, "g") },
  { name: "stripe-live-restricted-key", pattern: new RegExp(`${START}rk_live_[A-Za-z0-9]{20,}`, "g") },
  // The same floor as .gitleaks.toml and the pre-commit hook.
  { name: "telnyx-v2-key", pattern: new RegExp(`${START}KEY[0-9A-F]{24,}(?:_[A-Za-z0-9]+)?`, "g") },
  { name: "supabase-secret-key", pattern: new RegExp(`${START}sb_secret_[A-Za-z0-9_-]{20,}`, "g") },
  {
    name: "pooler-url-with-password",
    pattern:
      /postgres(?:ql)?:\/\/[^\s:/@'"`<>]+:([^\s@'"`]+)@(?:[A-Za-z0-9-]+\.)*(?:pooler\.supabase\.com|supabase\.co)\b/g,
  },
];

/** The Supabase CLI's default local key: identical on every machine, it reaches only a container on 127.0.0.1. */
export const PUBLISHED_LOCAL_KEYS = new Set(["sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz"]);

/**
 * Committed files that hold a vendor's published example of a shape, by how
 * many. The file is still read, so anything beyond the count fails, and a
 * count that falls must be lowered here.
 */
export const ALLOWED = {
  // Telnyx's own OpenAPI spec, vendored for check-telnyx-endpoints. The one
  // match is the example value of a managed account's key, written by Telnyx.
  "telnyx-spec3.json": { "telnyx-v2-key": 1 },
};

const PLACEHOLDER = /0123456789abcdef|x{8}|not[_-]?a[_-]?real|placeholder|example|dummy|fake|redacted/i;
const PASSWORD_PLACEHOLDER =
  /^(?:<.*|\[.*|\{.*|\$.*|%3C.*|\*+|x+|\.{3,}|password|pw|pwd|pass|secret|test|changeme|your[_-]?password.*)$/i;

/** Directories under an ignored path that hold dependencies or build output, never a credential someone wrote. */
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".pnpm-store", ".next", ".open-next", ".wrangler", ".turbo",
  ".cache", ".gradle", ".kotlin", ".idea", ".vs", "dist", "build", "out", "coverage",
  "DerivedData", "Pods", ".swiftpm", ".expo", "playwright-report", "test-results",
]);

const BINARY = /\.(?:png|jpe?g|gif|webp|avif|ico|icns|pdf|zip|gz|tgz|br|woff2?|ttf|otf|eot|mp3|wav|ogg|m4a|mp4|mov|webm|keystore|jks|apk|aab|jar|class|so|dylib|dll|exe|bin|wasm|db|sqlite)$/i;
/** Larger than any file someone wrote by hand; each one skipped is named in the output. */
const MAX_BYTES = 64 * 1024 * 1024;

function isPlaceholder(shape, match) {
  if (PUBLISHED_LOCAL_KEYS.has(match[0])) return true;
  if (shape.name === "pooler-url-with-password") return PASSWORD_PLACEHOLDER.test(match[1]);
  return PLACEHOLDER.test(match[0]);
}

/**
 * JSON, JavaScript and URL escapes undone, twice for a doubly escaped dump. A
 * key after `\n` or `%20` follows an escape's letter or digit, which START
 * would read as part of an identifier. Escaped line breaks become spaces so
 * they still separate tokens.
 */
export function unescaped(text) {
  let out = text;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = out
      .replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\+u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\+x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\+[nrtbfv0]/g, " ")
      .replace(/\\+([^A-Za-z0-9\s])/g, (_, char) => char);
    if (next === out) break;
    out = next;
  }
  return out;
}

function countShape(shape, text) {
  let count = 0;
  for (const match of text.matchAll(shape.pattern)) {
    if (!isPlaceholder(shape, match)) count += 1;
  }
  return count;
}

/**
 * The shapes a text holds, by name and count, read as written and with its
 * escapes undone. Each shape counts the larger of the two readings, so a key
 * found both ways is one key. The matched text never leaves this function.
 */
export function findShapes(text) {
  const decoded = /[\\%]/.test(text) ? unescaped(text) : text;
  const found = [];
  for (const shape of SHAPES) {
    const count = Math.max(countShape(shape, text), decoded === text ? 0 : countShape(shape, decoded));
    if (count > 0) found.push({ shape: shape.name, count });
  }
  return found;
}

function gitFiles(root, args) {
  return execFileSync("git", ["ls-files", "-z", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}

/**
 * A gitignored directory holding its own `.git` is another checkout, such as
 * an agent's worktree under `.claude/worktrees/`. It is skipped here and
 * read by its own run with `--root`, where its tracked files count as
 * committable and its allowances apply.
 */
function walk(root, relative, into) {
  if (existsSync(join(root, relative, ".git"))) return;
  let entries;
  try {
    entries = readdirSync(join(root, relative), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, path, into);
    } else if (entry.isFile()) {
      into.push(path);
    }
  }
}

/** Committable files, and with `all` the gitignored ones outside dependency and build trees. */
export function listFiles(root, { all = false } = {}) {
  const committable = new Set(gitFiles(root, ["--cached", "--others", "--exclude-standard"]));
  const ignored = [];
  if (all) {
    for (const entry of gitFiles(root, ["--others", "--ignored", "--exclude-standard", "--directory"])) {
      if (entry.endsWith("/")) {
        const name = entry.slice(0, -1).split("/").pop();
        if (!SKIP_DIRS.has(name)) walk(root, entry.slice(0, -1), ignored);
      } else if (!entry.split("/").some((part) => SKIP_DIRS.has(part))) {
        ignored.push(entry);
      }
    }
  }
  return {
    committable: [...committable].sort(),
    ignored: [...new Set(ignored)].filter((file) => !committable.has(file)).sort(),
  };
}

/** "le" or "be" when a NUL-bearing head reads as UTF-16 text without a byte-order mark. */
function utf16Order(head) {
  const pairs = Math.floor(head.length / 2);
  if (pairs < 2) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i + 1 < head.length; i += 2) {
    if (head[i] === 0) evenZeros += 1;
    if (head[i + 1] === 0) oddZeros += 1;
  }
  if (oddZeros / pairs > 0.3 && evenZeros / pairs < 0.05) return "le";
  if (evenZeros / pairs > 0.3 && oddZeros / pairs < 0.05) return "be";
  return null;
}

function fromUtf16(bytes, order) {
  const even = bytes.subarray(0, bytes.length - (bytes.length % 2));
  return (order === "be" ? Buffer.from(even).swap16() : even).toString("utf16le");
}

/**
 * A file's text and how it was read. UTF-16, what Windows tools call
 * "Unicode", is decoded rather than skipped as binary. Any other file with a
 * NUL is read for its ASCII runs, where a key pasted into a binary would sit.
 */
export function readText(path) {
  const bytes = readFileSync(path);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: fromUtf16(bytes.subarray(2), "le"), encoding: "utf16" };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: fromUtf16(bytes.subarray(2), "be"), encoding: "utf16" };
  const head = bytes.subarray(0, 8000);
  if (!head.includes(0)) return { text: bytes.toString("utf8"), encoding: "utf8" };
  const order = utf16Order(head);
  if (order) return { text: fromUtf16(bytes, order), encoding: "utf16" };
  return { text: bytes.toString("latin1"), encoding: "binary" };
}

/** Every file's shapes under a root, and how much was read to find them. */
export function scan(root, { all = false } = {}) {
  const { committable, ignored } = listFiles(root, { all });
  const findings = [];
  const read = new Set();
  const counts = { committable: 0, ignored: 0, skipped: 0, utf16: 0, binary: 0 };
  const oversized = [];
  for (const [kind, files] of [["committable", committable], ["ignored", ignored]]) {
    for (const file of files) {
      const path = join(root, file);
      if (!existsSync(path)) continue;
      if (BINARY.test(file)) {
        counts.skipped += 1;
        continue;
      }
      if (statSync(path).size > MAX_BYTES) {
        counts.skipped += 1;
        oversized.push(file);
        continue;
      }
      const { text, encoding } = readText(path);
      counts[kind] += 1;
      if (encoding !== "utf8") counts[encoding] += 1;
      read.add(file);
      const shapes = findShapes(text);
      if (shapes.length > 0) findings.push({ file, ignored: kind === "ignored", shapes });
    }
  }
  return { findings, counts, read, oversized };
}

/**
 * Findings that fail, after the published examples in ALLOWED. An allowance
 * that is no longer used in full, or whose file is gone, fails too, so the
 * list cannot outlive what it excuses.
 */
export function judge({ findings, read }, allowed = ALLOWED) {
  const failures = [];
  const used = new Map();
  for (const { file, ignored, shapes } of findings) {
    const excused = ignored ? {} : allowed[file] ?? {};
    const over = [];
    for (const { shape, count } of shapes) {
      const allowance = excused[shape] ?? 0;
      if (!ignored) used.set(`${file}::${shape}`, count);
      if (count > allowance) over.push(`${shape} (${count}${allowance ? `, ${allowance} allowed` : ""})`);
    }
    if (over.length > 0) failures.push(`${file}${ignored ? " [gitignored]" : ""}: ${over.join(", ")}`);
  }
  for (const [file, shapes] of Object.entries(allowed)) {
    if (!read.has(file)) {
      failures.push(`${file} is in ALLOWED but was not read; delete the entry`);
      continue;
    }
    for (const [shape, allowance] of Object.entries(shapes)) {
      const count = used.get(`${file}::${shape}`) ?? 0;
      if (count < allowance) {
        failures.push(
          `${file}: ALLOWED excuses ${allowance} ${shape} but ${count} remain; lower it in ` +
            `scripts/check-local-secrets.mjs${count === 0 ? " (delete the entry)" : ""}`,
        );
      }
    }
  }
  return failures;
}

/** A reader that has gone blind passes everything, so reading nothing fails. */
export function coverage(counts) {
  return counts.committable + counts.ignored > 0
    ? []
    : ["No files were read. This check is reading nothing; fix the file listing before trusting a pass"];
}

function main() {
  const argv = process.argv.slice(2);
  const all = argv.includes("--all");
  const rootFlag = argv.indexOf("--root");
  const root = rootFlag >= 0 && argv[rootFlag + 1] ? resolve(argv[rootFlag + 1]) : REPO_ROOT;

  const result = scan(root, { all });
  const { counts, oversized } = result;
  const failures = [...judge(result), ...coverage(counts)];
  const scope = all
    ? `${counts.committable} committable and ${counts.ignored} gitignored files`
    : `${counts.committable} committable files`;
  const detail = [
    counts.utf16 > 0 ? `${counts.utf16} decoded from UTF-16` : null,
    counts.binary > 0 ? `${counts.binary} binary read for their ASCII runs` : null,
    counts.skipped > 0 ? `${counts.skipped} binary-by-extension or oversized skipped` : null,
  ].filter(Boolean);
  const read = `${scope}${detail.length > 0 ? ` (${detail.join("; ")})` : ""}`;
  for (const file of oversized) console.error(`  ! ${file} is over ${MAX_BYTES / 1024 / 1024} MB and was not read`);
  const excused = Object.values(ALLOWED).reduce(
    (sum, shapes) => sum + Object.values(shapes).reduce((s, n) => s + n, 0),
    0,
  );

  if (failures.length > 0) {
    for (const failure of failures) console.error(`  x ${failure}`);
    console.error("");
    console.error(`check-local-secrets: ${failures.length} problem(s); read ${read}.`);
    console.error("  Move each secret out of the checkout: a password manager, a GitHub environment,");
    console.error("  or a file outside the repository. Nothing above prints one; open the file to see it.");
    process.exit(1);
  }
  console.log(
    `check-local-secrets: no live-secret shape in ${read}; ` +
      `${excused} published vendor example(s) excused.${all ? "" : " --all adds gitignored files."}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
