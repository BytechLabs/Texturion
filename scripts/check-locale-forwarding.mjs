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

/**
 * Callees whose `locale` parameter is DATA, not the reader's language.
 *
 * The `accepts` set is built from "declares a `locale: String?` parameter",
 * which is the right rule for a translation helper and the wrong one for a
 * setter that happens to persist a field called locale. `saveLocale(nil)` on
 * the contact screen writes `field: "locale"` on the CONTACT — clearing which
 * language that customer is texted in. Passing the reader's UI language there
 * would be a bug, not a fix.
 *
 * Named rather than inferred, because every structural signal for "this is a
 * setter" is a guess, and a guard that guesses about a security-shaped rule
 * gets its roster widened until it guards nothing. Kept honest by the assertion
 * below: an entry that no longer names a real locale-taking function fails,
 * so this cannot quietly become an excuse list.
 */
const DATA_LOCALE_CALLEES = new Set(["saveLocale"]);

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

/**
 * The OTHER way a function comes to hold a locale, and the commonest one.
 *
 * A composable does not take the locale as a parameter — it reads it out of the
 * environment: `val locale = LocalAppLocale.current` on Android,
 * `@Environment(\.appLocale) private var appLocale` on iOS. That is the ENTRY
 * POINT, where the reader's language actually arrives, and every threaded chain
 * below it starts at one of these.
 *
 * The guard did not know that shape, so it watched the chain and missed the
 * door: a composable holding `locale` could call a locale-taking function
 * without it, and nothing said so. Found by breaking it — dropping the argument
 * from a real call site and watching the guard still report success.
 *
 * Shape-based, like the rest of this file: it keys on how the value is
 * obtained, not on a list of composable names that would go stale.
 */
function readsLocaleFromEnvironment(body) {
  return /\bval\s+locale\s*=\s*LocalAppLocale\.current/.test(body)
    || /@Environment\(\\\.appLocale\)\s+(?:private\s+)?var\s+(\w+)/.test(body);
}

/**
 * THE iOS HALF OF THE ABOVE MATCHED NOTHING, AND HAD MATCHED NOTHING ALWAYS.
 *
 * `readsLocaleFromEnvironment` is handed a FUNCTION BODY. On Android that is
 * right — `val locale = LocalAppLocale.current` is a statement inside a
 * composable. On iOS it cannot be: `@Environment(\.appLocale) private var
 * appLocale` is a stored property on the View struct, never a statement inside
 * a `func`. All 284 declarations in the tree sit at struct-member indentation,
 * and the body scanner stops at that indent rather than reaching them.
 *
 * So the iOS arm contributed zero entry points. Only functions that literally
 * declared `locale: String?` were ever inspected, while every SwiftUI view that
 * holds the reader's language in the environment — the commonest shape, and the
 * one this file's own docblock calls "the ENTRY POINT" — was invisible. The
 * guard reported two clients covered and covered one.
 *
 * The scope is the TYPE, so that is what this finds: the brace-matched range of
 * every `struct`/`class`/`extension` that declares the property. A `func`
 * starting inside one of those ranges has the locale in hand.
 *
 * `static func` is excluded deliberately — it cannot reach an instance
 * property, so flagging it would be the over-eager direction this file warns
 * about elsewhere.
 */
function swiftLocaleScopes(source) {
  const scopes = [];
  const TYPE = /\b(?:struct|class|extension|enum)\s+[A-Za-z_][A-Za-z0-9_]*/g;
  for (const match of source.matchAll(TYPE)) {
    const open = source.indexOf("{", match.index);
    if (open === -1) continue;
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      const ch = source[end];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const block = source.slice(open, end);
    // Only the type's OWN members, not a nested type's — a nested declaration
    // would be found by its own iteration of this loop anyway.
    const held = /@Environment\(\\\.appLocale\)\s+(?:private\s+)?var\s+(\w+)/.exec(
      block,
    );
    // The NAME matters as much as the range. SwiftUI views call it `appLocale`,
    // and the forwarding check below looks for the token `locale` — which
    // `appLocale` does not contain under a word boundary. Without carrying the
    // name through, every correctly-forwarded call in a View reads as a drop:
    // the first run of this widened guard reported seventeen, and fifteen of
    // them were passing `appLocale` in plain sight.
    if (held) scopes.push([open, end, held[1]]);
  }
  return scopes;
}

