#!/usr/bin/env node
/**
 * [#228] A user-facing sentence typed into a component is a sentence no
 * translator will ever see.
 *
 *   node scripts/check-hardcoded-strings.mjs
 *   node scripts/check-hardcoded-strings.mjs --baseline   # rewrite the ledger
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHY IT IS A LEDGER RATHER THAN A CLEAN GATE
 *
 * #228 names the failure mode itself: *"A lint rule / CI check that fails on a
 * new hardcoded user-facing literal. Without this the extraction rots in a
 * month."* It is right, and it is right about the order too — the check has to
 * exist BEFORE the extraction finishes, or every file extracted this week is
 * re-broken by next week's feature.
 *
 * But a check that fails on all ~1,100 remaining literals from its first run is
 * a check that gets `--no-verify`'d on day one, and this repo has already
 * recorded that exact outcome twice: D68's scanner tuned into silence, and
 * D132's dependency gate that was red on every pull request until everybody
 * learned to merge past a red mark.
 *
 * So it is a LEDGER, in the shape this repo already uses for `UNGATED_WRITES`
 * and `SELF_SCOPED_WRITES`:
 *
 *   - Every file with un-extracted literals is listed, WITH ITS COUNT.
 *   - A file whose count GOES UP fails. That is the new-literal rule.
 *   - A file whose count goes DOWN fails too, until the ledger is updated —
 *     so a slot cannot be freed and silently refilled by the next change.
 *   - A file that reaches zero must LEAVE the ledger, and can never come back.
 *   - A file not in the ledger at all must have zero. That is what makes an
 *     extracted screen stay extracted.
 *
 * The ledger only shrinks. #228 is not done until it is empty, and its length
 * is the honest progress bar for that.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS USER-FACING, AND WHY THE LIST IS SHORT
 *
 * A general "string that looks like English" detector is the version that cries
 * wolf. Every className, every query key, every `sonner` id and every test id is
 * an English-looking string, and a check that reports them is a check nobody
 * reads. So this looks at the four places a sentence actually reaches a reader:
 *
 *   1. JSX TEXT   `<p>Something went wrong</p>`
 *   2. READER-FACING ATTRIBUTES  aria-label, placeholder, title, alt
 *   3. TOASTS     toast.success("…"), toast.error("…")
 *   4. THROWN/RETURNED COPY is deliberately NOT scanned — the API's refusals are
 *      the API's words (every client renders `cause.message` verbatim, on
 *      purpose), and translating them belongs to the server, not here.
 *
 * A literal must also LOOK like prose: at least two words, or one word of four
 * or more letters that is not SCREAMING_CASE, kebab-case or a path. "Cancel" is
 * copy; "px-4" and "conversation_id" are not.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "apps/web/src";
const LEDGER = "scripts/hardcoded-strings.json";

/**
 * Directories with nothing to translate, each for a reason.
 *
 * `marketing` is the sharp one and the reason it is here is #228's own: the
 * French marketing site is a Bill 96 deliverable with real French URLs, its own
 * slugs and its own hreflang. It is a different problem from the app's, and
 * folding it into this ledger would report a thousand literals against a plan
 * that is not this one.
 */
const SKIP_DIRS = new Set([
  "marketing", // the Bill 96 site — its own deliverable, its own URLs
  "i18n", // the catalogue IS the strings
  "brand", // wordmarks and asset names
]);

/** A file whose strings are not read by a person. */
function isScannable(path) {
  if (!path.endsWith(".tsx")) return false;
  if (path.includes(".test.")) return false;
  if (path.includes(".stories.")) return false;
  const parts = path.split("/");
  return !parts.some((part) => SKIP_DIRS.has(part));
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else {
      out.push(full.replaceAll("\\", "/"));
    }
  }
  return out;
}

