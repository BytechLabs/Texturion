import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LIVE_ROUTES } from "@/lib/marketing/site";

/**
 * #238 / #285 — the published statement cannot say more than the document does.
 *
 * `docs/ACCESSIBILITY.md` is buyer-ready and was reachable only by somebody
 * with a clone. Publishing it introduces the one risk the document was written
 * to avoid: a second copy of a claim about our own product, drifting quietly
 * from the evidence.
 *
 * The page defends against that structurally — it PARSES the verified table
 * out of the markdown at build time rather than restating it, and throws if
 * the parse finds nothing. These tests hold the parts a parser cannot:
 *
 *   1. the page exists at the route the footer and llms.txt advertise;
 *   2. the prose that is hand-written on the page does not claim anything the
 *      document withholds — specifically the two "we have not done this"
 *      statements, which are the ones a buyer is most harmed by losing;
 *   3. the parser is pointed at a file that still has the section it reads.
 *
 * What this deliberately does NOT check: whether the named tests are any good.
 * That is what the break sweeps are for, and `accessibility-statement.test.ts`
 * already checks that every path the document cites exists.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "..", "..");
const DOC = join(REPO, "docs", "ACCESSIBILITY.md");
const PAGE = join(
  dirname(fileURLToPath(import.meta.url)),
  "page.tsx",
);

const doc = readFileSync(DOC, "utf8");
const page = readFileSync(PAGE, "utf8");

/**
 * Only the part that RENDERS — everything from the component down.
 *
 * The refusal assertions below were satisfiable by the `<meta>` description
 * alone, which says "no third-party audit claimed" in passing. A page that
 * dropped the refusal from its visible prose and kept it in a meta tag would
 * have passed, and a buyer reads the page rather than the head. Found by
 * breaking this file case-insensitively: the capitalised body copy could be
 * removed entirely and the lowercase metadata kept it green.
 */
const body = page.slice(page.indexOf("export default function"));
if (body.length < 500) {
  throw new Error(
    "published-statement.test.ts could not find the component body — the " +
      "refusal assertions below would be checking almost nothing",
  );
}

describe("#238 the accessibility statement is published", () => {
  it("lives at the route the footer and llms.txt point at", () => {
    // Three places have to agree or the link is a 404 on a page whose whole
    // subject is not letting people down.
    expect(LIVE_ROUTES.accessibility).toBe("/legal/accessibility");
    const footer = readFileSync(
      join(REPO, "apps", "web", "src", "components", "marketing", "footer.tsx"),
      "utf8",
    );
    expect(footer).toContain("LIVE_ROUTES.accessibility");
    expect(page).toContain('const PATH = "/legal/accessibility"');
  });

  it("reads the table out of the document instead of restating it", () => {
    // The structural half. If somebody replaces the parse with a hand-typed
    // array, the page becomes a second source and this is what notices.
    expect(page).toContain("ACCESSIBILITY.md");
    expect(page).toContain("## Verified mechanically");
    // And the document still has the section the parser looks for.
    expect(doc).toContain("## Verified mechanically");
  });

  it("refuses to publish an empty verified table", () => {
    // A silent empty parse would publish "we verify nothing" as confidently as
    // the real thing, so the page throws instead. Asserted because it is the
    // difference between a build failure and a false statement to a customer.
    expect(page).toContain("refusing");
    expect(page).toMatch(/rows\.length === 0/);
  });
});

describe("#238 the page keeps the document's refusals", () => {
  /*
   * A conformance statement is judged on what it declines to claim. These two
   * are the ones a buyer is most harmed by losing, and they are hand-written
   * prose on the page rather than parsed rows — so nothing structural protects
   * them.
   */
  it("still says no screen-reader pass has been performed", () => {
    expect(doc).toMatch(/No TalkBack or VoiceOver pass has been performed/i);
    expect(body).toMatch(/No TalkBack or VoiceOver pass has been performed/i);
  });

  it("still says there has been no third-party audit", () => {
    expect(doc).toMatch(/No third-party audit/i);
    expect(body).toMatch(/No third-party audit/i);
  });

  it("does not claim a conformance level the document does not", () => {
    // The document targets 2.2 AA. A page that quietly said "AAA", or dropped
    // the level, would be the drift this file exists for.
    expect(doc).toContain("WCAG 2.2 Level AA");
    expect(page).toContain("WCAG 2.2");
    expect(page).not.toMatch(/AAA/);
  });
});
