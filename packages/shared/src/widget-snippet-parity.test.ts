import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * #228/#232 — the three snippet builders emit the same markup.
 *
 * ## The drift this exists for already happened
 *
 * Three clients each hand-build the one line an owner pastes into their own
 * website, because the string is trivial and the Kotlin file says so in its own
 * words: "the two builders have to produce byte-identical markup, and the
 * cheapest way to keep them identical is to keep them the same shape. **A
 * future edit lands on both or neither.**"
 *
 * It landed on one. Web learned to emit `data-lang` so a French workspace's
 * visitors read French, and both phones kept emitting the English-only line —
 * so an owner copying the snippet from their phone handed their own customers
 * our English, which is the exact bug the web change fixed.
 *
 * A prediction in a comment is not a check. This is the check.
 *
 * ## What it asserts
 *
 * That every builder contains the same set of ATTRIBUTES. Not the whole string:
 * the three languages interpolate differently (`${}` / `$` / `\()`), and a test
 * comparing source text would fail on syntax rather than on behaviour.
 */

const REPO = join(import.meta.dirname, "..", "..", "..");

const BUILDERS = {
  web: "apps/web/src/lib/marketing/widget-snippet.ts",
  android:
    "apps/android/app/src/main/kotlin/com/loonext/android/features/settings/WebsiteWidgetCard.kt",
  ios: "apps/ios/Loonext/Features/Settings/WebsiteWidgetCard.swift",
};

/** The `widgetSnippet` body on one client, however that client spells it. */
function builderBody(source: string): string {
  const at = source.search(/(?:fun|func|function)\s+widgetSnippet/);
  if (at === -1) return "";
  // To the end of the enclosing function: the builders are short, and the next
  // blank-line-then-close is where each one ends.
  const rest = source.slice(at);
  const end = rest.indexOf("\n}");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("#232 the snippet is the same line on every client", () => {
  const bodies = Object.fromEntries(
    Object.entries(BUILDERS).map(([client, path]) => [
      client,
      builderBody(readFileSync(join(REPO, path), "utf8")),
    ]),
  );

  it("found all three builders, so a passing run means something", () => {
    for (const [client, body] of Object.entries(bodies)) {
      expect(body.length, `${client}'s widgetSnippet was not found`).toBeGreaterThan(80);
    }
  });

  it("emits the same attributes everywhere", () => {
    // The attributes are the markup's whole contract: a visitor's browser reads
    // these and nothing else about how the string was assembled.
    const ATTRIBUTES = ["src=", "data-key=", "data-lang=", "defer"];
    for (const [client, body] of Object.entries(bodies)) {
      for (const attribute of ATTRIBUTES) {
        expect(
          body.includes(attribute),
          `${client}'s snippet does not emit ${attribute}. The three builders ` +
            `are hand-ports of one line, and an owner copying from this client ` +
            `pastes something different from what the others give.`,
        ).toBe(true);
      }
    }
  });

  it("guards the default locale the same way everywhere", () => {
    // Every client omits the attribute for English, so the overwhelming
    // majority of snippets stay one plain line. A client that always emitted it
    // would put a language on pastes that never needed one; a client that never
    // emitted it is the bug this file was written for.
    for (const [client, body] of Object.entries(bodies)) {
      expect(
        /"en"|MessageLocale\.EN|MessageLocale\.en/.test(body),
        `${client} emits data-lang without checking for the default locale`,
      ).toBe(true);
    }
  });
});
