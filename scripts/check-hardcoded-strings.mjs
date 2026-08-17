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
 * the DETECTOR improves. It has, four times — when the JSX rule learned to read
 * text beginning on the line below its tag, when it learned to read around an
 * interpolation, when rule 4 started seeing sentences held in string literals
 * rather than written into markup, and when rule 4 was finally given to the two
 * PHONES as well. Each time the number rose because the guard had been wrong,
 * not because the code had. A ledger that could only ever shrink would have made
 * all four fixes look like regressions, and quietly discouraged every one of
 * them.
 *
 * The fourth was the largest by far, and worth recording as a caution about
 * trusting a green guard. Rule 4 had lived on web since it was written, and the
 * two phone detectors had only their component-shaped rules — so Compose
 * reported 29 literals where 646 was the truth, and SwiftUI 318 where 1,300 was.
 * The ledger said 497 across three clients; the honest figure was 2,070. Every
 * screen extracted against that number was extracted against a fiction, and the
 * files that looked finished were the ones whose remaining copy simply lived in
 * a `when` branch or an `error =` rather than inside a `Text(`.
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
 * THREE CLIENTS AND WHAT THEY SHARE — FOUR LEDGERS
 *
 * #228's acceptance is "zero user-facing hardcoded literals on ANY client", and
 * a check that watched only the web app would report the web app finished while
 * two thirds of the product was untouched — which is the precise shape of the
 * parity failure #338 exists about.
 *
 * The fourth ledger exists because watching the three app trees turned out to
 * be the same mistake one level up. `packages/shared` held 325 user-facing
 * sentences — more than all three app ledgers put together — and not one of
 * them was counted. The web ledger read 26 and implied the web app was three
 * dozen strings from finished, while `send-failures.ts` alone put 29 English
 * sentences into a message bubble on every client.
 *
 * The blind spot has the same shape as the one rule 4 was written for, and the
 * note under `web.exts` below states it exactly: copy that somebody
 * deliberately lifted OUT of a component is invisible to a component-shaped
 * scanner. Lifting it into a shared package is that same move, one directory
 * further, and it hid an order of magnitude more.
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
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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
  /*
   * Not a client — the copy all three of them render.
   *
   * Scanned with the WEB detector because the source is TypeScript, and the
   * question rule 4 asks ("is this literal a sentence?") does not care which
   * app eventually renders it. What differs is the fix: a string here is
   * hand-ported into Kotlin and Swift, so leaving it English leaves it English
   * on three platforms at once, and translating it in one place fixes all
   * three. That leverage is the reason this ledger is worth its own line rather
   * than being folded into the web's.
   */
  shared: {
    root: "packages/shared/src",
    ledger: "scripts/hardcoded-strings.shared.json",
    exts: [".ts"],
    find: findWebLiterals,
    fix:
      "give the function a locale parameter and move the sentences into a " +
      "catalogue the three clients share, the way cancellation-offers.ts will",
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

/*
 * Catalogues that are FILES rather than directories.
 *
 * Everywhere else the catalogue is a directory and [SKIP_DIRS] handles it.
 * `locale.ts` is one file holding both languages, and it is deliberate: its
 * docblock explains that these are carrier message bodies billed by the
 * segment, so the French is written to the GSM-7 alphabet — one character
 * outside it halves what fits in a segment. That editorial constraint is why
 * the copy is not in a translation file, and scanning it counted fifteen
 * FINISHED French translations as French translations outstanding.
 *
 * Matched on the path suffix so a same-named file elsewhere is unaffected.
 */
const SKIP_FILES = ["packages/shared/src/locale.ts"];

/**
 * #228 — a file that holds a `Record<Locale, …>` copy table is a DESTINATION,
 * not a backlog.
 *
 * The same mistake this file has already recorded twice, in a third shape. The
 * `locale.ts` skip above exists because scanning it "counted fifteen FINISHED
 * French translations as French translations outstanding"; the case-insensitive
 * directory skip below exists because 1,476 finished translations were being
 * reported as translation work. This is that again: when a push notification's
 * copy was moved into a two-language table, the scanner counted the French
 * renderings as new hardcoded English, and the ledger GREW by doing exactly the
 * work the ledger exists to encourage. A guard that fails when you fix the
 * thing it is guarding is a guard that teaches people to stop fixing it.
 *
 * Matched on the SHAPE rather than a path list, which is the part that keeps
 * this from rotting: the next copy table is covered the day it is written, and
 * nobody has to remember to add it here. The shape is load-bearing rather than
 * incidental — `Record<Locale, X>` means both languages are present or the file
 * does not compile, which is a stronger guarantee than this scanner can offer.
 *
 * WHAT THIS GIVES UP: a file can hold a copy table AND an unrelated stray
 * literal, and the stray one stops being counted. That is the same trade the
 * `locale.ts` skip already makes — it is not a catalogue file either, it just
 * contains one — and the alternative is deciding which side of a table each
 * literal falls on, which is a parser rather than a scanner.
 */
function isCopyTable(source) {
  return /Record<\s*Locale\s*,/.test(source);
}

/** A file whose strings are not read by a person. */
export function isScannable(path, exts, source) {
  if (!exts.some((ext) => path.endsWith(ext))) return false;
  if (/\.test\.|\.stories\.|Test\.kt$|Tests\.swift$/.test(path)) return false;
  const unix = path.split("\\").join("/");
  if (SKIP_FILES.some((skip) => unix.endsWith(skip))) return false;
  if (source !== undefined && isCopyTable(source)) return false;
  /*
   * Case-INSENSITIVE, because the three clients disagree about capitals and the
   * Set does not. Android keeps its catalogue in `core/i18n`, iOS in
   * `Core/I18n` — so the exact-match version skipped one and scanned the other,
   * and every sentence in iOS's catalogue counted as a hardcoded literal.
   * Including the French ones: 1,476 finished translations were being reported
   * as translation work outstanding.
   */
  const parts = path.toLowerCase().split(/[/\\]/);
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
/**
 * JavaScript and TypeScript reserved words, plus the handful of contextual
 * keywords that open a statement.
 *
 * Closed by the language spec rather than by us — that is the whole reason
 * this is allowed to be a list at all. Compare `TYPE_ARGUMENTS` above, which
 * is OUR names and needs an entry whenever a new type shows up between
 * brackets; this one needs an entry when TC39 ships a keyword.
 */
const RESERVED_WORDS = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const",
  "continue", "declare", "default", "delete", "do", "else", "enum", "export",
  "extends", "finally", "for", "function", "if", "implements", "import", "in",
  "instanceof", "interface", "let", "new", "of", "readonly", "return",
  "satisfies", "static", "switch", "throw", "try", "type", "typeof", "var",
  "void", "while", "yield",
]);