const findings = [];
let inspected = 0;
let acceptCount = 0;
/** Per client, so one client's coverage cannot stand in for another's. */
const inspectedPerClient = {};
/**
 * Per client, the functions that qualified BY HOLDING THE ENVIRONMENT — not by
 * declaring a `locale` parameter.
 *
 * This is the number that was zero on iOS, and a total could never have shown
 * it: 171 Swift functions declare the parameter outright, so every plausible
 * floor on the total was comfortably met while the entry point this file calls
 * "the commonest one" matched nothing at all. A guard needs a floor on the arm
 * that can fail independently, not on the sum.
 */
const envEntryPerClient = {};
/** Every locale-taking callee on any client, for the exemption staleness check. */
const everyAccepts = new Set();

for (const client of CLIENTS) {
  const files = walk(client.root, client.ext);
  inspectedPerClient[client.name] = 0;
  envEntryPerClient[client.name] = 0;
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
  for (const name of accepts) everyAccepts.add(name);

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
  /**
   * #228: the types in this file that hold the reader's language in the
   * environment. Empty on Android, where the value is read inside the function
   * and the body scan already sees it.
   */
  const localeScopes = client.name === "ios" ? swiftLocaleScopes(source) : [];
  /** What THIS file declares, and whether each one takes a locale. */
  const localDeclarations = new Map();
  for (const decl of source.matchAll(DECLARES_LOCALE)) {
    localDeclarations.set(decl[1], takesLocale(decl[2]));
  }
  for (const match of source.matchAll(DECLARES_LOCALE)) {
    const start = match.index + match[0].length;
    const lineStart = source.lastIndexOf("\n", match.index) + 1;
    const ownIndent = /^[ \t]*/.exec(source.slice(lineStart, match.index))?.[0].length ?? 0;
    const body = bodyAfter(source, start, ownIndent, DECL_START[client.name]);
    // A locale in hand, however it got there: declared as a parameter, read
    // out of the environment by a composable, or — on iOS — held by the
    // enclosing View as an @Environment property. A `static func` is excluded
    // from that last one: it cannot reach an instance property.
    const isStatic = /\b(?:static|class)\s+func\s*$/.test(
      source.slice(Math.max(0, match.index - 24), match.index + 5),
    );
    const enclosing = isStatic
      ? undefined
      : localeScopes.find(
          ([from, to]) => match.index > from && match.index < to,
        );
    const inLocaleScope = enclosing !== undefined;
    /** What the value is CALLED here — `locale`, or a View's `appLocale`. */
    const heldName = enclosing?.[2];
    if (
      !takesLocale(match[2]) &&
      !readsLocaleFromEnvironment(body) &&
      !inLocaleScope
    ) {
      continue;
    }
    inspected += 1;
    inspectedPerClient[client.name] += 1;
    // Qualified WITHOUT declaring the parameter: the environment arm.
    if (!takesLocale(match[2])) envEntryPerClient[client.name] += 1;

    for (const call of body.matchAll(/(?<![A-Za-z0-9_.])([A-Za-z][A-Za-z0-9_]*)\(([^()]*)\)/g)) {
      const callee = call[1];
      if (callee === match[1]) continue; // recursion carries it or does not, separately
      if (!accepts.has(callee)) continue;
      if (DATA_LOCALE_CALLEES.has(callee)) continue; // its locale is the row's, not the reader's
      // The value under whichever name it has here. A View holds it as
      // `appLocale`, which the `locale` token below cannot see.
      const passed =
        /\blocale\b|LocalAppLocale/.test(call[2]) ||
        (heldName !== undefined &&
          new RegExp("\\b" + heldName + "\\b").test(call[2]));
      if (passed) {
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

/*
 * PER-CLIENT FLOOR, because a single total hid the whole problem.
 *
 * The count above was comfortably over its floor while the iOS arm was
 * contributing zero entry points from the environment — Android's 138 carried
 * it. A guard that reports two clients covered has to be able to notice when
 * one of them stops being.
 */
for (const [name, count] of Object.entries(envEntryPerClient)) {
  if (count >= 25) continue;
  console.error(
    `Locale forwarding: only ${count} function(s) on ${name} hold the ` +
      "reader's language from the ENVIRONMENT rather than from a parameter. " +
      "That is the entry point this guard calls the commonest one, and its " +
      "pattern has stopped matching — the total above is carried by the " +
      "functions that declare the parameter outright.",
  );
  process.exit(1);
}

const staleExemptions = [...DATA_LOCALE_CALLEES].filter(
  (name) => !everyAccepts.has(name),
);
if (staleExemptions.length > 0) {
  console.error(
    `Locale forwarding: ${staleExemptions.join(", ")} is exempted as a ` +
      "data-locale setter and no longer declares a locale parameter anywhere. " +
      "Either it moved, or the exemption is dead weight that reads as a " +
      "decision somebody made.",
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
