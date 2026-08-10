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
 * ONE EXCEPTION, and it is the opposite of a loophole: the ledger may GROW when
 * the DETECTOR improves. It has, three times — when the JSX rule learned to read
 * text beginning on the line below its tag, when it learned to read around an
 * interpolation, and when rule 4 started seeing sentences held in string
 * literals rather than written into markup. Each time the number rose because
 * the guard had been wrong, not because the code had. A ledger that could only
 * ever shrink would have made all three fixes look like regressions, and
 * quietly discouraged every one of them.
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
 *   4. A SENTENCE IN A STRING LITERAL — `copy.ts`, a label map, a function that
 *      returns "Sam took this over". Added last and larger than the other three
 *      combined, which is the lesson: the copy somebody deliberately lifted OUT
 *      of a component is exactly the copy a component-shaped scanner misses.
 *
 * What is still NOT scanned, on purpose: the API's own refusals. Every client
 * renders `cause.message` verbatim because those sentences are the server's,
 * and translating them belongs there — a client-side catalogue entry for one
 * would be a second copy that drifts.
 *
 * A literal must also LOOK like prose: at least two words, or one word of four
 * or more letters that is not SCREAMING_CASE, kebab-case or a path. "Cancel" is
 * copy; "px-4" and "conversation_id" are not.
 *
 * ---------------------------------------------------------------------------
 * THREE CLIENTS, THREE LEDGERS
 *
 * #228's acceptance is "zero user-facing hardcoded literals on ANY client", and
 * a check that watched only the web app would report the web app finished while
 * two thirds of the product was untouched — which is the precise shape of the
 * parity failure #338 exists about.
 *
 * Each client keeps its own ledger because each has its own destination format
 * (a TypeScript catalogue, `strings.xml`, a String Catalog) and its own pace.
 * The detectors differ too, and only in WHERE a sentence appears: JSX text and
 * `aria-label` on web, `Text(...)` and `contentDescription` on Compose,
 * `Text(...)`/`Button(...)`/`.accessibilityLabel` on SwiftUI. What counts as
 * prose is one function for all three, because "is this a sentence or an
 * identifier" is not a platform question.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The three clients, each with the root it scans, the extensions it reads, and
 * the ledger that records what is left.
 */
const CLIENTS = {
  web: {
    root: "apps/web/src",
    ledger: "scripts/hardcoded-strings.json",
    /*
     * `.ts` as well as `.tsx`, since rule 4.
     *
     * The copy that turned out to be hiding is disproportionately in plain
     * modules — `components/porting/copy.ts`, `lib/auth/messages.ts`,
     * `lib/settings/audit-sentence.ts`. A scanner that only read components
     * would report the app finished while every sentence somebody deliberately
     * lifted OUT of a component stayed English.
     */
    exts: [".tsx", ".ts"],
    find: findWebLiterals,
    fix:
      "route them through useT()/makeTranslate and add the keys to a file in " +
      "apps/web/src/i18n/sections/ (both languages — tsc enforces it)",
  },
  android: {
    root: "apps/android/app/src/main/kotlin",
    ledger: "scripts/hardcoded-strings.android.json",
    exts: [".kt"],
    find: findKotlinLiterals,
    fix: "move them into res/values/strings.xml and read them with stringResource()",
  },
  ios: {
    root: "apps/ios/Loonext",
    ledger: "scripts/hardcoded-strings.ios.json",
    exts: [".swift"],
    find: findSwiftLiterals,
    fix:
      "move them into the String Catalog and read them with a LocalizedStringKey",
  },
};

/**
 * Directories this ledger does not count, each for a reason.
 *
 * THE MARKETING SITE IS THE SHARP ONE, and it is excluded rather than forgotten.
 * #228 separates them itself: the app's French is a per-PERSON setting resolved
 * at runtime, while the site's is a Bill 96 deliverable that needs real French
 * URLs, translated slugs and `hreflang` — an SEO problem with a routing answer,
 * not a catalogue one. Folding 443 marketing literals into this ledger would
 * report them against a plan that cannot fix them, and a ledger with entries
 * nobody can close is a ledger people stop reading.
 *
 * It is tracked as its own item on #228 and is not done until it is done.
 */
