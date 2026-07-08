import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LegalLink, LegalPage, LegalSectionBlock } from "./legal-page";

/**
 * LEGAL template guards (DESIGN-DIRECTION v4 §6 LEGAL): the quiet register.
 * Frost "Plain English summary" chip on top, 68ch single column, mono section
 * numbers, cobalt prose links, no hairline rules (Law 10), no dateline, no
 * art.
 */

function renderFixture() {
  return renderToStaticMarkup(
    <LegalPage
      title="Terms of service"
      summary="A short, true summary. Three or four sentences. Every one true."
      lastUpdated="July 2, 2026"
      breadcrumbLabel="Terms of service"
      path="/legal/terms"
      sections={[
        { id: "agreement", number: "1", heading: "The agreement" },
        { id: "list", heading: "Current sub-processors" },
      ]}
    >
      <LegalSectionBlock id="agreement" number="1" heading="The agreement">
        <p>
          Read our <LegalLink href="/legal/aup">acceptable use policy</LegalLink>
          .
        </p>
      </LegalSectionBlock>
      <LegalSectionBlock id="list" heading="Current sub-processors">
        <p>Unnumbered sections render without a mono numeral.</p>
      </LegalSectionBlock>
    </LegalPage>,
  );
}

describe("LegalPage — the v4 quiet register", () => {
  it("opens with the Frost Plain English summary chip and the true summary", () => {
    const html = renderFixture();
    expect(html).toContain("Plain English summary");
    expect(html).toContain("--fr-frost");
    expect(html).toContain(
      "A short, true summary. Three or four sentences. Every one true.",
    );
  });

  it("is a single 68ch column with the last-updated time element", () => {
    const html = renderFixture();
    expect(html).toContain("max-w-[68ch]");
    expect(html).toMatch(/datetime="2026-07-02"/i);
    expect(html).toContain("July 2, 2026");
  });

  it("gives numbered sections a two-digit mono numeral, unnumbered sections none", () => {
    const html = renderFixture();
    expect(html).toContain("01");
    expect(html).toContain("fr-mono-data");
    expect(html).toContain("The agreement");
    expect(html).toContain("Current sub-processors");
  });

  it("draws no hairline rules (Law 10): no border utilities in the template chrome", () => {
    const html = renderFixture();
    expect(html).not.toMatch(/class="[^"]*border-b[^"]*"/);
    expect(html).not.toMatch(/class="[^"]*border-l[^"]*"/);
    expect(html).not.toContain("--hairline");
  });

  it("prose links are cobalt (the marketing voice), never petrol", () => {
    const html = renderFixture();
    expect(html).toContain("--fr-cobalt");
    expect(html).not.toContain("--petrol");
  });

  it("emits the BreadcrumbList JSON-LD for the page", () => {
    const html = renderFixture();
    expect(html).toContain("BreadcrumbList");
    expect(html).toContain("/legal/terms");
  });

  it("carries a contents nav whose anchors match the section ids", () => {
    const html = renderFixture();
    expect(html).toContain('href="#agreement"');
    expect(html).toContain('id="agreement"');
    expect(html).toContain('href="#list"');
    expect(html).toContain('id="list"');
  });

  it("ships no em-dash and no artifact talk (Laws 1 and 6)", () => {
    const html = renderFixture();
    expect(html).not.toContain("—");
    expect(html).not.toMatch(/real interface|stock photo|built with next/i);
  });
});
