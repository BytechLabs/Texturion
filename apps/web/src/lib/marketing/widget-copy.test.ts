import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * #228 — the embed widget's two languages say the same things.
 *
 * ## Why this cannot be a normal parity test
 *
 * `public/widget.js` is served RAW to third-party websites as one plain script
 * — no bundler, no imports, no module system — so it cannot reach
 * `packages/shared` and its copy lives in a table inside the file. That is a
 * real cost and this is what pays it: the one thing that can go wrong silently
 * is the two languages drifting apart, and nothing else in the repo looks at
 * this file.
 *
 * ## What it checks
 *
 * The KEY SETS, both directions, and that no entry is empty. Not the wording —
 * that is a translation decision, and a test that pinned it would be a third
 * copy to keep in step.
 *
 * It also checks the file no longer carries the English it used to hardcode.
 * The widget sits on the BUSINESS's own website in front of THEIR customers, so
 * an English string surviving here is not a missing translation on one of our
 * screens — it is our English on somebody else's French page.
 */

const WIDGET = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "public",
  "widget.js",
);

/** The `COPY = { … }` literal, parsed as the object it is. */
function copyTable(): Record<string, Record<string, string>> {
  const source = readFileSync(WIDGET, "utf8");
  const open = source.indexOf("var COPY = {");
  expect(open, "widget.js no longer declares a COPY table").toBeGreaterThan(-1);

  // Brace-match from the opening brace: the table holds nested objects, so a
  // lazy match to the first closing brace would take only the first language.
  const start = source.indexOf("{", open);
  let depth = 0;
  let end = start;
  for (; end < source.length; end += 1) {
    if (source[end] === "{") depth += 1;
    else if (source[end] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  return new Function(`return ${source.slice(start, end + 1)}`)() as Record<
    string,
    Record<string, string>
  >;
}

describe("#228 the embed widget speaks both languages", () => {
  const copy = copyTable();

  it("parsed a table with both locales in it", () => {
    // A parse that quietly produced `{}` would make every assertion below
    // vacuously true, which is the failure mode of every source-derived check.
    expect(Object.keys(copy).sort()).toEqual(["en", "fr-CA"]);
    expect(Object.keys(copy.en).length).toBeGreaterThan(10);
  });

  it("says the same things in both, with nothing missing either way", () => {
    const en = Object.keys(copy.en).sort();
    const fr = Object.keys(copy["fr-CA"]).sort();
    expect(
      fr,
      "the two languages have drifted. A key present in one and not the other " +
        "renders as `undefined` on a stranger's website — worse than English, " +
        "because at least English is a sentence.",
    ).toEqual(en);
  });

  it("leaves nothing blank", () => {
    for (const [locale, words] of Object.entries(copy)) {
      for (const [key, value] of Object.entries(words)) {
        expect(value.trim(), `${locale}.${key} is empty`).not.toBe("");
      }
    }
  });

  it("no longer hardcodes the English it used to render", () => {
    const source = readFileSync(WIDGET, "utf8");
    // Everything after the table: the table itself legitimately holds these.
    const body = source.slice(source.indexOf("var t = COPY"));
    const stragglers = [
      "Your name",
      "Mobile number",
      "How can we help?",
      "Check your phone",
      "Text me a code",
      "Send my message",
      "We texted you a code.",
      "Powered by Loonext",
    ].filter((phrase) => body.includes(`"${phrase}"`));

    expect(
      stragglers,
      "These are still written into the widget's body rather than read from " +
        "the table, so they stay English on a French business's own website:\n" +
        `  ${stragglers.join("\n  ")}`,
    ).toEqual([]);
  });
});
