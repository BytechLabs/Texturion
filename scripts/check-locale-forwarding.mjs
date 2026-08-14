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

const ROOT = "apps/android/app/src/main/kotlin";

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith(".kt")) out.push(path);
  }
  return out;
}

/** `fun name(… locale: String? …)` — a declaration that accepts the language. */
const DECLARES_LOCALE = /\bfun\s+([A-Za-z][A-Za-z0-9_]*)\s*\(([^)]*)\)/g;

function takesLocale(params) {
  return /\blocale\s*:\s*String\?/.test(params);
}

const files = walk(ROOT);

// Every function in the app that accepts a locale.
const accepts = new Set();
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(DECLARES_LOCALE)) {
    if (takesLocale(match[2])) accepts.add(match[1]);
  }
}

if (accepts.size < 20) {
  console.error(
    `Locale forwarding: only ${accepts.size} locale-taking function(s) found — ` +
      "the declaration pattern stopped matching, so this guard is reading nothing.",
  );
  process.exit(1);
}

/**
 * The body of each function that HAS a locale, so calls can be attributed to a
 * caller that actually holds one. Bounded by the next top-level declaration
 * rather than by a closing brace: most of these are expression functions whose
 * body closes at an indent.
 */
const DECL_START = /^(\s*)(?:@|(?:private |internal |public |companion )*(?:fun|val|var|object|class|enum)\b)/;

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
function bodyAfter(source, from, ownIndent) {
  const rest = source.slice(from);
  const lines = rest.split("\n");
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = i === 0 ? null : DECL_START.exec(lines[i]);
    if (match && match[1].length <= ownIndent) break;
    kept.push(lines[i]);
  }
  return kept.join("\n");
}

const findings = [];
let inspected = 0;

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
    const body = bodyAfter(source, start, ownIndent);
    inspected += 1;

    for (const call of body.matchAll(/(?<![A-Za-z0-9_.])([A-Za-z][A-Za-z0-9_]*)\(([^()]*)\)/g)) {
      const callee = call[1];
      if (callee === match[1]) continue; // recursion carries it or does not, separately
      if (!accepts.has(callee)) continue;
      if (/\blocale\b|LocalAppLocale/.test(call[2])) continue;
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
      if (new RegExp(`fun\\s+${callee}\\s*\\(`).test(body)) continue;
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
  `Locale forwarding: ${inspected} function(s) holding a locale pass it to every ` +
    `one of the ${accepts.size} locale-taking functions they call.`,
);
