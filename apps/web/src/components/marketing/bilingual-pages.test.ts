import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * D138 Rule 3 — a page that renders in two languages holds no words of its own.
 *
 * ## The near-miss this is built from
 *
 * Wiring `/canada` reported **73 of 73 strings replaced** and left five in
 * English. Two reasons, and neither is visible from the count:
 *
 * 1. **A short key ate a long one.** "Local numbers" is a heading AND the first
 *    two words of a paragraph. Replacing the heading first swallowed the
 *    paragraph and deleted a sentence from the page.
 * 2. **A sentence cut in half is two text nodes.** "The one-time
 *    `<RegistrationFee />` fee and the 3 to 7 business day approval…" reads as
 *    one sentence and scans as two fragments, so a fragment-shaped search
 *    reported success over the half it had not seen.
 *
 * `Day 0` and "The same flat plans as everyone:" would have shipped in English
 * on a French page that otherwise looked finished. That is precisely the
 * failure Rule 3 exists to prevent, and the replacement count is the thing that
 * said it had not happened.
 *
 * ## So the check is on the OUTPUT, not the process
 *
 * These files render for BOTH languages. Any prose literal in one of them
 * therefore appears in both, whatever the catalogue says — which makes "does
 * this file contain a sentence?" a complete test rather than a heuristic one.
 */

const BODIES = join(process.cwd(), "src", "components", "marketing");

/** Props whose value a reader (or a screen reader) sees. */
const COPY_PROPS =
  /\b(?:alt|aria-label|ariaLabel|title|label|caption|eyebrow|heading|description|placeholder|sub)="([^"]{4,})"/g;

/**
 * A JSX text node with words in it.
 *
 * `{copy.x}` and `{" "}` are expressions, not text, so they never match. What
 * matches is a bare sentence — including a short one: `Day 0` is five
 * characters and was one of the five that got through.
 */
const TEXT_NODE = />\s*([A-Za-z][A-Za-z0-9'’,.:!?()-]*(?:\s+[A-Za-z0-9'’,.:!?()-]+)+)\s*</g;

function bilingualBodies(): string[] {
  return readdirSync(BODIES)
    .filter((name) => name.endsWith("-page.tsx"))
    .map((name) => join(BODIES, name));
}

describe("#228/D138 the bilingual page bodies carry no words of their own", () => {
  const files = bilingualBodies();

  it("found the page bodies, so a passing run means something", () => {
    // A rename or a move would otherwise leave this file asserting over an
    // empty list — the failure mode that let the five through in the first
    // place, in a different costume.
    expect(files.length, "no *-page.tsx bodies were found").toBeGreaterThan(1);
  });

  for (const file of bilingualBodies()) {
    const name = file.split(/[\\/]/).pop() ?? file;
    const source = readFileSync(file, "utf8");

    it(`${name} has no prose in its markup`, () => {
      const found = [...source.matchAll(TEXT_NODE)].map((m) => m[1].trim());
      expect(
        found,
        `${name} renders in both languages, so a sentence written here shows ` +
          `to a French reader in English. Move it to the catalogue.`,
      ).toEqual([]);
    });

    it(`${name} has no prose in a prop a reader sees`, () => {
      // `alt` and `ariaLabel` are the ones that hide — invisible on screen
      // and read aloud, so an English one on a French page is caught by nobody
      // LOOKING at the page. `ariaLabel` was missing from the list until a
      // break-test planted one and this stayed green, which is the only reason
      // it is here: an assertion nobody has watched fail is a guess.
      const found = [...source.matchAll(COPY_PROPS)].map((m) => m[1]);
      expect(
        found,
        `${name} passes a literal to a prop a reader or a screen reader sees`,
      ).toEqual([]);
    });
  }
});
