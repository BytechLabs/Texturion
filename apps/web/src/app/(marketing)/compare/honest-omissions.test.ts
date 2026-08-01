import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HONEST_OMISSIONS } from "./honest-omissions";

/**
 * #334 — a negative claim on a marketing page is a hostage to a decision made
 * somewhere else.
 *
 * The asymmetry the issue names is why this is worth a guard: a page that
 * UNDERSTATES us loses a deal quietly and nobody finds out; a page that
 * OVERSTATES us produces a refund request and a bad story. Both are invisible
 * until a customer surfaces them.
 *
 * The drift already happened. `docs/marketing/COPY.md` described an $8/mo voice
 * add-on forwarding calls to a phone you answer, months after calls shipped as a
 * browser softphone included on every plan. The live page had been corrected by
 * somebody noticing. Nothing guaranteed the next such correction.
 *
 * # What this ties together
 *
 * Each claim names the decision it rests on and the phrase in `DECISIONS.md`'s
 * "Do not build" table (#323) that carries the refusal. So removing a refusal
 * from that table — which is what amending a scope decision looks like — fails
 * here, naming the page that still claims it.
 *
 * That is the mechanism attached to an event that already happens. #334's
 * devil's advocate is right that a standing review nobody owns will not survive.
 */

const REPO = join(process.cwd(), "..", "..");
const DECISIONS = readFileSync(join(REPO, "docs", "DECISIONS.md"), "utf8");

/** The "Do not build" table, lowercased, as one blob to search. */
function doNotBuildTable(): string {
  const start = DECISIONS.indexOf("## Do not build");
  expect(start, "DECISIONS.md has no Do-not-build table").toBeGreaterThan(-1);
  const end = DECISIONS.indexOf("\n---", start);
  return DECISIONS.slice(start, end === -1 ? undefined : end).toLowerCase();
}

describe("#334 every negative claim cites the decision behind it", () => {
  it("states three omissions, so a deletion cannot make this vacuous", () => {
    expect(HONEST_OMISSIONS.length).toBeGreaterThanOrEqual(3);
  });

  it.each(HONEST_OMISSIONS)("$title names a decision that exists", (omission) => {
    expect(omission.decision).toMatch(/^D\d+$/);
    // The heading form, so a passing mention in some other decision's prose
    // cannot stand in for the decision itself.
    expect(
      DECISIONS.includes(`## ${omission.decision} `) ||
        DECISIONS.includes(`## ${omission.decision}.`),
      `${omission.decision} is not a decision in docs/DECISIONS.md`,
    ).toBe(true);
  });

  it.each(HONEST_OMISSIONS)("$title matches a recorded refusal", (omission) => {
    // THE tie. Amending a scope decision means editing that table, and this is
    // what turns the edit into a list of pages to correct.
    expect(
      doNotBuildTable().includes(omission.refusal),
      `"${omission.refusal}" is no longer in DECISIONS.md's "Do not build" table, ` +
        `but /compare still tells buyers "${omission.title}" If the decision ` +
        `changed, this claim is now wrong in the expensive direction.`,
    ).toBe(true);
  });
});

describe("#334 corrections keep the specifics", () => {
  it("the dialer claim still says what IS included", () => {
    // #334: "the temptation on discovering stale copy is to hedge everything
    // into vagueness. Vague copy converts worse and abandons the
    // differentiator." The dialer card concedes the positioning and then states
    // plainly that calling is included, which is the shape to preserve.
    const dialer = HONEST_OMISSIONS.find((o) => o.title.includes("dialer"));
    expect(dialer?.body).toMatch(/every plan/);
    expect(dialer?.body).toMatch(/voicemail/);
  });

  it("no claim describes the retired voice add-on or call forwarding", () => {
    // The exact drift this issue was filed over, in the exact words the stale
    // copy used. Calls are included on every plan (D42), the voice MODULE was
    // retired, and forwarding was deleted.
    for (const omission of HONEST_OMISSIONS) {
      const text = `${omission.title} ${omission.body}`.toLowerCase();
      expect(text, omission.title).not.toMatch(/add-?on/);
      expect(text, omission.title).not.toMatch(/forwards? calls/);
      expect(text, omission.title).not.toMatch(/\$8/);
    }
  });

  it("names the competitor that does the job instead", () => {
    // The reason the section is credible at all: conceding where somebody else
    // genuinely wins. A claim that only refuses is a claim that only costs.
    const named = HONEST_OMISSIONS.filter((o) =>
      /Heymarket|Podium|Quo/.test(o.body),
    );
    expect(named.length).toBe(HONEST_OMISSIONS.length);
  });
});
