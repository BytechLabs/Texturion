#!/usr/bin/env node
/**
 * [#228] A function that HAS the reader's language must not drop it.
 *
 *   node scripts/check-locale-forwarding.mjs
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT, which is invisible to every other check we have.
 *
 * `t()` is `@Composable`, so copy decided outside composition is translated by
 * threading a `locale` down to it. That parameter is declared
 * `locale: String? = null`, and the default means English — which is what the
 * cross-client parity guards read, deliberately.
 *
 * The cost of that default is that FORGETTING to pass it is silent. Nothing
 * fails to compile, no test goes red, and the string renders in English inside
 * an otherwise-French screen. `deliveryLabel` was exactly this: it took the
 * locale, translated "Sending", "Sent" and "Delivered" with it, and then called
 * `sendFailureMessage(message.error_code)` with no locale at all — so the one
 * line on a message bubble that says why a text did NOT go was the one line
 * still in English.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS CHECKED, AND WHY IT IS NARROW
 *
 * Only the case where the answer is unambiguous: a function that declares a
 * `locale` parameter calls another function that ACCEPTS one, and does not pass
 * it. The caller has the value in hand and dropped it. There is no judgement to
 * make and no context this guard could be missing.
 *
 * Deliberately NOT checked: a call from a function with no locale in scope.
 * That may be a composable that should read `LocalAppLocale.current`, or a
 * background job with no reader at all, or a parity guard asking for the
 * English on purpose — three different right answers, and a guard that cannot
 * tell them apart would be noise. Those are tracked on #228 as wiring.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * BOTH PHONES, because both have the defect available to them.
 *
 * The Android sweep landed first and this guard was written for Kotlin. The
 * iOS sweep then introduced 155 Swift functions with the identical
 * `locale: String? = nil` shape — so the same silent failure was one forgotten
 * argument away on a client this guard could not see. One checker over two
 * languages rather than a second copy: a rule written twice is the drift the
 * cross-client tests exist to catch, one level up.
 *
 * The two languages differ only in how a function is declared and how an
 * argument is passed, so that is all the dialect describes.
 */
const CLIENTS = [
  {
    name: "android",
    root: "apps/android/app/src/main/kotlin",
    ext: ".kt",
    keyword: "fun",
    // `fun name(… locale: String? …)`
    declares: /\bfun\s+([A-Za-z][A-Za-z0-9_]*)\s*\(([^)]*)\)/g,
  },
  {
    name: "ios",
    root: "apps/ios/Loonext",
    ext: ".swift",
    keyword: "func",
    // `func name(… locale: String? …)`, static or not.
    declares: /\bfunc\s+([A-Za-z][A-Za-z0-9_]*)\s*\(([^)]*)\)/g,
  },
];

function walk(dir, ext, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, ext, out);
    else if (entry.name.endsWith(ext)) out.push(path);
  }
  return out;
}

/** Kotlin writes `String?`; Swift writes `String?` too. Same test. */
function takesLocale(params) {
  return /\blocale\s*:\s*String\?/.test(params);
}

const findings = [];
let inspected = 0;
let acceptCount = 0;

