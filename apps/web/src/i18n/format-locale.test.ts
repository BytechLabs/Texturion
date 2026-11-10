/**
 * #228: dates, numbers and relative times follow the READER'S language.
 *
 * ── THE DEFECT THIS PINS ──────────────────────────────────────────────────
 *
 * `date.toLocaleDateString(undefined, …)`, `count.toLocaleString()` and
 * `new Intl.DateTimeFormat(undefined, …)` all mean "whatever language the
 * BROWSER is set to". The app's own language is a different setting: a member
 * can choose Français (Canada) on a laptop whose browser says English, and a
 * workspace can work in French on a phone that reads English. Every such
 * reader saw a French sentence with an English month in the middle of it
 * ("Facturé le Mar 5"), a thousands separator from the wrong convention, and a
 * French inbox whose rows said `Now` and `Tue`.
 *
 * The same happened for the old `formatRelativeTime(iso)`: its translator defaulted to
 * English, and thirty callers never passed one, so the inbox list, the screen
 * a crew looks at most, was the least translated surface in the product.
 *
 * ── WHAT IS CHECKED ───────────────────────────────────────────────────────
 *
 * F-1  no formatter is given the browser's locale by omission or by
 *      `undefined`. The one legitimate zero-argument use is asking the runtime
 *      for its TIME ZONE (`Intl.DateTimeFormat().resolvedOptions()`), which is
 *      not a language at all.
 * F-2  every `formatTimestamp(` and `formatAbsoluteDateTime(` caller hands
 *      over the reader's translator or locale.
 * F-3  a fixed locale string is allowed only where the roster below says why.
 *
 * The roster is closed: an entry whose file no longer contains the call
 * FAILS, so it cannot outlive the code it excuses.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles, sourceText, stripComments } from "@/test/source-tree";

const SRC = join(process.cwd(), "src");

const relative = (path: string): string =>
  path.slice(SRC.length + 1).replace(/\\/g, "/");

const files = sourceFiles(SRC, [".ts", ".tsx"])
  .filter((file) => !/\.test\.tsx?$/.test(file))
  .map((file) => ({ rel: relative(file), text: stripComments(sourceText(file)) }));

/** The text of the argument list that opens at `open` (just after the `(`). */
function argumentList(text: string, open: number): string {
  let depth = 1;
  let end = open;
  for (; end < text.length && depth > 0; end += 1) {
    const char = text[end];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
  }
  return text.slice(open, end - 1);
}

const firstArgument = (list: string): string => {
  let depth = 0;
  for (let i = 0; i < list.length; i += 1) {
    const char = list[i];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) return list.slice(0, i).trim();
  }
  return list.trim();
};

interface Call {
  rel: string;
  line: number;
  call: string;
  list: string;
}

function calls(pattern: RegExp): Call[] {
  const found: Call[] = [];
  for (const { rel, text } of files) {
    for (const match of text.matchAll(pattern)) {
      const open = (match.index ?? 0) + match[0].length;
      found.push({
        rel,
        line: text.slice(0, match.index).split("\n").length,
        call: match[0],
        list: argumentList(text, open),
      });
    }
  }
  return found;
}