/**
 * Is this a fragment of a statement rather than a sentence?
 *
 * True when a reserved word IS the text, or opens it followed by a space or a
 * bracket. Deliberately not "contains a reserved word": "Delete this if you
 * are sure" is copy, and a rule that ate it would be the silent-drop failure
 * this file exists to prevent.
 */
function isStatementFragment(text) {
  const first = /^([A-Za-z]+)(?=$|[\s(])/.exec(text);
  if (!first) return false;
  return RESERVED_WORDS.has(first[1]);
}

function looksLikeProse(value) {
  const text = value.trim();
  if (text.length < 4) return false;
  // A path, a URL, a token, a css class, an enum value, an id.
  if (/^[a-z0-9]+([-_/.][a-z0-9]+)+$/i.test(text)) return false;
  if (/^[A-Z0-9_]+$/.test(text)) return false;
  /*
   * A camelCase IDENTIFIER: one token, opening lowercase, a capital inside.
   *
   * `backdropDrift`, `vmPlayPause`, `swipeActionIcon`. Nobody writes copy that
   * way and nobody reads these — they are animation labels and test tags. The
   * shape has to be this specific because real copy CAN be one word ("Update",
   * "Dismiss", "Back"), so the rule keys on the internal capital after a
   * lowercase opening, which a sentence never has.
   */
  if (/^[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/.test(text)) return false;
  /*
   * Nothing but interpolation and punctuation: `"$method $path"`.
   *
   * Two "words" and mostly letters, so it scores as prose, but every letter in
   * it belongs to a variable name. What reaches a person is whatever those
   * variables hold, which is not this file's business.
   */
  if (isOnlyInterpolation(text)) return false;
  if (isDateFormatPattern(text)) return false;
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
   * A STATEMENT, caught by the same JSX/plain-module reach as the rules above.
   *
   * `finally`, `const`, `catch (cause)`, `if (data.session)`,
   * `interface NavRow`, `as const satisfies Record` — nineteen of the web
   * ledger's forty-five were shapes like these, and every one of them sends the
   * next person to look at a keyword.
   *
   * A RESERVED-WORD test is safe here in a way a list of hook names or type
   * names is not, and the distinction is worth stating because this file
   * already refuses two vocabularies on principle
   * (a-shape-test-is-a-vocabulary): the set below is closed by the LANGUAGE
   * SPEC. It does not grow when the product does, so it cannot go stale the way
   * a list of our own identifiers would.
   *
   * The rule is narrow on purpose. It fires when a reserved word is the WHOLE
   * text, or opens it followed by a space or a bracket — never when one merely
   * appears inside a sentence, because "Delete this if you are sure" is copy
   * and must survive.
   */
  if (isStatementFragment(text)) return false;

  /*
   * A BOOLEAN or ARROW operator.
   *
   * `0 && !markAllRead.isPending)`, `x => y`, `a !== b`. None of these
   * sequences occurs in English — `&&`, `||`, `=>`, `===` and `!==` are
   * punctuation a sentence has no use for, which is the same discriminator the
   * semicolon rule above uses.
   */
  if (/&&|\|\||=>|===|!==/.test(text)) return false;

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
/**
 * The English half of a bilingual pair, which is FINISHED rather than pending.
 *
 * `packages/shared/src/locale.ts` holds the French for every automated message
 * this product sends, and imports the English from the module that owns it — so
 * there is exactly one definition of each sentence, which is the point of that
 * arrangement. The ledger counted those English constants as translation work
 * outstanding, which is the same error that had it counting iOS's finished
 * catalogue: a completed pair, read from the wrong end.
 *
 * These must never become app catalogue keys either, and that is load-bearing
 * rather than tidy. They are carrier message bodies: their language comes from
 * `contacts.locale` and the customer receiving them, not from whoever is
 * holding the phone, and `locale.ts` writes them to the GSM-7 alphabet because
 * one character outside it halves what fits in a segment. Routing them through
 * a `t()` would answer in the CREW's language and drop the segment constraint
 * in the same move.
 *
 * Derived from `locale.ts`'s own import list rather than a hand-kept roster, so
 * a seventh message added there is covered the day it is added. Both plain
 * string constants and the `body` fields of a rule array, because the reminder
 * ladder is paired sentence-for-sentence like the rest of them.
 */
function bilingualPairEnglish() {
  /*
   * Anchored to THIS FILE, not to the working directory.
   *
   * The first version joined from `process.cwd()`, which is the repo root when
   * the guard runs and `packages/shared` when vitest runs — so the test found
   * `packages/shared/packages/shared/src/locale.ts`, caught the ENOENT, and
   * returned an empty set. The rule then excluded nothing while every
   * assertion about it still ran. Same shape as the ENOENT this file's own
   * header records.
   */
  const shared = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "shared", "src");

  let locale;
  try {
    locale = readFileSync(join(shared, "locale.ts"), "utf8");
  } catch {
    // No shared package in reach. Nothing to exclude, and not an error.
    return new Set();
  }

  const values = new Set();
  for (const line of locale.matchAll(/^import \{([^}]+)\} from "\.\/([\w-]+)";$/gm)) {
    let owner;
    try {
      owner = readFileSync(join(shared, `${line[2]}.ts`), "utf8");
    } catch {
      continue;
    }
    for (const name of line[1].split(",").map((part) => part.trim()).filter(Boolean)) {
      const declaration = new RegExp(
        `export const ${name}(?::[^=]+)?\\s*=\\s*((?:"(?:[^"\\\\]|\\\\.)*"(?:\\s*\\+\\s*\\n?\\s*)?)+);`,
        "m",
      );
      const hit = declaration.exec(owner);
      if (hit) {
        const pieces = [...hit[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
        /*
         * Both the JOIN and each PIECE.
         *
         * The join alone was the bug. A body long enough to need translating
         * is long enough to be written as a `+` chain across several lines,
         * and the scan asks about one quoted run at a time — so the set held
         * "Sorry we missed your call! This is {business_name}. Reply here
         * with your number..." while the scan asked about the first line of
         * it, missed, and filed a finished French pair as outstanding work.
         * Six bodies across four modules were counted that way.
         */
        values.add(pieces.join(""));
        for (const piece of pieces) if (piece.length > 8) values.add(piece);
        continue;
      }
      /*
       * And the LADDER, which is an array rather than a sentence.
       *
       * `DEFAULT_REMINDER_RULES` is a list of {offset_minutes, body} — the
       * offsets are the language-independent half and the bodies are paired
       * in `FR_CA_COPY.appointmentReminders` like every other automated
       * message. This function's own note used to say an array "has no
       * single sentence to exclude", which was true of the array and not of
       * the bodies inside it.
       */
      const array = new RegExp(
        `export const ${name}(?::[\\s\\S]*?)?=\\s*\\[([\\s\\S]*?)\\n\\];`,
        "m",
      ).exec(owner);
      if (!array) continue;
      for (const body of array[1].matchAll(
        /\bbody:\s*((?:"(?:[^"\\]|\\.)*"(?:\s*\+\s*\n?\s*)?)+)/g,
      )) {
        const pieces = [...body[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
        values.add(pieces.join(""));
        for (const piece of pieces) if (piece.length > 8) values.add(piece);
      }
    }
  }

  /*
   * And the bodies locale.ts writes out DIRECTLY, in either language.
   *
   * The loop above only reaches strings locale.ts imports from a sibling — it
   * was written when every English default lived in the module that owned the
   * feature. `onMyWay` is the first body defined in locale.ts itself, in both
   * languages, and it is hand-ported to Kotlin and Swift the way every other
   * body's PAIRING is not: the phones compose this one themselves.
   *
   * So the two ports carry both languages side by side, and the scanner read
   * them as two untranslated literals — reporting a finished translation as
   * outstanding work, which is the exact failure the locale.ts skip records in
   * its own comment.
   *
   * Narrow on purpose: a string is excluded only if locale.ts states it as a
   * value. That file is the one place automated bodies are defined, and
   * anything in it has both languages by construction — `AutomatedCopy` is a
   * typed record and TypeScript will not let a locale omit a field.
   */
  for (const table of ["EN_COPY", "FR_CA_COPY"]) {
    const block = new RegExp(`export const ${table}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`, "m").exec(
      locale,
    );
    if (!block) continue;
    for (const literal of block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      if (literal[1].length > 8) values.add(literal[1]);
    }
  }

  return values;
}

/**
 * A body that locale.ts states in BOTH languages is a finished translation, not
 * an untranslated literal — wherever it appears.
 *
 * The phones hand-port `onMyWay` because they compose that one themselves, so
 * each carries the English and the French side by side. Without this the
 * scanner counted a completed pair as two units of outstanding work, which is
 * the failure the locale.ts skip already records one level up.
 */
/** Computed once: it reads seven files and the scan asks per literal. */
const BILINGUAL_PAIR_ENGLISH = bilingualPairEnglish();

export function findWebLiterals(source, path = "") {
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
  /*
   * ONLY IN FILES THAT CAN CONTAIN JSX.
   *
   * In a plain `.ts` module `<` and `>` are GENERICS, not tags, and this rule's
   * class allows newlines — so it ran from the `>` closing one `Record<…>` to
   * the `<` opening the next, and reported every line between as JSX text.
   * `lib/api/types.ts` was credited with 66 literals on that basis: things like
   * `export interface Membership`, none of which is a string at all. That is
   * 53% of the whole web ledger, pointing at a file with no user-facing copy in
   * it.
   *
   * `.ts` is scanned for rule 4's sake — the sentences somebody lifted out of a
   * component into `copy.ts` — and rule 4 needs no tags. So the tag-shaped rules
   * are skipped where there are no tags.
   */
  const mayHaveJsx = !path.endsWith(".ts");

  for (const match of mayHaveJsx ? code.matchAll(/(=?)>([^<>]+)</g) : []) {
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
    if (BILINGUAL_PAIR_ENGLISH.has(match[2])) continue;
    if (looksLikeProse(match[2])) found.push(match[2]);
  }

  // 3. Toasts.
  for (const match of code.matchAll(
    /\btoast\.(?:success|error|info|warning|message)\(\s*"([^"]+)"/g,
  )) {
    if (BILINGUAL_PAIR_ENGLISH.has(match[1])) continue;
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
    if (BILINGUAL_PAIR_ENGLISH.has(match[1])) continue;
    if (isSentenceLiteral(match[1])) found.push(match[1]);
  }

  /*
   * 5. A SENTENCE HELD IN A TEMPLATE LITERAL — invisible to rule 4, and the
   *    reason the web number read as nearly done while whole live dialogs sat
   *    outside it.
   *
   * Rule 4 matches double quotes on ONE line. A sentence with a count, a price
   * or a name in the middle of it is written with backticks instead, and a
   * sentence long enough to need translating is usually long enough to be
   * wrapped across lines. So the two shapes that most reliably mark real copy —
   * being interpolated into, and being long — were the two this file could not
   * see. The spending-cap confirm dialog, the add-on billing confirms, the
   * attachment refusals and the segment meter were all found by hand, one at a
   * time, after Android had already been converted.
   *
   * The test is ENDS-LIKE-A-SENTENCE rather than starts-with-a-capital, which
   * is what rule 4 uses. A template literal frequently opens with its variable
   * (`${name} here. Your quote is ready.`), so the capital test rejects exactly
   * the interpolated sentences this rule exists for. Terminal punctuation
   * cannot be faked by a className, a URL or a query.
   *
   * Measured on the tree before being turned on: 11 in-scope matches, every one
   * of them real. Marketing is skipped by the same path list as everything else
   * here — that site is its own deliverable.
   */
  for (const match of code.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    const raw = match[1].replace(/\s+/g, " ").trim();
    const stripped = raw.replace(/\$\{[^{}]*\}/g, " ").replace(/\s+/g, " ").trim();
    if (BILINGUAL_PAIR_ENGLISH.has(raw) || BILINGUAL_PAIR_ENGLISH.has(stripped)) continue;
    /*
     * Judged on the STRIPPED text, reported RAW.
     *
     * Stripping is what makes the sentence testable — a variable is not a word
     * and would skew the letter ratio — but a stripped sentence is not
     * greppable, and the report exists so somebody can go and find the thing.
     * "You win % of the quotes that get an answer." appears in no file; the
     * raw literal it came from does.
     */
    if (isTemplateSentence(stripped)) found.push(raw);
  }

  return found;
}

/**
 * A template literal that reads as a sentence once its variables are removed.
 *
 * Shares rule 4's rejections — class soup, URLs, paths, dotted identifiers,
 * date patterns, nothing-but-interpolation — and swaps the opening-capital test
 * for a closing-punctuation one, because the sentences this rule exists to
 * catch usually open with their variable.
 */
function isTemplateSentence(text) {
  if (text.length < 12) return false;
  // A leftover brace means an interpolation was nested or unbalanced, so what
  // is left is code rather than the tail of a sentence.
  if (/[{}]/.test(text)) return false;
  if (!/[.?!]$/.test(text)) return false;
  if (text.includes("://") || text.startsWith("/") || text.startsWith("#")) return false;
  if (/^[\w\-.]+$/.test(text)) return false;
  if (
    /\b(px|py|mt|mb|ml|mr|pt|pb|pl|pr|text|bg|flex|grid|rounded|border|gap|w|h|min|max|top|left|right|bottom|z|opacity|shadow|ring|hover|focus|dark|sm|md|lg|xl)-/.test(
      text,
    )
  ) {
    return false;
  }
  if (text.split(/\s+/).filter(Boolean).length < 3) return false;
  if (isOnlyInterpolation(text)) return false;
  if (isDateFormatPattern(text)) return false;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  return letters / text.length > 0.6;
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
  if (isOnlyInterpolation(text)) return false;
  if (isDateFormatPattern(text)) return false;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  return letters / text.length > 0.6 && /^[A-Z"‘“(]/.test(text);
}

/**
 * Nothing but variables and punctuation — `"$method $path"`, `"\(name) · \(price)"`.
 *
 * Scores as prose because it is mostly letters and several words, but every
 * letter in it belongs to an identifier. Whatever a person reads here is
 * whatever those variables hold, and that copy lives wherever they came from.
 *
 * All three interpolation syntaxes, because the same mistake is available in
 * each: `${…}` and `$name` in Kotlin and TypeScript, `\(…)` in Swift. Only
 * Kotlin's was stripped at first, so every Swift string built purely out of
 * interpolations counted as a sentence needing translation.
 */
function isOnlyInterpolation(text) {
  const bare = text
    .replace(/\\\([^)]*\)/g, "")
    .replace(/\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*/g, "");
  return !/[A-Za-z]/.test(bare);
}

/**
 * A date or time FORMAT, not a sentence: `"MMMM d, yyyy"`, `"h:mm a"`.
 *
 * The signature is that every token is one letter repeated — `MMMM`, `yyyy`,
 * `mm`. No English word is built that way, so this cannot swallow copy. These
 * patterns do have to change per locale, but through a formatter's locale
 * argument rather than through a translated string, so counting them here would
 * point the reader at the wrong fix.
 */
function isDateFormatPattern(text) {
  const tokens = text.split(/[^A-Za-z]+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every(
    (token) => /^[yMdDhHmsSaAEeZzGwWkKLqQuvV]+$/.test(token) &&
      new Set(token).size === 1,
  );
}

/** Comments stripped, so prose ABOUT the UI is never counted as UI. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ 	]*\/\/\/?.*$/gm, "");
}

/**
 * Preview bodies stripped, because a preview is not a screen.
 *
 * `@Preview` on Android and `#Preview` on iOS render in the IDE and ship in no
 * build. The names and sentences inside them are FIXTURES — "Jordan Lee" on the
 * in-call screen is not a person any customer will meet, and translating it
 * would mean translating a fake caller's name into French.
 *
 * Counting them made the ledger overstate the work, which matters more than it
 * sounds: the ledger is the only number that says how much of #228 is left, and
 * a number inflated by fixtures hides the real remainder behind noise.
 *
 * Braces are matched with a counter that skips string literals, so a `{` inside
 * copy cannot run the scan off the end of the block.
 */
function stripPreviewBodies(source) {
  let out = source;
  // `@ResponsivePreviews` and friends are MULTI-preview annotations — one
  // annotation that expands to five `@Preview`s. Matching only `@Preview` left
  // their bodies in the count, which is how a fake caller called "Jordan Lee"
  // came to be tracked as a sentence somebody had to translate. The alternation
  // is explicit so `@PreviewParameter`, which annotates a parameter and not a
  // preview, cannot swallow a real function's body.
  for (const marker of [/@(?:Preview|\w+Previews)\b/g, /#Preview\b/g]) {
    let result = "";
    let index = 0;
    marker.lastIndex = 0;
    let match;
    while ((match = marker.exec(out)) !== null) {
      if (match.index < index) continue;
      const open = out.indexOf("{", match.index);
      if (open === -1) break;
      const close = matchingBrace(out, open);
      if (close === -1) break;
      result += out.slice(index, match.index);
      index = close + 1;
      marker.lastIndex = index;
    }
    out = result + out.slice(index);
  }
  return out;
}

/** The index of the `}` closing the `{` at [open], or -1. Skips strings. */
function matchingBrace(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') {
      i += 1;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\") i += 1;
        i += 1;
      }
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Is this `label =` an ANIMATION's debug label rather than a field's?
 *
 * Compose spends the same argument name on two unrelated jobs. On a text field
 * `label` is read by the person filling it in; on `animateFloatAsState`,
 * `updateTransition`, `AnimatedContent` and friends it is a string the
 * animation inspector shows a developer, and it has never been on a screen.
 *
 * Told apart by the SIBLING arguments rather than by the string, because the
 * string is exactly what we must not trust here — `label = "Country"` on a
 * field and `label = "sweep"` on a tween are both plausible either way round.
 */
function isAnimationLabel(code, matchIndex) {
  const window = code.slice(Math.max(0, matchIndex - 300), matchIndex);
  return /animationSpec\s*=|targetState\s*=|targetValue\s*=|\b\w*Transition\s*\(|\bCrossfade\s*\(/.test(
    window,
  );
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
  const code = stripPreviewBodies(stripComments(source));
  for (const match of code.matchAll(
    /\b(?:Text|OutlinedButton|TextButton|Button)\s*\(\s*"([^"]{4,})"/g,
  )) {
    if (BILINGUAL_PAIR_ENGLISH.has(match[1])) continue;
    if (looksLikeProse(match[1])) found.push(match[1]);
  }
  for (const match of code.matchAll(
    /\b(contentDescription|placeholder|label|title|supportingText)\s*=\s*"([^"]{4,})"/g,
  )) {
    if (match[1] === "label" && isAnimationLabel(code, match.index)) continue;
    if (BILINGUAL_PAIR_ENGLISH.has(match[2])) continue;
    if (looksLikeProse(match[2])) found.push(match[2]);
  }
  /*
   * A SENTENCE HELD IN A STRING LITERAL — the same rule 4 that, on web, turned
   * out to be larger than the other three rules combined.
   *
   * Kotlin had no equivalent, and the gap was the same shape: copy that
   * somebody deliberately lifted OUT of a composable is invisible to a
   * composable-shaped scanner. `RegistrationProgress` builds a `title`, a
   * `next` and an `expected` for every carrier state; only `title` was in an
   * attribute the rules above knew about, so the sentence a person actually
   * reads — "The carriers review it next. Nothing needed from you." — was not
   * counted anywhere. `MfaGate` held ten more in `error =` and in `when`
   * branches.
   *
   * This makes the ledger GROW, which the header at the top of this file
   * blesses explicitly and for this exact reason: the number rises because the
   * guard was wrong, not because the code got worse.
   */
  for (const match of code.matchAll(/"([^"\n]{12,})"/g)) {
    if (isKotlinPrecondition(code, match.index)) continue;
    if (isDiagnosticLog(code, match.index)) continue;
    if (BILINGUAL_PAIR_ENGLISH.has(match[1])) continue;
    if (isSentenceLiteral(match[1])) found.push(match[1]);
  }
  return dedupe(found);
}

/**
 * `require(length in 43..128) { "PKCE verifier must be 43-128 chars" }`.
 *
 * Kotlin's preconditions take a lazily-evaluated MESSAGE LAMBDA, and nothing a
 * customer reads is written that way — this is a programmer telling another
 * programmer that a caller is wrong.
 *
 * Deliberately narrow. The obvious version of this rule excludes every
 * assertion-ish call including `error(…)` and `throw …Error(…)`, and measuring
 * that on this repo found 26 literals of which 24 were REAL user-facing copy:
 * Swift throws custom errors carrying sentences the UI renders verbatim, and
 * Kotlin does the same with "Calling is temporarily unavailable." Excluding
 * those to silence two developer strings would have hidden two dozen.
 */
function isKotlinPrecondition(code, matchIndex) {
  const window = code.slice(Math.max(0, matchIndex - 160), matchIndex);
  return /\b(?:require|requireNotNull|check|checkNotNull|assert)\s*\([^;]*\)\s*\{\s*$/.test(
    window,
  );
}

/**
 * `Log.w(TAG, "Device push token registration failed.")`.
 *
 * Logcat is not a screen. These read like copy — they are whole sentences with
 * capitals and full stops, because the person who wrote them was being kind to
 * whoever reads the log next — and rule 4 counted all seventeen of them as work
 * somebody had to translate into French. Nobody holding a phone will ever see
 * one.
 *
 * Told apart by the CALL, never by the string: "Device push token registered."
 * and a sentence on a screen are the same shape, and any rule that guessed from
 * the words would eventually drop a real one. The receiver must end in `Log`
 * — which covers `android.util.Log` and this app's own `CallFlowLog` — and
 * our literal must sit inside its still-open argument list.
 *
 * Narrow on purpose, in the same way [isKotlinPrecondition] is. The tempting
 * wider rule excludes anything that looks diagnostic, and the docblock above
 * records what that costs: `CallStateMachine.error(down, "Calling is
 * temporarily unavailable.")` is a sentence a customer reads during a failed
 * call, and it survives this rule because `CallStateMachine` is not a log.
 */
function isDiagnosticLog(code, matchIndex) {
  const window = code.slice(Math.max(0, matchIndex - 200), matchIndex);
  return /\b(?:Log|[A-Z][A-Za-z]*Log)\.(?:v|d|i|w|e|wtf|log)\s*\([^)]*$/.test(window);
}

/**
 * One literal counted once.
 *
 * The rules overlap by design — `Text("…")` is also a string literal — and a
 * ledger that counted the same sentence twice would report a file as having
 * twice the work left in it.
 */
function dedupe(found) {
  return [...new Set(found)];
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
  const code = stripPreviewBodies(stripComments(source));
  for (const match of code.matchAll(
    /\b(?:Text|Button|Label|TextField|SecureField|Toggle|Section)\s*\(\s*"([^"]{4,})"/g,
  )) {
    if (BILINGUAL_PAIR_ENGLISH.has(match[1])) continue;
    if (looksLikeProse(match[1])) found.push(match[1]);
  }
  for (const match of code.matchAll(
    /\.(?:accessibilityLabel|accessibilityHint|navigationTitle|help)\(\s*"([^"]{4,})"\)/g,
  )) {
    if (BILINGUAL_PAIR_ENGLISH.has(match[1])) continue;
    if (looksLikeProse(match[1])) found.push(match[1]);
  }
  // Rule 4, for the same reason it exists on web and now on Compose: the copy
  // somebody lifted out of a view is exactly what a view-shaped scanner misses.
  const loggers = swiftLoggerNames(code);
  for (const match of code.matchAll(/"([^"\n]{12,})"/g)) {
    if (isSwiftDiagnosticLog(code, match.index, loggers)) continue;
    if (BILINGUAL_PAIR_ENGLISH.has(match[1])) continue;
    if (isSentenceLiteral(match[1])) found.push(match[1]);
  }
  return dedupe(found);
}

/**
 * The names bound to an `os.Logger` in this file.
 *
 * The Kotlin twin of this rule can key off the receiver's NAME, because
 * `android.util.Log` is a global object and this app's own logger is called
 * `CallFlowLog`. Swift has no such convention: the two loggers in this app are
 * `pushLog` and `coordinatorLog`, and nothing about either name says "log"
 * to a regex that has to be safe for the next one somebody adds.
 *
 * So the file is asked instead of guessed at. A name counts only if it is
 * declared here as a `Logger`, which means a new logger is covered the day it
 * is written and a property that merely happens to answer to `.error` is not.
 */
function swiftLoggerNames(code) {
  const names = new Set();
  for (const match of code.matchAll(
    /\b(?:let|var)\s+(\w+)\s*(?::\s*Logger\s*)?=\s*Logger\s*\(/g,
  )) {
    names.add(match[1]);
  }
  return names;
}

/**
 * `pushLog.info("Device push token registered.")` — the Console is not a screen.
 *
 * Same finding as [isDiagnosticLog] and the same nine sentences, because the
 * two push registrars are hand-ports of each other: what reads as untranslated
 * copy on one phone reads as untranslated copy on the other.
 *
 * `.error` is in the method list here where the Kotlin rule refuses it, and
 * that is safe only because [swiftLoggerNames] has already established that the
 * receiver is a `Logger`. On a value that is not one, `.error(…)` stays
 * counted.
 */
function isSwiftDiagnosticLog(code, matchIndex, loggers) {
  if (loggers.size === 0) return false;
  const window = code.slice(Math.max(0, matchIndex - 200), matchIndex);
  const call =
    /\b(\w+)\.(?:debug|info|notice|warning|error|critical|fault|log|trace)\s*\([^)]*$/.exec(
      window,
    );
  return call !== null && loggers.has(call[1]);
}

/**
 * The literals themselves, per file — not merely how many there are.
 *
 * This used to return `{file: count}` and drop the strings on the floor, so a
 * failing run said "14 hardcoded string(s)" and left you to re-find all 14 by
 * hand. A gate that reports a COUNT rather than a FINDING makes you redo the
 * work it already did, and with #228's backlog in the hundreds that is the
 * difference between a tractable chore and one nobody starts.
 */
function scan(client) {
  const literalsByFile = {};
  const all = walk(client.root);
  for (const file of all) {
    if (!isScannable(file, client.exts)) continue;
    const source = readFileSync(file, "utf8");
    // Read once and handed to both: the copy-table test needs the source, and
    // re-reading the tree a second time to answer it would double the walk.
    if (!isScannable(file, client.exts, source)) continue;
    const literals = client.find(source, file);
    if (literals.length > 0) {
      literalsByFile[relative(client.root, file).replaceAll("\\", "/")] =
        literals;
    }
  }
  return literalsByFile;
}

/** The offending strings, quoted, so the fix is a copy-paste rather than a hunt. */
function nameThem(literals, limit = 12) {
  const shown = literals
    .slice(0, limit)
    .map((text) => `      · ${JSON.stringify(text)}`);
  if (literals.length > limit) {
    shown.push(`      · …and ${literals.length - limit} more`);
  }
  return `\n${shown.join("\n")}`;
}

function readLedger(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/*
 * Everything below runs only when this file is EXECUTED, not when it is
 * imported.
 *
 * The three `find*Literals` functions are exported so they can be tested, and
 * until this guard existed importing them also scanned the repository — from
 * whatever directory the importer happened to be in, which for a test in
 * `packages/shared` meant `ENOENT ... packages/shared/apps/web/src`. The
 * functions that decide the ledger were therefore the only part of it nothing
 * could test. Same shape as `check-do-not-build.mjs`.
 */
if (!(process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])) {
  // Imported for its exports; the scan below is not ours to run.
} else {
const baseline = process.argv.includes("--baseline");
/** `--only web` narrows a run while one client is being worked on. */
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex === -1 ? null : process.argv[onlyIndex + 1];
/**
 * `--show AuthScreens` lists what is still hardcoded in the matching files.
 *
 * Files inside their budget are silent by design — that is what a ratchet is —
 * so without this there is no way to ask "what is left in here?" short of
 * editing the ledger to zero and reading the failure. Picking up a file from
 * the backlog should not require breaking the gate first.
 */
const showIndex = process.argv.indexOf("--show");
const show = showIndex === -1 ? null : process.argv[showIndex + 1];

let failed = 0;
const summary = [];

for (const [name, client] of Object.entries(CLIENTS)) {
  if (only && only !== name) continue;
  const literalsByFile = scan(client);
  const counts = Object.fromEntries(
    Object.entries(literalsByFile).map(([file, list]) => [file, list.length]),
  );
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  if (show) {
    const matching = Object.entries(literalsByFile).filter(([file]) =>
      file.toLowerCase().includes(show.toLowerCase()),
    );
    if (matching.length === 0) {
      console.log(`${name}: nothing hardcoded matches ${JSON.stringify(show)}`);
    }
    for (const [file, list] of matching) {
      console.log(`\n${name} · ${file} — ${list.length} left${nameThem(list, list.length)}`);
    }
    continue;
  }

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
          `    → ${client.fix}.` +
          nameThem(literalsByFile[file]),
      );
      continue;
    }
    if (count > allowed) {
      problems.push(
        `  ${file}: ${count} hardcoded string(s), the ledger allows ${allowed}.
` +
          "    → a NEW literal joined a file that was already waiting to be " +
          "extracted. Translate it now rather than adding to the backlog." +
          nameThem(literalsByFile[file]),
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

// `--show` is a question, not a verdict: it prints the backlog and exits clean
// rather than falling through to a summary line with no clients in it.
if (baseline || show) process.exit(0);

if (failed > 0) {
  console.error(
    "\n#228: the ledger only shrinks, on every client. " +
      `${summary.join(" · ")}\n`,
  );
  process.exit(1);
}

console.log(`Hardcoded strings — ${summary.join(" · ")}. No file grew.`);
}