for (const client of CLIENTS) {
  const files = walk(client.root, client.ext);
  const DECLARES_LOCALE = client.declares;

  // Every function on THIS client that accepts a locale. Per client, not
  // shared: a Kotlin name and a Swift name are different vocabularies, and
  // merging them would let one language's declaration answer for the other's
  // call.
  const accepts = new Set();
  /*
   * Which callees LABEL their locale parameter.
   *
   * Swift has both shapes and they take opposite call syntax:
   *   func f(_ x: T, locale: String?)    ->  f(x, locale: locale)
   *   func f(_ x: T, _ locale: String?)  ->  f(x, locale)
   *
   * The label check below fired on `table(locale)` and `say(key, locale)`,
   * which are both correct — they declare `_ locale:`. A guard that cannot
   * tell those two shapes apart reports the compiling call and the broken one
   * identically, which is worse than not checking at all.
   */
  const labelled = new Set();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    DECLARES_LOCALE.lastIndex = 0;
    for (const match of source.matchAll(DECLARES_LOCALE)) {
      if (!takesLocale(match[2])) continue;
      accepts.add(match[1]);
      // `_ locale:` is positional; a bare `locale:` carries the label.
      if (!/(?:^|,)\s*_\s+locale\s*:\s*String\?/.test(match[2])) {
        labelled.add(match[1]);
      }
    }
  }
  acceptCount += accepts.size;

  if (accepts.size < 20) {
    console.error(
      `Locale forwarding: only ${accepts.size} locale-taking function(s) found on ` +
        `${client.name} — the declaration pattern stopped matching, so this guard ` +
        "is reading nothing there.",
    );
    process.exit(1);
  }

/**
 * The body of each function that HAS a locale, so calls can be attributed to a
 * caller that actually holds one. Bounded by the next top-level declaration
 * rather than by a closing brace: most of these are expression functions whose
 * body closes at an indent.
 */
const DECL_START = {
  android: /^(\s*)(?:@|(?:private |internal |public |companion )*(?:fun|val|var|object|class|enum)\b)/,
  // Swift's own keywords, plus `extension`, which Kotlin has no equivalent of
  // and which ends a declaration just as firmly.
  ios: /^(\s*)(?:@|(?:private |fileprivate |internal |public |static |final )*(?:func|var|let|struct|class|enum|extension)\b)/,
};

/**
 * The body of the declaration starting at [from], bounded by INDENTATION.
 *
 * A first attempt bounded on the next line starting with `fun`/`val` at column
 * zero. Almost everything here lives inside an `object`, so those lines are
 * indented and the boundary never matched — the "body" of `presets` ran to the
 * end of the file and swallowed a dozen property getters, every one of which
 * was then reported as a call that dropped the locale. The guard's first run
 * was 27 findings and 26 of them were that.
 *
 * So a declaration ends where the next one at the SAME or shallower indentation
 * begins, which is the rule Kotlin's own layout follows.
 */
function bodyAfter(source, from, ownIndent, declStart) {
  const rest = source.slice(from);
  const lines = rest.split("\n");
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = i === 0 ? null : declStart.exec(lines[i]);
    if (match && match[1].length <= ownIndent) break;
    kept.push(lines[i]);
  }
  return stripComments(kept.join("\n"));
}

/**
 * Comment lines dropped, because a call QUOTED in a comment is not a call.
 *
 * Caught by this guard biting its own tail: a docblock explaining that the card
 * now passes `threadCatchUpOptOutNotice(state.visibleCarrier, locale:)` quoted
 * the OLD spelling to say what changed, and the scanner read the quotation as a
 * live call that had dropped the locale. Prose about the code is not the code —
 * the same rule the hardcoded-strings ledger learned.
 *
 * Whole comment LINES only. A trailing `//` after real code is left alone, since
 * cutting at the first `//` would truncate any line containing a URL.
 */