/** Prose, or an identifier that happens to be spelled with letters? */
function looksLikeProse(value) {
  const text = value.trim();
  if (text.length < 4) return false;
  // A path, a URL, a token, a css class, an enum value, an id.
  if (/^[a-z0-9]+([-_/.][a-z0-9]+)+$/i.test(text)) return false;
  if (/^[A-Z0-9_]+$/.test(text)) return false;
  if (text.includes("://") || text.startsWith("/") || text.startsWith("#")) return false;
  // Tailwind and inline style soup: many tokens, no sentence punctuation.
  if (/^[\w\-:[\]()./%\s]+$/.test(text) && /\b(px|py|mt|mb|text|bg|flex|grid|rounded|border|gap|w|h)-/.test(text)) {
    return false;
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return /[A-Za-z]{2}/.test(text);
  return /^[A-Za-z][A-Za-z’'-]{3,}$/.test(text);
}

/**
 * Every user-facing literal in one file.
 *
 * Deliberately regex rather than a parser. A TypeScript AST pass would be more
 * precise and would add a build-time dependency on the compiler API to a guard
 * whose whole value is that it runs in the cheap step with no toolchain. The
 * precision it would buy is precision about EDGE cases; the ledger is what
 * absorbs those, and each one is visible as a count rather than hidden.
 */
export function findLiterals(source) {
  const found = [];
  // Strip comments so prose ABOUT the UI is not counted as UI.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  /*
   * 1. JSX text: between a `>` that closes a tag and the next `<`.
   *
   * NEWLINES ARE ALLOWED INSIDE THE MATCH, and that is this rule's correctness
   * rather than a detail. The first version required the text to begin on the
   * same line as the tag — which is the shape a formatter produces for a SHORT
   * string and never for a long one, so every sentence long enough to be
   * wrapped, which is every sentence that matters, was invisible to it.
   *
   * Caught by extracting a file by hand and watching the count refuse to move.
   * A guard that has only ever passed is a guard nobody has checked.
   *
   * The class still excludes `<`, `>` and braces, so a match can neither cross
   * a tag boundary nor swallow an expression; what it gains is the indent.
   */
  for (const match of code.matchAll(/>([^<>{}]+)</g)) {
    const text = match[1].replace(/\s+/g, " ");
    if (looksLikeProse(text)) found.push(text.trim());
  }

  // 2. Reader-facing attributes.
  for (const match of code.matchAll(
    /\b(aria-label|placeholder|title|alt|aria-description)=\{?"([^"]+)"/g,
  )) {
    if (looksLikeProse(match[2])) found.push(match[2]);
  }

  // 3. Toasts.
  for (const match of code.matchAll(
    /\btoast\.(?:success|error|info|warning|message)\(\s*"([^"]+)"/g,
  )) {
    if (looksLikeProse(match[1])) found.push(match[1]);
  }

  return found;
}

function scan() {
  const counts = {};
  for (const file of walk(ROOT)) {
    if (!isScannable(file)) continue;
    const literals = findLiterals(readFileSync(file, "utf8"));
    if (literals.length > 0) {
      counts[relative(ROOT, file).replaceAll("\\", "/")] = literals.length;
    }
  }
  return counts;
}

function readLedger() {
  try {
    return JSON.parse(readFileSync(LEDGER, "utf8"));
  } catch {
    return {};
  }
}

const counts = scan();

if (process.argv.includes("--baseline")) {
  const sorted = Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(LEDGER, `${JSON.stringify(sorted, null, 2)}\n`);
  const total = Object.values(sorted).reduce((sum, n) => sum + n, 0);
  console.log(
    `Wrote ${LEDGER}: ${Object.keys(sorted).length} file(s), ${total} literal(s).`,
  );
  process.exit(0);
}

const ledger = readLedger();
const problems = [];

for (const [file, count] of Object.entries(counts)) {
  const allowed = ledger[file];
  if (allowed === undefined) {
    problems.push(
      `  ${file}: ${count} hardcoded user-facing string(s) in a file that had none.\n` +
        "    → route them through useT()/makeTranslate and add the keys to " +
        "apps/web/src/i18n/catalog.ts (both languages — tsc enforces it).",
    );
    continue;
  }
  if (count > allowed) {
    problems.push(
      `  ${file}: ${count} hardcoded string(s), the ledger allows ${allowed}.\n` +
        "    → a NEW literal joined a file that was already waiting to be " +
        "extracted. Translate it now rather than adding to the backlog.",
    );
  } else if (count < allowed) {
    problems.push(
      `  ${file}: down to ${count} from ${allowed} — good. Run with --baseline ` +
        "so the slot cannot be silently refilled.",
    );
  }
}

for (const file of Object.keys(ledger)) {
  if (counts[file] === undefined) {
    problems.push(
      `  ${file}: fully extracted, but still in the ledger. Run with --baseline ` +
        "so it can never come back.",
    );
  }
}

const remaining = Object.values(counts).reduce((sum, n) => sum + n, 0);
if (problems.length > 0) {
  console.error("Hardcoded user-facing strings:\n");
  console.error(problems.join("\n"));
  console.error(
    `\n#228: the ledger only shrinks. ${remaining} literal(s) left in ` +
      `${Object.keys(counts).length} file(s).\n`,
  );
  process.exit(1);
}

console.log(
  remaining === 0
    ? "Hardcoded strings: none. Every user-facing string on web is in the catalogue."
    : `Hardcoded strings: ${remaining} left in ${Object.keys(counts).length} file(s), ` +
      "all of them known. No file grew.",
);
