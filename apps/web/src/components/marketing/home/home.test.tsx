/**
 * Home-crew tests (v4 "FIRST RESPONSE"): the eleven-section home page, the
 * hero Arrival Field contract, and the S6/S9 product embeds.
 *
 * What must hold (DESIGN-DIRECTION v4 + owner amendments 2026-07-07):
 *  - Law 1: no artifact talk anywhere; the only content label is the
 *    SCRIPTED DEMO chip (EXAMPLE CONVERSATION is trade-pages-only).
 *  - Law 2: product embeds carry APP tokens only, no marketing tokens inside
 *    a frame.
 *  - Law 4/§3.4: Flare stays on the whitelist, counted per component.
 *  - Law 6: no em-dashes (or en-dash digit ranges) in rendered output.
 *  - Law 7: the factual claims survive the v4 restage, worded per COPY-DECK
 *    v2. The #70 unit-language guard and the #28 add-on truth guard from the
 *    deleted night/pricing.test.ts carry forward here.
 *  - Law 11: nothing fake-live outside a SCRIPTED DEMO frame.
 *  - Owner rule 12: canonical domain is https://loonext.com.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/font/local needs the Next build plugin; in vitest we only need the
// stable variable/class contract (AppSurface mounts --font-golos).
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "font-golos-mock", className: "font-golos-mock" }),
}));

import HomePage, { metadata } from "@/app/(marketing)/page";
import { DEMO_CHIP_LABELS } from "@/components/marketing/fr";
import {
  ARRIVAL_SCRIPT,
  INBOX_ROW_CAP,
} from "@/components/marketing/hero/arrival-script";
import { Hero } from "@/components/marketing/hero/hero";
import { AppSurface } from "@/components/marketing/thread-demo/app-surface";
import { DARK_BAND_SCRIPT } from "@/components/marketing/thread-demo/script";
import { StaticThread } from "@/components/marketing/thread-demo/static-thread";
import { APP_LINKS, LIVE_ROUTES } from "@/lib/marketing/site";
import { PLAN_MODULE_CARDS } from "@/lib/api/types";

import {
  AssignTrackEmbed,
  NotesEmbed,
  SavedRepliesEmbed,
} from "./bento-embeds";
import { Bento } from "./bento";
import { Faq, HOME_FAQS } from "./faq";
import { FinalCta } from "./final-cta";
import { FirstWeekTimeline } from "./first-week-timeline";
import { Pattern } from "./pattern";
import { HOME_PLANS, planItemText, TheDeal } from "./the-deal";
import { TruthBar } from "./truth-bar";
import { UsageMeterEmbed } from "./usage-meter";

const PAGE = renderToStaticMarkup(<HomePage />);

const EMBEDS: Record<string, string> = {
  assignTrack: renderToStaticMarkup(<AssignTrackEmbed />),
  notes: renderToStaticMarkup(<NotesEmbed />),
  savedReplies: renderToStaticMarkup(<SavedRepliesEmbed />),
  usageMeter: renderToStaticMarkup(<UsageMeterEmbed />),
  darkPhoneThread: renderToStaticMarkup(
    <AppSurface>
      <StaticThread script={DARK_BAND_SCRIPT} framing="phone" />
    </AppSurface>,
  ),
};

describe("laws that hold across the whole page (Laws 1, 6, 11)", () => {
  it("no em-dashes, no en-dash digit ranges, anywhere", () => {
    expect(PAGE).not.toContain("—");
    expect(PAGE).not.toMatch(/\d–\d/);
    expect(PAGE).not.toContain("–");
  });

  it("never talks about itself as an artifact (Law 1 + purge list)", () => {
    expect(PAGE).not.toMatch(
      /real interface|not a screenshot|screenshot|stock photo|fake review|built with next|set in |pending, added before launch/i,
    );
  });

  it("the only demo label is the SCRIPTED DEMO chip", () => {
    expect(PAGE).toContain(DEMO_CHIP_LABELS["scripted-demo"]);
    expect(PAGE).not.toContain(DEMO_CHIP_LABELS["example-conversation"]);
  });

  it("no fake liveness (Law 11): nothing pulses, nothing claims to be live", () => {
    expect(PAGE).not.toContain("animate-pulse");
    expect(PAGE).not.toMatch(/\bonline now|\blive now|typing…/i);
    for (const [name, html] of Object.entries(EMBEDS)) {
      expect(html, name).not.toContain("animate-pulse");
    }
  });

  it("opens with the load-bearing dateline, exactly one ink chip", () => {
    expect(PAGE).toContain("9:04 PM · TUESDAY");
    expect(
      PAGE.match(/bg-\[color:var\(--fr-ink\)\] text-white/g)?.length,
    ).toBe(1); // the dateline chip; the footer band lives in the layout
  });

  it("keeps the nav-trigger home anchors and the eleven-section ids", () => {
    for (const id of [
      "after-dark",
      "see-it-work",
      "steps",
      "day",
      "math",
      "deal",
      "rules",
      "faq",
      "start",
    ]) {
      expect(PAGE).toContain(`id="${id}"`);
    }
  });

  it("every internal link resolves to a real route (zero dead links)", () => {
    const live = new Set<string>([
      ...Object.values(LIVE_ROUTES),
      APP_LINKS.login,
      APP_LINKS.signup,
    ]);
    const hrefs = [...PAGE.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      if (href.startsWith("http")) continue; // schema.org URLs in JSON-LD
      expect(live.has(href), `dead link: ${href}`).toBe(true);
    }
  });
});

describe("plan cards (#70 unit-language guard, ported from night/pricing.test.ts)", () => {
  it("states the allowances in plain 'texts', matching /pricing's numbers", () => {
    const starter = HOME_PLANS.find((plan) => plan.name === "Starter");
    const pro = HOME_PLANS.find((plan) => plan.name === "Pro");
    expect(starter?.items.map(planItemText).join(" ")).toContain(
      "500 texts a month",
    );
    expect(pro?.items.map(planItemText).join(" ")).toContain(
      "2,500 texts a month",
    );
  });

  it("never uses 'segments' jargon anywhere on the page (CONVERSION.md §3)", () => {
    for (const plan of HOME_PLANS) {
      for (const item of plan.items) {
        expect(planItemText(item).toLowerCase()).not.toContain("segment");
      }
    }
    expect(PAGE.toLowerCase()).not.toContain("segment");
  });

  it("prices and the first-month arithmetic per the deck", () => {
    expect(HOME_PLANS.map((p) => p.price)).toEqual(["$29", "$79"]);
    expect(PAGE).toContain("$58 your first month");
    expect(PAGE).toContain("3 to 7 business days");
    expect(PAGE).toContain("That&#x27;s the whole list.");
    expect(PAGE).toContain(
      "30-day money-back guarantee. Full refund, including the registration fee. No fine print.",
    );
  });
});

describe("add-on truth (#28 guard, ported): copy can never disagree with the catalog", () => {
  const mms = PLAN_MODULE_CARDS.find((card) => card.id === "mms");

  it("the S6 photos cell and the FAQ quote the catalog's MMS price and quantity", () => {
    // Deck copy states $5/mo and 150 sends; the catalog mirror is the source
    // of truth, so assert the deck strings against it (no silent drift).
    expect(mms?.price).toBe("$5");
    expect(mms?.detail).toContain("150");
    expect(PAGE).toContain(
      `Picture messaging is a ${mms?.price}/mo add-on with 150 sends a month included.`,
    );
    const photosFaq = HOME_FAQS.find((f) => f.q === "Can customers text us photos?");
    expect(photosFaq?.a).toContain(
      `picture messaging is ${mms?.price} a month and includes 150`,
    );
  });

  it("never advertises the unsellable regions_ca module", () => {
    const regionsCa = PLAN_MODULE_CARDS.find((card) => card.id === "regions_ca");
    expect(regionsCa).toBeDefined();
    // The module label ("Canada numbers") must not be sold on the home page.
    expect(PAGE).not.toContain(regionsCa!.label);
  });
});

describe("the Arrival Field contract (P5-SPEC v1)", () => {
  it("the scripted timestamps run in the spec's exact order and loop cleanly", () => {
    expect(ARRIVAL_SCRIPT.map((s) => s.time)).toEqual([
      "9:04 PM",
      "6:48 AM",
      "12:15 PM",
      "5:31 PM",
      "8:47 AM",
    ]);
    expect(INBOX_ROW_CAP).toBe(4);
  });

  it("SSR ships the finished inbox (no hole) and the composed static field", () => {
    const hero = renderToStaticMarkup(<Hero />);
    // The static CONFLUENCE still: cobalt streamlines warming to a green
    // resolve at the dock. No Flare in the hero (this piece is resolution, not
    // the waiting beat), so the still ships cobalt + green alone.
    expect(hero).toContain("var(--fr-cobalt)");
    expect(hero).toContain("var(--fr-green)");
    expect(hero).not.toContain("var(--fr-flare)");
    // The real inbox rows, finished state, app tokens.
    for (const row of ARRIVAL_SCRIPT.slice(0, INBOX_ROW_CAP)) {
      expect(hero).toContain(row.name);
    }
    // Deck §S1: the hero inbox ships with no caption and no chip.
    expect(hero).not.toContain("<figcaption");
    // The H1 (the LCP) and the truth line.
    expect(hero).toContain("Somebody texted your business at 9:04 last night.");
    expect(hero).toContain("We file everything the minute you pay.");
  });
});

describe("product embeds keep APP tokens (Law 2)", () => {
  for (const [name, html] of Object.entries(EMBEDS)) {
    it(`${name}: no marketing tokens inside the product surface`, () => {
      expect(html).not.toContain("--fr-cobalt");
      expect(html).not.toContain("--fr-ink");
      expect(html).not.toContain("--fr-frost");
      expect(html).not.toContain("--fr-flare");
      expect(html).not.toContain("—");
    });
  }

  it("the embeds draw with the app's own utility tokens", () => {
    expect(EMBEDS.assignTrack).toMatch(/text-app-ink/);
    expect(EMBEDS.usageMeter).toMatch(/bg-primary/); // the petrol fill
    expect(EMBEDS.savedReplies).toContain("{first_name}");
    expect(EMBEDS.darkPhoneThread).toContain("On my way, should be with you");
  });
});

describe("the Flare whitelist, counted per component (§3.4)", () => {
  const flareCount = (html: string) => (html.match(/--fr-flare/g) ?? []).length;

  it("pain cards: exactly the three artifact-header dots (§3.4.2)", () => {
    expect(flareCount(renderToStaticMarkup(<Pattern />))).toBe(3);
  });

  it("first-week timeline: exactly the YOU ARE HERE tab border (§3.4.4)", () => {
    expect(flareCount(renderToStaticMarkup(<FirstWeekTimeline />))).toBe(1);
  });

  it("the deal: exactly the rival climbing line (§3.4.5)", () => {
    expect(flareCount(renderToStaticMarkup(<TheDeal />))).toBe(1);
  });

  it("truth bar, bento, FAQ, and the final CTA carry no Flare at all", () => {
    expect(flareCount(renderToStaticMarkup(<TruthBar />))).toBe(0);
    expect(flareCount(renderToStaticMarkup(<Bento />))).toBe(0);
    expect(flareCount(renderToStaticMarkup(<Faq />))).toBe(0);
    expect(flareCount(renderToStaticMarkup(<FinalCta />))).toBe(0);
  });
});

describe("the one cobalt band (Laws 3 and 5)", () => {
  it("the final CTA is the only cobalt-ground band, with the static backdrop", () => {
    const finalCta = renderToStaticMarkup(<FinalCta />);
    expect(finalCta).toContain('id="start"');
    expect(finalCta).toContain("<svg"); // the static converged derivative
    expect(finalCta).not.toContain("<canvas");
    expect(finalCta).toContain(
      "$29/MO FLAT · MONTH TO MONTH · 30-DAY MONEY-BACK",
    );
    // No live canvas anywhere in the server markup (the p5 layer is a lazy
    // client chunk that only ever mounts on the hero).
    expect(PAGE).not.toContain("<canvas");
  });
});

describe("metadata (Law 6 + owner rule 12: canonical domain https://loonext.com)", () => {
  it("canonical resolves to loonext.com and strings are dash-free", () => {
    expect(metadata.alternates?.canonical).toBe("https://loonext.com");
    const strings = [
      JSON.stringify(metadata.title),
      String(metadata.description ?? ""),
      String(metadata.openGraph?.title ?? ""),
      String(metadata.openGraph?.description ?? ""),
    ].join(" ");
    expect(strings).not.toContain("—");
    expect(strings).not.toMatch(/\d–\d/);
    expect(strings).not.toContain("loonext.app");
  });
});