function stripComments(text) {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join("\n");
}

  for (const file of files) {
  const source = readFileSync(file, "utf8");
  /** What THIS file declares, and whether each one takes a locale. */
  const localDeclarations = new Map();
  for (const decl of source.matchAll(DECLARES_LOCALE)) {
    localDeclarations.set(decl[1], takesLocale(decl[2]));
  }
  for (const match of source.matchAll(DECLARES_LOCALE)) {
    if (!takesLocale(match[2])) continue;
    const start = match.index + match[0].length;
    const lineStart = source.lastIndexOf("\n", match.index) + 1;
    const ownIndent = /^[ \t]*/.exec(source.slice(lineStart, match.index))?.[0].length ?? 0;
    const body = bodyAfter(source, start, ownIndent, DECL_START[client.name]);
    inspected += 1;

    for (const call of body.matchAll(/(?<![A-Za-z0-9_.])([A-Za-z][A-Za-z0-9_]*)\(([^()]*)\)/g)) {
      const callee = call[1];
      if (callee === match[1]) continue; // recursion carries it or does not, separately
      if (!accepts.has(callee)) continue;
      if (/\blocale\b|LocalAppLocale/.test(call[2])) {
        /*
         * SWIFT WANTS THE LABEL, and forgetting it is a compile error a
         * Kotlin habit produces easily.
         *
         * Every locale-taking function here declares it as `locale:` — a
         * labelled trailing parameter — so `f(x, locale)` does not compile
         * while `f(x, locale: locale)` does. Kotlin takes it positionally, so
         * porting a fix between the two clients is exactly when this happens.
         * It did: the twin of an Android fix went in positionally and cost a
         * whole CI cycle to discover, because there is no Swift compiler on
         * the machine this runs on.
         *
         * Only checked when a locale is actually being passed, so this can
         * never fire on a call that simply has none.
         */
        if (
          client.name === "ios" &&
          labelled.has(callee) &&
          !/\blocale\s*:/.test(call[2])
        ) {
          const line = source.slice(0, start + call.index).split("\n").length;
          findings.push(
            `${file.replace(/\\/g, "/")}:${line}  ${callee}(${call[2].slice(0, 40)}) ` +
              "passes a locale POSITIONALLY — Swift needs the `locale:` label and " +
              "this will not compile",
          );
        }
        continue;
      }
      /*
       * A helper declared INSIDE this function already closes over the locale.
       *
       * The common shape by far: `fun say(key: String) = AppStrings.translate(
       * locale, key)`, nested in the function that received the locale and
       * called a dozen times. Those need no argument and flagging them is
       * noise — the first draft of this guard reported 27 findings of which 25
       * were exactly this, which is the crying-wolf version that gets a guard
       * deleted rather than obeyed.
       *
       * Name-based matching is what makes the check cheap, and it is also what
       * makes this necessary: a LOCAL `say` and some other file's `say(key,
       * locale)` are one name to a scanner and two different functions to
       * Kotlin.
       */
      if (new RegExp(`${client.keyword}\\s+${callee}\\s*\\(`).test(body)) continue;
      /*
       * SAME-FILE declarations win, exactly as Kotlin resolves them.
       *
       * `accepts` is a set of NAMES gathered across the whole app, so a callee
       * matches if any file anywhere declares that name with a locale. That
       * flagged `inheritLabel` for calling `label(companyLocale)` — and the
       * `label` it actually calls is four lines up in the same object, declared
       * `fun label(value: String)`, with no locale to pass. A different `label`
       * elsewhere in the app was answering for it.
       */
      if (localDeclarations.has(callee) && !localDeclarations.get(callee)) continue;
      const line = source.slice(0, start + call.index).split("\n").length;
      findings.push(
        `${file.replace(/\\/g, "/")}:${line}  ${match[1]} has the locale and calls ` +
          `${callee}(${call[2].slice(0, 40)}) without it`,
      );
    }
  }
}

}

if (inspected < 20) {
  console.error(
    `Locale forwarding: only ${inspected} function bodies inspected — the ` +
      "boundary pattern is wrong and this guard is checking almost nothing.",
  );
  process.exit(1);
}

if (findings.length > 0) {
  console.error("\nA function holding the reader's language dropped it:\n");
  for (const finding of findings) console.error(`  ${finding}`);
  console.error(
    `\n${findings.length} call(s). Each one renders English inside a screen that ` +
      "is otherwise translated, and nothing else in the build will tell you.\n",
  );
  process.exit(1);
}

console.log(
  `Locale forwarding: ${inspected} function(s) across ${CLIENTS.length} client(s) ` +
    `hold a locale and pass it to every one of the ${acceptCount} locale-taking ` +
    "functions they call.",
);
