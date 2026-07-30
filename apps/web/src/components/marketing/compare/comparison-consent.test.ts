import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONSENT_LABEL } from "./comparison-consent";

/**
 * #312 — the words shown and the words stored must be the same words.
 *
 * The consent record's whole value is that it proves what somebody agreed to. The
 * server snapshots `MARKETING_CONSENT_TEXT` onto the row, and the visitor reads
 * `CONSENT_LABEL` beside the checkbox. If those two drift, every consent taken
 * afterwards is a record of a sentence nobody was shown — which is worse than no
 * record, because it looks like evidence.
 *
 * They cannot be one import: the string lives in the API Worker's module and the
 * form is a web client component, and the two do not share a package. So this is
 * the binding instead, read from source.
 *
 * The server is the source of truth on purpose. The route ignores any consent text
 * a client sends and stores its own constant, because a client that could supply
 * the wording could record any agreement it liked.
 */

const API_MODULE = join(
  process.cwd(),
  "..",
  "api",
  "src",
  "marketing",
  "comparison-email.ts",
);

/** The value of `MARKETING_CONSENT_TEXT`, evaluated from its source. */
function serverConsentText(): string {
  const source = readFileSync(API_MODULE, "utf8");
  const match =
    /export const MARKETING_CONSENT_TEXT\s*=\s*([\s\S]*?);\n/.exec(source);
  expect(
    match,
    "MARKETING_CONSENT_TEXT is no longer declared in apps/api/src/marketing/" +
      "comparison-email.ts. If it moved, point this test at the new home rather " +
      "than deleting it.",
  ).not.toBeNull();
  // A concatenation of string literals. Joining the literals is safer than eval
  // and fails loudly if the declaration ever becomes something more complicated.
  const literals = [...(match?.[1] ?? "").matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(
    (m) => m[1].replace(/\\"/g, '"'),
  );
  expect(literals.length, "could not read the consent literals").toBeGreaterThan(0);
  return literals.join("");
}

describe("#312 the consent shown is the consent stored", () => {
  it("matches the server's MARKETING_CONSENT_TEXT exactly", () => {
    expect(
      CONSENT_LABEL,
      "The checkbox label and the text stored on the consent record have " +
        "diverged. Every consent taken from now on would record a sentence the " +
        "person was never shown.",
    ).toBe(serverConsentText());
  });

  it("says the two things a consent has to say", () => {
    // Not a style check. Express consent has to cover what they are agreeing to
    // receive and that it is reversible; a label saying only "email me this" would
    // not support a marketing send later.
    expect(CONSENT_LABEL.toLowerCase()).toContain("email me");
    expect(CONSENT_LABEL.toLowerCase()).toContain("unsubscribe");
  });

  it("has no em or en dash (Law 6)", () => {
    // The same rule the blog pages are held to: this string is rendered on a
    // marketing page and stored verbatim in a record we might have to produce.
    expect(CONSENT_LABEL).not.toMatch(/[–—]/);
  });
});