const SKIP_DIRS = new Set([
  "marketing", // the Bill 96 site — its own deliverable, its own URLs
  "(marketing)", // the same site's routed pages, for the same reason
  "i18n", // the catalogue IS the strings
  "brand", // wordmarks and asset names
]);

/** A file whose strings are not read by a person. */
function isScannable(path, exts) {
  if (!exts.some((ext) => path.endsWith(ext))) return false;
  if (/\.test\.|\.stories\.|Test\.kt$|Tests\.swift$/.test(path)) return false;
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

/**
 * Single type arguments that sit between two angle brackets and read as words.
 *
 * Each is a TypeScript name, never a label. See the note at the call site for
 * why this is an explicit list rather than a pattern.
 */
const TYPE_ARGUMENTS = new Set([
  "next", // ComponentProps<typeof import("next/...")>
  "Promise",
  "apiFetch",
  "VariantProps",
  "TertiaryProps",
]);

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
  /*
   * CODE, caught by the JSX-text rule reaching across a TYPE ARGUMENT.
   *
   * `useState<string | null>(null); const timer = useRef<` scores as five words
   * of English between a `>` and a `<`, and there is no way for a regex working
   * on JSX text to tell that `>` from a closing tag. Left in, the ledger could
   * never reach zero — and #228's acceptance is zero, so a permanent residue
   * would turn the finish line into an argument.
   *
   * The discriminator is punctuation a SENTENCE does not contain. A semicolon,
   * an `=`, a quote or a backtick inside JSX text is a statement, not copy: real
   * copy that needs a quotation mark uses the typographic one, and real copy
   * never assigns anything. Deliberately not a list of React hook names, which
   * would be a vocabulary that goes stale (a-shape-test-is-a-vocabulary).
   */
  if (/[;="`]/.test(text)) return false;

  /*
   * The other half of the same problem: a JSX TERNARY.
   *
   * `) : company.isError ? (` sits between the `>` of one element and the `<`
   * of the next, and reads as four words of English. No sentence begins with a
   * closing bracket or ends with an opening one — and that is a property of the
   * SHAPE rather than of any identifier, so it cannot go stale the way a list
   * of hook names would (a-shape-test-is-a-vocabulary).
   */
  if (/^[)\]}]/.test(text) || /[([{]$/.test(text)) return false;

  /*
   * A TYPE EXPRESSION continued across a `>`.
   *
   * `, offsets: Map<…`, `& VariantProps<…`, `, keyof TertiaryProps` — the
   * capture begins where one type argument ended, so it opens with the operator
   * that joins them. No sentence opens with a comma, an ampersand, a pipe, a
   * colon or a full stop.
   */
  if (/^[,&|:.]/.test(text)) return false;

  /*
   * And the last residue: a BARE IDENTIFIER between two angle brackets.
   *
   * `Promise`, `apiFetch`, `next` — each is a single type argument, and each is
   * indistinguishable from a one-word label by shape alone. They are named
   * rather than pattern-matched because that is the honest way round: a
   * heuristic broad enough to exclude them would also exclude `Spam` and
   * `Waiting`, which ARE labels, and a guard that silently drops real copy is
   * the failure this whole file exists to prevent.
   *
   * The cost of the list is that it needs an entry when a new type name shows
   * up between brackets. That is a visible, one-line diff with a reason —
   * unlike a threshold, which goes wrong quietly (a-shape-test-is-a-vocabulary).
   */
  if (TYPE_ARGUMENTS.has(text)) return false;

  /*
   * A COMPARISON, spanning a `<` or a `>` operator.
   *
   * `new Date(shift.starts_at).getTime()` sits between the `>` of one
   * comparison and the `<` of the next. The tell is a CALL — an identifier
   * immediately followed by an opening bracket, which is code everywhere and
   * copy nowhere. Real prose that needs a bracket puts a space before it
   * ("Deposit (half up front)"), so this does not eat any sentence.
   */
  if (/[A-Za-z_$]\(/.test(text)) return false;

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
export function findWebLiterals(source) {
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
  for (const match of code.matchAll(/(=?)>([^<>]+)</g)) {
    // An ARROW, not a closing tag. `() => { … }` puts a `>` in front of a body
    // that is entirely code, and every fragment after it reads as English.
    if (match[1] === "=") continue;
    /*
     * EXPRESSIONS ARE CUT OUT, not treated as a wall.
     *
     * The first version excluded `{` and `}` from the class, which meant a text
     * node containing ANY interpolation was invisible in its entirety —
     * `<p>{businessName} asks for</p>` matched nothing at all, and so did every
     * sentence with a name, an amount or a count in the middle of it. Those are
     * disproportionately the sentences that matter, because a sentence worth
     * interpolating into is a sentence somebody wrote deliberately.
     *
     * Found the same way as the newline bug: by extracting a file by hand and
     * reading what the guard still had not noticed.
     */
    for (const fragment of match[2].split(/\{[^{}]*\}/)) {
      const text = fragment.replace(/\s+/g, " ");
      /*
       * A STRAY BRACE means the split did not do its job.
       *
       * `.split(/\{[^{}]*\}/)` removes BALANCED interpolations only, and a
       * conditional child closes its brace after the next `<`
       * (`<div>{ready && <Thing/>}</div>`) — so the fragment keeps an opening
       * `{` and is code, not the tail of a sentence. Real JSX text never
       * carries a lone brace: an author who wants one writes `&#123;`.
       *
       * This rule and the `=>` one below were measured by an extraction agent
       * on the tree: together they take the false-positive count from 97 to 19
       * without touching a single real fragment.
       */
      if (/[{}]/.test(text)) continue;
      if (looksLikeProse(text)) found.push(text.trim());
    }
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

  /*
   * 4. A SENTENCE HELD IN A STRING LITERAL — the category the first three rules
   *    could not see, and the one that turned out to be larger than all of them.
   *
   * `components/porting/copy.ts`, `lib/auth/messages.ts`, a `CANCELLATION_REASONS`
   * label map, a `systemLine()` that returns "Sam took this over" — none of it
   * written in JSX, all of it read by a person. Two hundred and sixty-two of
   * them, found only after the JSX rules had gone quiet. A guard reporting zero
   * while a `copy.ts` sits untranslated is this file's own failure mode, one
   * level up.
   *
   * Deliberately a SENTENCE test rather than a word test: three or more words,
   * mostly letters, opening like a sentence. Two-word literals are usually
   * identifiers ("not found", "user id") and reporting those would be the
   * crying-wolf version; copy that short is caught in JSX by rule 1 or behind an
   * attribute by rule 2.
   */
  for (const match of code.matchAll(/"([^"\n]{12,})"/g)) {
    if (isSentenceLiteral(match[1])) found.push(match[1]);
  }

  return found;
}

/** Three or more words, mostly letters, opening like a sentence. */
function isSentenceLiteral(value) {
  const text = value.trim();
  if (text.length < 12) return false;
  if (text.includes("://") || text.startsWith("/") || text.startsWith("#")) return false;
  if (/^[\w\-.]+$/.test(text)) return false;
  if (/^[a-z0-9_]+(\.[a-z0-9_]+)+$/i.test(text)) return false;
  // Class soup, in any of the shapes this app writes it.
  if (
    /\b(px|py|mt|mb|ml|mr|pt|pb|pl|pr|text|bg|flex|grid|rounded|border|gap|w|h|min|max|top|left|right|bottom|z|opacity|shadow|ring|hover|focus|dark|sm|md|lg|xl)-/.test(
      text,
    )
  ) {
    return false;
  }
  if (text.split(/\s+/).filter(Boolean).length < 3) return false;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  return letters / text.length > 0.6 && /^[A-Z"‘“(]/.test(text);
}

/** Comments stripped, so prose ABOUT the UI is never counted as UI. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ 	]*\/\/\/?.*$/gm, "");
}

/**
 * Compose: the places a sentence reaches somebody holding a phone.
 *
 * `Text(` is the bulk of it. `contentDescription` is the one that would be
 * quietly skipped by a check written from what is visible on screen — it is
 * read aloud by TalkBack, so leaving it English is leaving the app English for
 * exactly the users least able to work around it.
 */
export function findKotlinLiterals(source) {
  const found = [];
  const code = stripComments(source);
  for (const match of code.matchAll(
    /\b(?:Text|OutlinedButton|TextButton|Button)\s*\(\s*"([^"]{4,})"/g,
  )) {
    if (looksLikeProse(match[1])) found.push(match[1]);
  }
  for (const match of code.matchAll(
    /\b(?:contentDescription|placeholder|label|title|supportingText)\s*=\s*"([^"]{4,})"/g,
  )) {
    if (looksLikeProse(match[1])) found.push(match[1]);
  }
  return found;
}

/**
 * SwiftUI: the same question, in the idiom that answers it there.
 *
 * `Text("…")` and `Button("…")` carry most of it; `.accessibilityLabel` is the
 * VoiceOver twin of Compose's `contentDescription` and matters for the same
 * reason. `.navigationTitle` is included because a screen whose title is
 * English while its body is French reads as a half-finished app.
 */
export function findSwiftLiterals(source) {
  const found = [];
  const code = stripComments(source);
  for (const match of code.matchAll(
    /\b(?:Text|Button|Label|TextField|SecureField|Toggle|Section)\s*\(\s*"([^"]{4,})"/g,
  )) {
    if (looksLikeProse(match[1])) found.push(match[1]);
  }
  for (const match of code.matchAll(
    /\.(?:accessibilityLabel|accessibilityHint|navigationTitle|help)\(\s*"([^"]{4,})"\)/g,
  )) {
    if (looksLikeProse(match[1])) found.push(match[1]);
  }
  return found;
}

