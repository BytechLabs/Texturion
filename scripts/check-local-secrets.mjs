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
 * secrets and pass.
 *
 * WHAT IT PRINTS. The file and the shape's name, never the text that matched:
 * this output lands in agent transcripts and CI logs, which would otherwise
 * become the leak.
 */
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
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
const PASSWORD_PLACEHOLDER = /^(?:<.*|\[.*|\{.*|\$.*|%3C.*|\*+|x+|\.{3,}|password|your[_-]?password.*)$/i;

/** Directories under an ignored path that hold dependencies or build output, never a credential someone wrote. */
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".pnpm-store", ".next", ".open-next", ".wrangler", ".turbo",
  ".cache", ".gradle", ".kotlin", ".idea", ".vs", "dist", "build", "out", "coverage",
  "DerivedData", "Pods", ".swiftpm", ".expo", "playwright-report", "test-results",
]);

const BINARY = /\.(?:png|jpe?g|gif|webp|avif|ico|icns|pdf|zip|gz|tgz|br|woff2?|ttf|otf|eot|mp3|wav|ogg|m4a|mp4|mov|webm|keystore|jks|apk|aab|jar|class|so|dylib|dll|exe|bin|wasm|db|sqlite)$/i;
const MAX_BYTES = 8 * 1024 * 1024;

function isPlaceholder(shape, match) {
  if (PUBLISHED_LOCAL_KEYS.has(match[0])) return true;
  if (shape.name === "pooler-url-with-password") return PASSWORD_PLACEHOLDER.test(match[1]);
  return PLACEHOLDER.test(match[0]);
}

/** The shapes a text holds, by name and count. The matched text never leaves this function. */
export function findShapes(text) {
  const found = [];
  for (const shape of SHAPES) {
    let count = 0;
    for (const match of text.matchAll(shape.pattern)) {
      if (!isPlaceholder(shape, match)) count += 1;
    }
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

function looksBinary(path) {
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(8000);
    const read = readSync(fd, head, 0, head.length, 0);
    return head.subarray(0, read).includes(0);
  } finally {
    closeSync(fd);
  }
}

/** Every file's shapes under a root, and how much was read to find them. */
export function scan(root, { all = false } = {}) {
  const { committable, ignored } = listFiles(root, { all });
  const findings = [];
  const read = new Set();
  const counts = { committable: 0, ignored: 0, skipped: 0 };
  for (const [kind, files] of [["committable", committable], ["ignored", ignored]]) {
    for (const file of files) {
      const path = join(root, file);
      if (!existsSync(path)) continue;
      const size = statSync(path).size;
      if (BINARY.test(file) || size > MAX_BYTES || looksBinary(path)) {
        counts.skipped += 1;
        continue;
      }
      counts[kind] += 1;
      read.add(file);
      const shapes = findShapes(readFileSync(path, "utf8"));
      if (shapes.length > 0) findings.push({ file, ignored: kind === "ignored", shapes });
    }
  }
  return { findings, counts, read };
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
  const { counts } = result;
  const failures = [...judge(result), ...coverage(counts)];
  const scope = all
    ? `${counts.committable} committable and ${counts.ignored} gitignored files`
    : `${counts.committable} committable files (--all adds gitignored ones)`;
  const skipped = counts.skipped > 0 ? `, ${counts.skipped} binary or oversized skipped` : "";
  const excused = Object.values(ALLOWED).reduce(
    (sum, shapes) => sum + Object.values(shapes).reduce((s, n) => s + n, 0),
    0,
  );

  if (failures.length > 0) {
    for (const failure of failures) console.error(`  x ${failure}`);
    console.error("");
    console.error(`check-local-secrets: ${failures.length} problem(s); read ${scope}${skipped}.`);
    console.error("  Move each secret out of the checkout: a password manager, a GitHub environment,");
    console.error("  or a file outside the repository. Nothing above prints one; open the file to see it.");
    process.exit(1);
  }
  console.log(
    `check-local-secrets: no live-secret shape in ${scope}${skipped}; ` +
      `${excused} published vendor example(s) excused.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