const FORMATTERS = calls(
  /\.toLocale(?:Date|Time)?String\(|new Intl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat|ListFormat)\(|Intl\.(?:DateTimeFormat|NumberFormat)\(/g,
);

const where = (call: Call): string =>
  `${call.rel}:${call.line}  ${call.call}${call.list.replace(/\s+/g, " ").slice(0, 60)}`;

/**
 * Fixed locales that are right, and why. `file` must still contain the call.
 */
const FIXED_LOCALE: readonly { file: string; why: string }[] = [
  {
    file: "components/inbox/e164.ts",
    why: "The hour is PARSED back with Number(), so its formatter must be one whose digits are Latin; the label's locale is a parameter.",
  },
  {
    file: "components/thread/send-later-menu.tsx",
    why: "Same: an hour difference computed from a parsed number, never shown as formatted.",
  },
  {
    file: "lib/format/time.ts",
    why: "en-CA is how the wall-clock parts are read as YYYY-MM-DD, a machine format.",
  },
  {
    file: "components/ui/timestamp.tsx",
    why: "Two wall clocks are compared for equality, never shown, so the locale cannot matter.",
  },
  {
    file: "components/public/quote-page.tsx",
    why: "The customer-facing quote page: a stranger's language is unknown, and a quote is stated in Canadian dollars and dates.",
  },
  {
    file: "components/settings/pause-plan.tsx",
    why: "A USD price quoted with a hard-coded $ prefix, deliberately: the offer says what it is and does not guess a currency symbol.",
  },
  {
    file: "app/(marketing)/compare/verification.ts",
    why: "Marketing pages carry their own locale in the route (D138), not the app's setting.",
  },
  {
    file: "components/marketing/interactive/missed-text-calculator.tsx",
    why: "Marketing calculator, USD.",
  },
  {
    file: "components/marketing/interactive/missed-text-calculator-static.tsx",
    why: "Marketing calculator, USD.",
  },
];

const isFixedLocale = (list: string): boolean =>
  /^["'`][a-z]{2}(-[A-Z]{2})?["'`]$/.test(firstArgument(list));

describe("#228 formatting follows the app's language, not the browser's", () => {
  it("F-0: the scan found the formatters it is about", () => {
    // A check whose healthy state is "found nothing" may have read the wrong
    // directory. Today's count is above 120.
    expect(FORMATTERS.length).toBeGreaterThanOrEqual(100);
  });

  it("F-1: no formatter is handed the browser's locale by omission or by undefined", () => {
    // `Intl.DateTimeFormat().resolvedOptions().timeZone` asks the runtime for
    // a ZONE, not a language, and is the only zero-argument use left.
    const real = FORMATTERS.filter((call) => {
      const first = firstArgument(call.list);
      if (first !== "" && first !== "undefined") return false;
      const text = files.find((f) => f.rel === call.rel)!.text;
      const lineText = text.split("\n")[call.line - 1] ?? "";
      return !/\.resolvedOptions\(\)/.test(lineText);
    });
    expect(
      real.map(where),
      "These pass the BROWSER's language to a formatter. Pass the reader's: " +
        "`t.locale` from useT(), or a `locale` parameter handed down:\n  " +
        real.map(where).join("\n  "),
    ).toEqual([]);
  });

  it("F-2: every timestamp and absolute time caller passes the reader's language", () => {
    const relativeCalls = calls(/\bformat(?:Timestamp|AbsoluteDateTime)\(/g).filter(
      (call) => call.rel !== "lib/format/time.ts",
    );
    expect(relativeCalls.length, "the callers were not found").toBeGreaterThanOrEqual(40);
    const bare = relativeCalls.filter((call) => {
      // `formatTimestamp(iso, { style, t })` carries the translator as `t`.
      if (call.call.startsWith("formatTimestamp")) return !/\bt\b/.test(call.list);
      let depth = 0;
      let commas = 0;
      for (const char of call.list) {
        if (char === "(" || char === "[" || char === "{") depth += 1;
        else if (char === ")" || char === "]" || char === "}") depth -= 1;
        else if (char === "," && depth === 0) commas += 1;
      }
      return commas < 2;
    });
    expect(
      bare.map(where),
      "These format a time in English whatever the reader's language is. " +
        "Call `formatTimestamp(iso, { style, t })` or `formatAbsoluteDateTime(iso, undefined, t.locale)`:\n  " +
        bare.map(where).join("\n  "),
    ).toEqual([]);
  });

  it("F-3: a fixed locale lives only where the roster says why", () => {
    const fixed = FORMATTERS.filter((call) => isFixedLocale(call.list));
    const unlisted = fixed.filter(
      (call) => !FIXED_LOCALE.some((entry) => entry.file === call.rel),
    );
    expect(
      unlisted.map(where),
      "A formatter pinned to one language ignores the reader's. Use t.locale, " +
        "or add the file to FIXED_LOCALE with the reason:\n  " +
        unlisted.map(where).join("\n  "),
    ).toEqual([]);
  });

  it("F-4: the roster excuses code that still exists", () => {
    const stale = FIXED_LOCALE.filter(
      (entry) =>
        !FORMATTERS.some((call) => call.rel === entry.file && isFixedLocale(call.list)),
    );
    expect(stale.map((entry) => entry.file)).toEqual([]);
  });
});
