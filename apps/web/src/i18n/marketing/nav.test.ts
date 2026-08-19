import { describe, expect, it } from "vitest";

import {
  compareMenuFor,
  contactLinkFor,
  navMenusFor,
  PRICING_LINK,
  PRIMARY_CTA_LABEL,
  pricingLinkFor,
  productMenu,
  productMenuFor,
  SECONDARY_CTA_LABEL,
  tradesMenuFor,
} from "@/components/marketing/nav-links";

import { footerEn, footerFr } from "./footer";
import { navCopy, navEn, navFr } from "./nav";

/**
 * D138 Rule 10 — the marketing nav's words, in both languages.
 *
 * ## The English half is the one that could break something today
 *
 * `nav-links.ts` still exports `productMenu`, `PRICING_LINK`,
 * `PRIMARY_CTA_LABEL` and the rest, and the pricing page and
 * `chrome.test.tsx` still import them. What changed is that they are now BUILT
 * from this catalogue's English half. A typo in the catalogue is therefore a
 * change to the live English site, which is why the first block below pins
 * actual sentences rather than only checking that French exists.
 */

describe("the English nav is unchanged by having a catalogue behind it", () => {
  it("still says what the deck says", () => {
    const items = productMenu.items;
    expect(items.find((i) => i.label === "Shared inbox")?.description).toBe(
      "Every text in one inbox the whole crew can see.",
    );
    expect(items.find((i) => i.label === "Lou, your assistant")?.description).toBe(
      "Drafts replies and writes voicemails down. Never sends.",
    );
  });

  it("keeps the two CTA labels the rest of the site imports", () => {
    expect(PRIMARY_CTA_LABEL).toBe("Get your number");
    expect(SECONDARY_CTA_LABEL).toBe("See pricing");
    expect(PRICING_LINK.label).toBe("Pricing");
  });

  it("builds the same three menus in the same order", () => {
    expect(navMenusFor(navCopy("en")).map((m) => m.label)).toEqual([
      "Product",
      "Who it's for",
      "Compare",
    ]);
  });
});

describe("the French nav", () => {
  const fr = navCopy("fr-CA");

  it("translates every label and every description", () => {
    const items = [
      ...navMenusFor(fr).flatMap((m) => m.items),
      pricingLinkFor(fr),
      contactLinkFor(fr),
    ];
    // Not a spot check: every row in the panel, because a menu with one English
    // line in it is the half-translated page D138 Rule 3 forbids.
    const englishLeft = items.filter((item) => {
      const label = (Object.keys(navEn) as (keyof typeof navEn)[]).find(
        (key) => navEn[key] === item.label && navEn[key] !== navFr[key],
      );
      return label !== undefined;
    });
    expect(
      englishLeft.map((i) => i.label),
      "these nav rows are still in English",
    ).toEqual([]);
  });

  it("names the menus in French", () => {
    expect(navMenusFor(fr).map((m) => m.label)).toEqual([
      "Produit",
      "Pour qui",
      "Comparer",
    ]);
  });

  it("writes the competitor's price the way Quebec writes money", () => {
    // `49 $`, sign after the number with a space before it — the OQLF's rule.
    // A dollar sign in front is the tell that a French page was translated
    // word-by-word from English.
    const line = compareMenuFor(fr).items[0]?.description ?? "";
    expect(line).toContain("49 $");
    expect(line).not.toContain("$49");
  });

  it("leaves the names alone", () => {
    const labels = navMenusFor(fr).flatMap((m) => m.items.map((i) => i.label));
    expect(labels).toContain("Lou, votre adjoint");
    expect(labels).toContain("Loonext vs Heymarket");
    expect(labels).toContain("HVAC");
  });
});

describe("the nav and the footer do not drift apart", () => {
  /**
   * Both catalogues name many of the same pages, and a reader sees both on
   * every page. "Boîte de réception partagée" in the nav and something else in
   * the footer is the kind of difference nobody notices in review and every
   * reader notices on the page.
   *
   * The exceptions are named rather than skipped, so a NEW divergence fails
   * here instead of joining a silent list.
   */
  const DELIBERATELY_DIFFERENT = new Set([
    // The footer's link is a sentence ("Contact us"); the nav's is a menu
    // heading ("Contact"). Both are right where they sit.
    "contact",
  ]);

  const shared = (Object.keys(navEn) as (keyof typeof navEn)[]).filter(
    (key) => key in footerEn,
  );

  it("shares enough keys for this to be worth checking", () => {
    // A comparison over an empty intersection passes and proves nothing.
    expect(shared.length).toBeGreaterThan(10);
  });

  for (const locale of ["en", "fr-CA"] as const) {
    it(`agrees on every shared page name in ${locale}`, () => {
      const nav = locale === "en" ? navEn : navFr;
      const footer = locale === "en" ? footerEn : footerFr;
      const disagreements = shared.filter(
        (key) =>
          !DELIBERATELY_DIFFERENT.has(key) &&
          nav[key] !== footer[key as keyof typeof footer],
      );
      expect(
        disagreements,
        `the nav and the footer name these pages differently in ${locale}`,
      ).toEqual([]);
    });
  }
});

describe("the two nav catalogues", () => {
  it("carry the same keys", () => {
    expect(Object.keys(navFr).sort()).toEqual(Object.keys(navEn).sort());
  });

  it("differ everywhere except the names", () => {
    const identical = (Object.keys(navEn) as (keyof typeof navEn)[]).filter(
      (key) => navEn[key] === navFr[key],
    );
    expect(identical.sort()).toEqual(
      ["compareHeymarket", "compareQuo", "contacts", "hvac", "salons"].sort(),
    );
  });

  it("builds the same shape whichever language it is asked for", () => {
    // The menus are structure plus words. If French produced a different number
    // of rows, something has been dropped rather than translated.
    const en = productMenuFor(navCopy("en"));
    const fr = productMenuFor(navCopy("fr-CA"));
    expect(fr.items.length).toBe(en.items.length);
    expect(fr.items.map((i) => i.href)).toEqual(en.items.map((i) => i.href));
    expect(tradesMenuFor(navCopy("fr-CA")).items.length).toBe(6);
  });
});
