/**
 * #291 — the other-numbers list reads the same on web, Android and iOS.
 *
 * The sentence that matters is the match note. Adding a number here is not
 * bookkeeping: it changes which customer an inbound text or call is attributed
 * to. A client that dropped that line would let a crew add a number believing
 * it was a memo, and find out when a message arrived under a name they did not
 * expect.
 *
 * Every assertion runs against the source with COMMENTS STRIPPED. The prose
 * explaining why the note exists contains the note's own words, so a client
 * that deleted the line and kept the comment would otherwise pass — that is
 * exactly how the contact-fields twin of this file was decorative until it was
 * broken on purpose.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parityCode } from "./parity-source";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const SOURCES: Record<string, string> = {
  web: join(REPO_ROOT, "apps/web/src/components/contacts/phone-list.tsx"),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/features/contacts/PhoneList.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Features/Contacts/PhoneList.swift"),
};

/** The source with its comments removed. See the header. */
const code = parityCode;

/** Said on every client, verbatim. */
const SENTENCES: readonly string[] = [
  "Add another number",
  "Landline, the wife, the shop…",
  "Another number they answer",
  "Texts and calls from this number will show up under this customer, in ",
  "their own thread.",
];

describe("#291 the other-numbers list reads the same everywhere", () => {
  it("reads every source, so a passing run means something", () => {
    for (const [platform, path] of Object.entries(SOURCES)) {
      expect(code(path).length, platform).toBeGreaterThan(1000);
    }
  });

  it("carries every sentence on every client, verbatim", () => {
    const missing: string[] = [];
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = code(path);
      for (const sentence of SENTENCES) {
        if (!text.includes(sentence)) missing.push(`${platform}: ${sentence}`);
      }
    }
    expect(
      missing,
      "These #291 sentences are missing or reworded on some clients:\n  " +
        missing.join("\n  "),
    ).toEqual([]);
  });

  it("names the number in the remove control on every client", () => {
    // A row of numbers with a bare "Remove" beside each is a control somebody
    // taps by position. On a screen where two of a customer's lines differ by
    // one digit, that is a number deleted by accident.
    for (const [platform, path] of Object.entries(SOURCES)) {
      expect(code(path), `${platform}: remove names the number`).toMatch(
        /Remove \$?\{?entry\.phone_e164\}?|Remove \\\(entry\.phone_e164\)/,
      );
    }
  });

  /**
   * Where each client opens its "adding a number" branch, and what it calls
   * the note. Written out per platform rather than sniffed with a loose regex:
   * the first version searched for the word "adding" anywhere, which on web
   * matched the `useState` declaration near the top of the file and made the
   * whole assertion vacuous.
   */
  const NOTE = {
    web: {
      identifier: "PHONE_MATCH_NOTE",
      branch: "{adding ? (",
      declaration: "export const PHONE_MATCH_NOTE",
    },
    android: {
      identifier: "PHONE_MATCH_NOTE",
      branch: "if (adding) {",
      declaration: "const val PHONE_MATCH_NOTE",
    },
    ios: {
      identifier: "phoneMatchNote",
      branch: "if adding {",
      declaration: "let phoneMatchNote",
    },
  } as const;

  /**
   * The part of the file that RENDERS, with the constant declarations at the
   * bottom cut off.
   *
   * Both assertions below were decorative without this. The declaration sits
   * after the adding branch on every client, so "the identifier appears after
   * the branch" was satisfied by the declaration itself — a client that moved
   * the note to the top of the record, permanently visible, still passed.
   */
  function body(path: string, declaration: string): string {
    const text = code(path);
    const declAt = text.indexOf(declaration);
    return declAt === -1 ? text : text.slice(0, declAt);
  }

  /** Whole-word, so `phoneMatchNoteUnused` is not a use of `phoneMatchNote`. */
  function uses(text: string, identifier: string): number {
    return text.match(new RegExp(`\\b${identifier}\\b`, "g"))?.length ?? 0;
  }

  it("actually SHOWS the match note, rather than merely declaring it", () => {
    // Found by deleting the iOS render call and watching this file stay green:
    // the sentence was still in the source, just attached to nothing.
    for (const [platform, path] of Object.entries(SOURCES)) {
      const { identifier, declaration } = NOTE[platform as keyof typeof NOTE];
      expect(
        uses(body(path, declaration), identifier),
        `${platform}: ${identifier} declared but never rendered`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps the match note out of sight until somebody is adding one", () => {
    // It belongs to the DECISION, not to the record. Shown permanently it
    // becomes furniture that nobody reads by the second visit — which is the
    // same as not saying it, except it also crowds every contact.
    for (const [platform, path] of Object.entries(SOURCES)) {
      const { identifier, branch, declaration } =
        NOTE[platform as keyof typeof NOTE];
      const text = body(path, declaration);
      const branchAt = text.indexOf(branch);
      expect(branchAt, `${platform}: has an adding branch`).toBeGreaterThan(-1);
      expect(
        uses(text.slice(0, branchAt), identifier),
        `${platform}: the match note is shown before anyone is adding a number`,
      ).toBe(0);
      expect(
        uses(text.slice(branchAt), identifier),
        `${platform}: the match note must sit inside the adding branch`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});
