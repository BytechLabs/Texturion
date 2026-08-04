import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SecurityPage, { metadata } from "./page";

/**
 * /security guards (COPY-DECK v2, DESIGN-DIRECTION v4 §6 SECURITY):
 * verifiable checked claims with green ticks, the deck's dateline and H1,
 * no padlock imagery, no certifications we don't hold.
 */

const html = renderToStaticMarkup(<SecurityPage />);

describe("/security — the checked-claims page", () => {
  it("opens with the deck's dateline and H1", () => {
    expect(html).toContain("ENCRYPTED IN TRANSIT AND AT REST");
    expect(html).toContain("Security, in plain terms.");
  });

  it("carries the deck's five verifiable claims", () => {
    for (const claim of [
      "Encrypted in transit and at rest",
      "Message content stays out of analytics and error logs",
      "Your data is stored in the United States",
      "Sub-processors listed publicly",
      "30-day data handling on cancellation, as documented",
    ]) {
      expect(html).toContain(claim);
    }
  });

  it("keeps the verifiable mechanics: RLS tenancy, signed webhooks, key hygiene, abuse caps", () => {
    expect(html).toContain("row-level security");
    expect(html).toContain("Ed25519");
    expect(html).toContain("HMAC");
    expect(html).toContain("restricted key");
    expect(html).toContain("spending cap");
  });

  it("ticks are Answered Green; no padlock imagery, no invented certifications", () => {
    expect(html).toContain("var(--fr-green)");
    expect(html).not.toMatch(/padlock|lucide-lock|shield/i);
    // #285/D119: the rule is no INVENTED certification, not no mention of
    // one. The page now states plainly that we hold none, and a buyer's
    // questionnaire asks by name — so a reader searching for "SOC 2" should
    // find the answer rather than nothing.
    //
    // What stays forbidden is a CLAIM: the acronym next to a word that would
    // assert we have it. Written as the claim rather than the word, because
    // the previous form could only be satisfied by silence, and silence is
    // what sends a buyer to email us for something already decided.
    expect(html).not.toMatch(
      /(SOC ?2|ISO ?27001|HIPAA)[^.]{0,40}(certified|compliant|attested|audited|accredited)/i,
    );
    expect(html).not.toMatch(
      /(certified|compliant|attested|audited|accredited)[^.]{0,40}(SOC ?2|ISO ?27001|HIPAA)/i,
    );
    // And the position itself is on the page, so this cannot be satisfied by
    // deleting the section instead.
    expect(html).toMatch(/we hold none/i);
    expect(html).toMatch(/No SOC 2/i);
  });

  it("links resolve to the real trust routes", () => {
    expect(html).toContain('href="/legal/subprocessors"');
    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('href="/legal/terms"');
    expect(html).toContain("security@loonext.com");
  });

  it("keeps responsible disclosure", () => {
    expect(html).toContain("Responsible disclosure");
    expect(html).toContain("steps to reproduce");
  });

  it("no em-dash, no artifact talk, no petrol in marketing chrome (Laws 1, 6; token audit)", () => {
    expect(html).not.toMatch(/—|–/);
    expect(String(metadata.description)).not.toMatch(/—|–/);
    expect(html).not.toMatch(/real interface|stock photo|built with next/i);
    expect(html).not.toContain("--petrol");
  });
});