function scan(client) {
  const counts = {};
  const all = walk(client.root);
  for (const file of all) {
    if (!isScannable(file, client.exts)) continue;
    const literals = client.find(readFileSync(file, "utf8"));
    if (literals.length > 0) {
      counts[relative(client.root, file).replaceAll("\\", "/")] = literals.length;
    }
  }
  return counts;
}

function readLedger(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

const baseline = process.argv.includes("--baseline");
/** `--only web` narrows a run while one client is being worked on. */
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex === -1 ? null : process.argv[onlyIndex + 1];

let failed = 0;
const summary = [];

for (const [name, client] of Object.entries(CLIENTS)) {
  if (only && only !== name) continue;
  const counts = scan(client);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  if (baseline) {
    const sorted = Object.fromEntries(
      Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
    );
    writeFileSync(client.ledger, `${JSON.stringify(sorted, null, 2)}
`);
    console.log(
      `Wrote ${client.ledger}: ${Object.keys(sorted).length} file(s), ${total} literal(s).`,
    );
    continue;
  }

  const ledger = readLedger(client.ledger);
  const problems = [];

  for (const [file, count] of Object.entries(counts)) {
    const allowed = ledger[file];
    if (allowed === undefined) {
      problems.push(
        `  ${file}: ${count} hardcoded user-facing string(s) in a file that had none.
` +
          `    → ${client.fix}.`,
      );
      continue;
    }
    if (count > allowed) {
      problems.push(
        `  ${file}: ${count} hardcoded string(s), the ledger allows ${allowed}.
` +
          "    → a NEW literal joined a file that was already waiting to be " +
          "extracted. Translate it now rather than adding to the backlog.",
      );
    } else if (count < allowed) {
      problems.push(
        `  ${file}: down to ${count} from ${allowed} — good. Re-run with ` +
          "--baseline so the slot cannot be silently refilled.",
      );
    }
  }

  for (const file of Object.keys(ledger)) {
    if (counts[file] === undefined) {
      problems.push(
        `  ${file}: fully extracted, but still in the ledger. Re-run with ` +
          "--baseline so it can never come back.",
      );
    }
  }

  if (problems.length > 0) {
    failed += 1;
    console.error(`\n${name}: hardcoded user-facing strings\n`);
    console.error(problems.join("\n"));
  }
  summary.push(
    total === 0
      ? `${name}: none — every user-facing string is in the catalogue`
      : `${name}: ${total} left in ${Object.keys(counts).length} file(s)`,
  );
}

if (baseline) process.exit(0);

if (failed > 0) {
  console.error(
    "\n#228: the ledger only shrinks, on every client. " +
      `${summary.join(" · ")}\n`,
  );
  process.exit(1);
}

console.log(`Hardcoded strings — ${summary.join(" · ")}. No file grew.`);
