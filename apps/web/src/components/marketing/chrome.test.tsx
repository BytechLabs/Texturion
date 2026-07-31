import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LIVE_ROUTES } from "@/lib/marketing/site";

import { Footer } from "./footer";
import {
  compareMenu,
  NAV_MENUS,
  PRICING_LINK,
  PRIMARY_CTA_LABEL,
  productMenu,
  SECONDARY_CTA_LABEL,
  tradesMenu,
} from "./nav-links";

/**
 * v4 "FIRST RESPONSE" chrome guards (COPY-DECK v2 §Global + §F, V4 coverage
 * map, Laws 1 and 6). The factual/route-coverage assertions from the old
 * chrome carry forward: every link resolves to a real route, zero dead ends.
 */

const ALL_LIVE = new Set<string>(Object.values(LIVE_ROUTES));

describe("nav-links (deck §Global: Product · Pricing · Who it's for · Compare)", () => {
  /**
   * #491: DERIVED, not enumerated. This used to assert "exactly the 4 feature
   * pages" against a hardcoded list, which made it a ceiling rather than a
   * coverage check — calling had shipped on every plan since D36-D43 and the
   * test that should have caught its absence from the nav was instead the
   * thing forbidding its presence.
   *
   * Now: every `features*` route in LIVE_ROUTES must be reachable from the
   * Product menu, and the menu may not link anything else. Adding a feature
   * page and forgetting the nav fails here; adding one to the nav needs no
   * edit to this file at all.
   */
  it("Product menu covers every feature page, and only feature pages", () => {
    const featureRoutes = Object.entries(LIVE_ROUTES)
      .filter(([key]) => key.startsWith("features"))
      .map(([, path]) => path);
    expect(featureRoutes.length).toBeGreaterThan(0);
    expect(new Set(productMenu.items.map((i) => i.href))).toEqual(
      new Set(featureRoutes),
    );
  });

  it("Who it's for menu links exactly the 6 trades", () => {
    expect(new Set(tradesMenu.items.map((i) => i.href))).toEqual(
      new Set([
        LIVE_ROUTES.forPlumbers,
        LIVE_ROUTES.forHvac,
        LIVE_ROUTES.forLandscapers,
        LIVE_ROUTES.forCleaners,
        LIVE_ROUTES.forSalons,
        LIVE_ROUTES.forContractors,
      ]),
    );
  });

  it("Compare menu links exactly the 2 rivals", () => {
    expect(new Set(compareMenu.items.map((i) => i.href))).toEqual(
      new Set([
        LIVE_ROUTES.compareHeymarket,
        LIVE_ROUTES.compareQuo,
      ]),
    );
  });

  it("every nav href resolves to a real live route (zero dead links)", () => {
    const hrefs = [
      PRICING_LINK.href,
      ...NAV_MENUS.flatMap((m) => m.items.map((i) => i.href)),
    ];
    for (const href of hrefs) {
      expect(ALL_LIVE.has(href), `dead nav link: ${href}`).toBe(true);
    }
  });

  it("every mega-menu item carries a single icon ref (amendment 15)", () => {
    for (const menu of NAV_MENUS) {
      for (const item of menu.items) {
        expect(item.icon, `${menu.label} / ${item.label} has no icon`).toBeDefined();
      }
    }
  });

  it("CTA labels are the deck's, verbatim", () => {
    expect(PRIMARY_CTA_LABEL).toBe("Get your number");
    expect(SECONDARY_CTA_LABEL).toBe("See pricing");
  });

  it("no nav copy carries an em-dash (Law 6) or artifact talk (Law 1)", () => {
    const copy = JSON.stringify([NAV_MENUS, PRICING_LINK, PRIMARY_CTA_LABEL]);
    expect(copy).not.toContain("—");
    expect(copy).not.toMatch(/real interface|stock photo/i);
  });
});

describe("footer (deck §F: the Dispatch Ink band)", () => {
  const html = renderToStaticMarkup(<Footer />);

  it("covers every coverage-map route: Product 7 · Who it's for 6 · Compare 2 · Company and legal 9", () => {
    const required = [
      // Product (7)
      LIVE_ROUTES.featuresSharedInbox,
      LIVE_ROUTES.featuresBusinessNumber,
      LIVE_ROUTES.featuresCompliance,
      LIVE_ROUTES.featuresTemplatesAndTags,
      LIVE_ROUTES.pricing,
      LIVE_ROUTES.security,
      LIVE_ROUTES.canada,
      // Who it's for (6)
      LIVE_ROUTES.forPlumbers,
      LIVE_ROUTES.forLandscapers,
      LIVE_ROUTES.forCleaners,
      LIVE_ROUTES.forHvac,
      LIVE_ROUTES.forSalons,
      LIVE_ROUTES.forContractors,
      // Compare (2)
      LIVE_ROUTES.compareHeymarket,
      LIVE_ROUTES.compareQuo,
      // Company and legal (9)
      LIVE_ROUTES.terms,
      LIVE_ROUTES.privacy,
      LIVE_ROUTES.aup,
      LIVE_ROUTES.messaging,
      LIVE_ROUTES.subprocessors,
      LIVE_ROUTES.refunds,
      LIVE_ROUTES.status,
      LIVE_ROUTES.contact,
      // home (the wordmark)
      "/",
    ];
    for (const href of required) {
      expect(html, `footer missing link to ${href}`).toContain(
        `href="${href}"`,
      );
    }
  });

  it("brand line and sign-off are the deck's, verbatim", () => {
    // #491: was "The shared text inbox for your crew." — one of the tagline
    // alternates in docs/marketing/BRAND-MESSAGING.md, and the one that named
    // only half the line. Calls have been included on every plan since
    // D36-D43. The PRIMARY tagline is untouched: it says number and inbox,
    // which was right before the product caught up to it.
    expect(html).toContain("The shared line for your crew.");
    expect(html).toContain("Month to month. No sales calls, ever.");
    expect(html).toMatch(/© \d{4} Loonext\. All rights reserved\./);
  });

  it("Law 1 purge holds: no credits, no artifact talk, no placeholder identity line", () => {
    expect(html).not.toMatch(/set in |built with|stock photo|fake review/i);
    expect(html).not.toMatch(/besley|public sans|martian mono|next\.js/i);
    // Purge 7: while ops has not supplied the legal entity, NOTHING renders
    // (never the old "pending, added before launch" sentence).
    expect(html).not.toMatch(/pending/i);
  });

  it("Law 6: no em-dashes; Law 2/QA: no petrol in marketing chrome", () => {
    expect(html).not.toContain("—");
    expect(html.toLowerCase()).not.toContain("#0f766e");
  });

  it("is the separate dark band (v4 §4), not a light footer", () => {
    // #362 phase 8: --fr-inverse, NOT --fr-ink. Ink is text and flips light on
    // dark; a band painted with it would invert and take every link with it.
    expect(html).toContain("--fr-inverse");
    expect(html).not.toMatch(/background-color: var\(--fr-ink\)/);
    // And its labels ride the band's own ramp rather than a literal white,
    // which on the dark band would be the wrong end of the scale.
    expect(html).toContain("--fr-on-inverse");
    expect(html).not.toContain("text-white");
  });
});
