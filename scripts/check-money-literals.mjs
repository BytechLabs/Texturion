#!/usr/bin/env node
/**
 * [#522] A price typed into a phone app is a price in a currency nobody chose.
 *
 * WHY THIS EXISTS, and why it is the third attempt at the same class.
 *
 * #328 found plan prices typed as "$29/mo" on both phones. #522 found the
 * registration fee typed as "$29" while Stripe invoices a Canadian workspace
 * CA$39, and the extra-number line typed as "$5/mo" for a line the card takes
 * US$5 for. Each was fixed by hand, each time the fix was correct, and each time
 * the NEXT one arrived because nothing was watching. The adversarial pass on #522
 * proved it outright: it inserted `$444/mo` into a phone settings screen and
 * every suite on both platforms stayed green.
 *
 * The web app has no equivalent hole — `formatMoney` lives in @loonext/shared and
 * the surfaces import it — but the phones hand-port that formatter, and a
 * hand-port is exactly where a literal survives review: the copy reads fine, the
 * figure is even correct in USD, and the reader who is charged in CAD is nowhere
 * in the diff.
 *
 * WHAT IT REFUSES: a currency-signed amount inside a STRING LITERAL in a phone
 * source file. Not in comments — this file's own neighbours are full of "$5" as
 * prose, and so they should be. Not `$0` — zero is the one amount that means the
 * same in every currency.
 *
 * WHAT TO DO INSTEAD is always the same, and it is why there is no opt-out
 * comment: resolve the amount through the client's money formatter, which states
 * the currency when it differs from the reader's. If a price genuinely has no
 * formatter yet, the answer is a formatter, not an exception — an escape hatch
 * here would be spent on the first inconvenient case and this would be back to
 * watching nothing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Only the apps that hand-port their formatters. `apps/web` imports
 * `formatMoney` from @loonext/shared, so its figures cannot drift from the price
 * book by typing — and its test files legitimately assert "$5/mo" as expected
 * output.
 */
const ROOTS = [
  { dir: "apps/android/app/src/main/kotlin", ext: ".kt" },
  { dir: "apps/ios/Loonext", ext: ".swift" },
];

/** Test sources may assert a rendered price; that is what they are for. */
const SKIP_SEGMENTS = ["/test/", "/Tests/", "Test.kt", "Tests.swift"];

/**
 * The signed amounts that exist today and are NOT prices this product charges,
 * each with the reason it is not.
 *
 * AN EXACT-MATCH LIST, DELIBERATELY, and not a smarter pattern. The obvious
 * alternative is to narrow the regex — only flag `$N/mo`, only flag amounts near
 * words like "plan" or "fee" — and this repository has already learned where that
 * goes: a rule that decides from the CONTENT of a string is a vocabulary, it is
 * never complete, and the last one written here was deleted after three rounds of
 * being wrong in a new way each time.
 *
 * So this makes no judgement at all. Every signed amount is refused, and the ones
 * that are legitimately not prices are enumerated. That means a NEW money literal
 * fails until somebody writes down which kind it is — which is the whole point,
 * because the failure mode being prevented is a price nobody looked twice at.
 * Same shape as `check-client-parity`, which refuses a new client surface until it
 * is registered.
 *
 * Keyed by file + the exact literal, so moving the line is free and changing the
 * string is not.
 */
const NOT_A_PRICE = [
  {
    // `$1` is a regex replacement backreference — the first capture group, in
    // the merge-field tidier that closes up space before punctuation when a
    // token resolves to nothing. Not money in any currency.
    literal: '"$1"',
    reason: "regex backreference, not an amount",
    files: [
      "apps/android/app/src/main/kotlin/com/loonext/android/features/compose/MergeFields.kt",
      "apps/android/app/src/main/kotlin/com/loonext/android/features/settings/SettingsLogic.kt",
      "apps/ios/Loonext/Features/Compose/MergeFields.swift",
      "apps/ios/Loonext/Features/Settings/SettingsLogic.swift",
    ],
  },
  {
    // A tradesperson's own quote to their own customer, inside sample copy that
    // shows what an AI thread summary looks like. It is the reader's number, in
    // the reader's money, and we neither charge it nor convert it.
    literal: "$2,400",
    reason: "sample copy: the customer's own quote, not a charge of ours",
    files: [
      "apps/ios/Loonext/Features/Settings/AiSection.swift",
      "apps/ios/Loonext/Features/Thread/ThreadSummaryCard.swift",
    ],
  },
];

/** Is this finding one of the enumerated non-prices? */
function allowed(file, literal, amount) {
  return NOT_A_PRICE.some(
    (entry) =>
      entry.files.includes(file) &&
      (literal === entry.literal || amount === entry.literal),
  );
}

