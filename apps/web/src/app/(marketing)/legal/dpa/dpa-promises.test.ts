import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LIVE_ROUTES } from "@/lib/marketing/site";

/**
 * #285 — the three clauses the DPA deliberately UNDER-promises on.
 *
 * `docs/DPA.md` is a contract. Its worth is not that it sounds like one; it is
 * that every factual clause describes something the product actually does, and
 * that where the honest answer is "we do not do that" it says so instead of
 * reaching for standard wording.
 *
 * Three clauses carry that weight, and each reads as a weakness:
 *
 *   1. no residency guarantee
 *   2. deletion is incomplete, with the exception named
 *   3. no audit right we cannot service
 *
 * They are exactly the ones a future editor softens — during a legal review,
 * or under pressure from a buyer who wants a stronger commitment. Softening
 * any of them turns an accurate document into a written misrepresentation,
 * which is worse than having no DPA at all.
 *
 * The CITATIONS are not checked here: `scripts/check-doc-citations.mjs`
 * already fails on any cited path that stops resolving, across every document.
 * Repeating it would be a second guard drifting from the first.
 */

const REPO = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);
const dpa = readFileSync(join(REPO, "docs", "DPA.md"), "utf8");

describe("#285 the DPA is published and reachable", () => {
  it("lives at the route the footer and llms.txt point at", () => {
    expect(LIVE_ROUTES.dpa).toBe("/legal/dpa");
    const footer = readFileSync(
      join(REPO, "apps", "web", "src", "components", "marketing", "footer.tsx"),
      "utf8",
    );
    expect(footer).toContain("LIVE_ROUTES.dpa");
  });

  it("says plainly that no outside counsel has reviewed it", () => {
    // A buyer discovering that themselves is worse than being told. It is also
    // the sentence most likely to be quietly dropped once somebody DOES review
    // it — at which point this test should be updated, not deleted.
    expect(dpa).toMatch(/not been reviewed by outside counsel/i);
  });
});

describe("#285 the DPA does not promise what the product cannot do", () => {
  it("refuses a data residency guarantee", () => {
    /*
     * Storage is US, which is a statement of WHERE IT IS rather than a
     * commitment about where it will stay — and inference in particular
     * cannot be confined to a country. A DPA promising residency would be
     * false on the day it was signed.
     */
    expect(dpa).toMatch(/not a residency guarantee/i);
    expect(dpa).toMatch(/cannot be confined to a country/i);
  });

  it("says deletion is incomplete, and names the exception", () => {
    // "We delete everything" is the easy sentence and the untrue one. The
    // website contact form holds a message outside any workspace, and a
    // customer is entitled to know that before they rely on a deletion.
    expect(dpa).toMatch(/not complete in every store/i);
    expect(dpa).toMatch(/contact form/i);
  });

  it("grants no audit right we have no way to service", () => {
    // The clause a buyer's template asks for by default. Granting it would be
    // a promise with no mechanism behind it, and the absence of a SOC 2 is
    // stated in the same breath rather than left to be discovered.
    expect(dpa).toMatch(/do not offer on-site audits/i);
    expect(dpa).toMatch(/SOC 2/);
  });

  it("still tells a buyer that tenant isolation is one layer, not two", () => {
    /*
     * SPEC §10 is explicit that calling row-level security defence-in-depth
     * overstates it: the Worker's key bypasses RLS. `/security` said the
     * overstated version until it was corrected, so this is a sentence with a
     * demonstrated tendency to drift back.
     */
    expect(dpa).toMatch(/one layer,\s*\n?\s*not two/i);
  });
});