function sources() {
  const out = [];
  for (const { dir, ext } of ROOTS) {
    const walk = (path) => {
      for (const entry of readdirSync(path)) {
        const full = join(path, entry).replaceAll("\\", "/");
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (full.endsWith(ext)) {
          if (SKIP_SEGMENTS.some((skip) => full.includes(skip))) continue;
          out.push(full);
        }
      }
    };
    walk(dir);
  }
  return out;
}

/**
 * Blank out comments and keep every other byte, so a match's index still points
 * at its real line.
 *
 * Replaced with spaces rather than removed for that reason: an offset that has
 * drifted turns a precise finding into "somewhere in this file", and a guard
 * nobody can locate the cause of is a guard people switch off. Newlines survive
 * so the line count is exact.
 */
function stripComments(source) {
  let out = "";
  let i = 0;
  let inString = false;
  let inChar = false;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (!inString && !inChar && two === "//") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (!inString && !inChar && two === "/*") {
      // Kotlin and Swift both nest block comments; a depth counter is the only
      // correct reading, and getting it wrong would blank out live code.
      let depth = 0;
      while (i < source.length) {
        if (source.slice(i, i + 2) === "/*") {
          depth += 1;
          out += "  ";
          i += 2;
          continue;
        }
        if (source.slice(i, i + 2) === "*/") {
          depth -= 1;
          out += "  ";
          i += 2;
          if (depth === 0) break;
          continue;
        }
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }
    if (!inChar && source[i] === '"' && source[i - 1] !== "\\") {
      inString = !inString;
    } else if (!inString && source[i] === "'" && source[i - 1] !== "\\") {
      inChar = !inChar;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

/**
 * A currency-signed amount: a `$` immediately followed by digits.
 *
 * `$0` and `$0.00` are allowed — zero is the same in every currency, and both
 * phones print "No overage this period. $0.00 extra so far." which is true for
 * everybody. Anything else is a claim about which money the reader is holding.
 *
 * Swift's `$0` closure shorthand is not a false positive here for two reasons:
 * it is never inside a string literal, and it would be allowed anyway.
 */
const MONEY = /\$(\d[\d,]*)(\.\d+)?/g;

/** Every double-quoted string literal, with its offset. Swift `"""` included. */
function stringLiterals(source) {
  const found = [];
  const multiline = /"""[\s\S]*?"""/g;
  for (const match of source.matchAll(multiline)) {
    found.push({ text: match[0], index: match.index });
  }
  // Single-line literals, skipping any span already taken by a multi-line one.
  const taken = (index) =>
    found.some((f) => index >= f.index && index < f.index + f.text.length);
  const single = /"(?:[^"\\\n]|\\.)*"/g;
  for (const match of source.matchAll(single)) {
    if (!taken(match.index)) found.push({ text: match[0], index: match.index });
  }
  return found;
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

const findings = [];
for (const file of sources()) {
  const raw = readFileSync(file, "utf8");
  const code = stripComments(raw);
  for (const literal of stringLiterals(code)) {
    for (const money of literal.text.matchAll(MONEY)) {
      const amount = Number(`${money[1].replaceAll(",", "")}${money[2] ?? ""}`);
      if (amount === 0) continue;
      if (allowed(file, literal.text, money[0])) continue;
      findings.push({
        file,
        line: lineOf(code, literal.index + money.index),
        literal: literal.text.length > 80
          ? `${literal.text.slice(0, 77)}…`
          : literal.text,
        amount: money[0],
      });
    }
  }
}

if (findings.length === 0) {
  console.log(
    `check-money-literals: no typed prices in ${sources().length} phone sources.`,
  );
  process.exit(0);
}

console.error(
  `A price is typed into ${findings.length === 1 ? "a phone source" : "phone sources"} ` +
    `instead of being formatted (#522).\n`,
);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  ${f.amount}  in  ${f.literal}`);
}
console.error(
  "\nA typed price is a price in a currency nobody chose. A Canadian workspace\n" +
    'reads "$5" as CA$5 for a line its card is charged US$5 for, and the copy\n' +
    "looks correct in the diff because the reader who is charged differently is\n" +
    "not in it.\n\n" +
    "Resolve the amount through the client's money formatter instead — the one\n" +
    "that states the currency when it differs from the reader's:\n" +
    "  Kotlin  formatMoney(cents, currency, audience)   SettingsLogic.kt\n" +
    "  Swift   formatMoneyIn(cents, currency, audience:) SettingsLogic.swift\n\n" +
    "If the figure has no price book yet, add one. There is deliberately no\n" +
    "opt-out comment: this is the third pass over the same class of defect, and\n" +
    "an exception would be spent on the first inconvenient case.",
);
process.exit(1);
