/**
 * Home-crew tests (v4 "FIRST RESPONSE"): the eleven-section home page, the
 * hero Arrival Field contract, and the S6/S9 product embeds.
 *
 * What must hold (DESIGN-DIRECTION v4 + owner amendments 2026-07-07):
 *  - Law 1: no artifact talk anywhere; product demos render unlabeled, with
 *    no demo-labeling chip (owner amendment 2026-07-08).
 *  - Law 2: product embeds carry APP tokens only, no marketing tokens inside
 *    a frame.
 *  - Law 4/§3.4: Flare stays on the whitelist, counted per component.
 *  - Law 6: no em-dashes (or en-dash digit ranges) in rendered output.
 *  - Law 7: the factual claims survive the v4 restage, worded per COPY-DECK
 *    v2. The #70 unit-language guard and the #28 add-on truth guard from the
 *    deleted night/pricing.test.ts carry forward here.
 *  - Law 11: nothing fake-live; invented current-state frames render inside a
 *    PanelFrame and nothing pulses or claims to be live.
 *  - Owner rule 12: canonical domain is https://loonext.com.
 */

import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/font/local needs the Next build plugin; in vitest we only need the
// stable variable/class contract (AppSurface mounts --font-golos).
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "font-golos-mock", className: "font-golos-mock" }),
}));

import HomePage, { metadata } from "@/app/(marketing)/page";
import { CountryProvider } from "@/components/marketing/country";
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
import { RulesCanada } from "./rules-canada";
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

  it("attaches no demo-labeling chip (owner amendment 2026-07-08)", () => {
    expect(PAGE).not.toContain("SCRIPTED DEMO");
    expect(PAGE).not.toContain("EXAMPLE CONVERSATION");
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
  it("uses plain de-emphasized bullets with a fair-use asterisk, no 'unlimited' (#121)", () => {
    const starter = HOME_PLANS.find((plan) => plan.name === "Starter");
    const pro = HOME_PLANS.find((plan) => plan.name === "Pro");
    for (const plan of [starter, pro]) {
      const joined = plan!.items.map(planItemText).join(" ");
      expect(joined).toContain("Send and receive texts and pictures*");
      expect(joined.toLowerCase()).not.toContain("unlimited");
      // No allowance count or per-text figure on the home cards (#121).
      expect(joined).not.toMatch(/\d(\.\d+)?¢/);
      expect(joined).not.toMatch(/\b500\b|\b2,500\b/);
    }
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
  it("#97/#103: pictures are included — no Picture-messages add-on is sold anywhere", () => {
    // The retired module must be gone from the catalog mirror…
    expect(PLAN_MODULE_CARDS.map((card) => String(card.id))).not.toContain("mms");
    // …and the page must not sell it or quote its old $5/150 terms.
    expect(PAGE).not.toContain("Picture messaging is a $5/mo add-on");
    expect(PAGE).not.toContain("Picture messages");
    // #121: the three-texts metering detail lives only on /legal/fair-use.
    expect(PAGE).not.toContain("counts as three texts");
    const photosFaq = HOME_FAQS.find((f) => f.q === "Can customers text us photos?");
    expect(photosFaq?.a).toContain("included");
    expect(photosFaq?.a).toContain("fair-use policy");
    expect(photosFaq?.a).not.toContain("three texts");
    expect(photosFaq?.a).not.toContain("$5");
  });

  it("#121: no hard-limit numbers on the home page; the fair-use policy is linked instead", () => {
    // No allowance figures, per-text rates, GB caps, or storage-cap language.
    expect(PAGE).not.toMatch(/\b500\b|\b2,500\b/);
    expect(PAGE).not.toMatch(/\d(\.\d+)?¢/);
    expect(PAGE).not.toMatch(/\bGB\b/);
    expect(PAGE).not.toContain("included storage");
    expect(PAGE).not.toContain("Extra storage");
    // The concrete numbers live in one place, and the page links to it.
    expect(PAGE).toContain('href="/legal/fair-use"');
    // The FAQ keeps the alerts + cap remediation story.
    const overFaq = HOME_FAQS.find(
      (f) => f.q === "What happens if we go over our included texting?",
    );
    expect(overFaq?.a).toContain("80% and again at 100%");
    expect(overFaq?.a).toContain("spending cap you control");
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
    // #85/#95: the usage embed is the CALM resting state now (count + cap, no
    // "of N" fill bar), so it uses the app's surface/secondary tokens.
    expect(EMBEDS.usageMeter).toMatch(/bg-secondary/);
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

describe("country branching: the home never pairs the two stories (owner ruling v1)", () => {
  // A component rendered inside the site-wide provider, pinned to a country.
  const ca = (node: ReactNode) =>
    renderToStaticMarkup(
      <CountryProvider initialCountry="ca">{node}</CountryProvider>,
    );
  const us = (node: ReactNode) =>
    renderToStaticMarkup(
      <CountryProvider initialCountry="us">{node}</CountryProvider>,
    );

  it("hero truth line: US reads the carrier wait, CA reads same-day, never both", () => {
    const usHero = renderToStaticMarkup(<Hero />); // SSR default is us
    expect(usHero).toContain("Texting US customers turns on in about a week");
    expect(usHero).toContain("We file everything the minute you pay.");
    expect(usHero).not.toContain("text Canadian customers the same day");

    const caHero = ca(<Hero />);
    expect(caHero).toContain("text Canadian customers the same day");
    expect(caHero).toContain("No registration, no fee, no waiting.");
    expect(caHero).not.toContain("Texting US customers turns on");
    expect(caHero).not.toContain("to register with the phone companies");
  });

  it("first-week timeline: US has the 3-to-7-day review, CA has no wait", () => {
    const usT = renderToStaticMarkup(<FirstWeekTimeline />);
    expect(usT).toContain("3 to 7 business days");
    expect(usT).toContain("The phone companies review you.");
    expect(usT).toContain("You are here");

    const caT = ca(<FirstWeekTimeline />);
    expect(caT).not.toContain("3 to 7 business days");
    expect(caT).not.toContain("The phone companies review you.");
    expect(caT).toContain("live and texting the same day");
  });

  it("the deal: US carries the $58/registration story, CA is $29 flat", () => {
    const usD = us(<TheDeal />);
    expect(usD).toContain("$58 your first month");
    expect(usD).toContain("one-time $29 to register");
    expect(usD).toContain("including the registration fee");

    const caD = ca(<TheDeal />);
    expect(caD).not.toContain("$58");
    expect(caD).not.toContain("one-time $29 to register");
    expect(caD).not.toContain("including the registration fee");
    expect(caD).toContain("$29 a month, flat");
  });

  it("FAQ: US answers the carrier wait and the fee; CA answers neither as a default", () => {
    const usF = renderToStaticMarkup(<Faq />);
    expect(usF).toContain("Why does texting US customers take about a week?");
    expect(usF).toContain("What&#x27;s the one-time $29 fee?");
    expect(usF).not.toContain("When can I start texting customers?");

    const caF = ca(<Faq />);
    expect(caF).toContain("When can I start texting customers?");
    expect(caF).toContain("Can we also text US customers?");
    expect(caF).not.toContain("Why does texting US customers take about a week?");
    expect(caF).not.toContain("What&#x27;s the one-time $29 fee?");
    expect(caF).not.toContain("your first month is $58");
  });

  it("rules band: US shows the carrier proof + registration-tracked card; CA shows CASL + the day-one card, never the other's", () => {
    const usR = us(<RulesCanada />);
    // US: the carrier proof points and the US reassurance card.
    expect(usR).toContain("The carrier stuff, handled");
    expect(usR).toContain("Registration, filed for you.");
    expect(usR).toContain("Your registration, filed and tracked.");
    expect(usR).toContain("3 to 7 business days");
    // No Canadian content reaches a US visitor.
    expect(usR).not.toContain("In Canada");
    expect(usR).not.toContain("Texting Canadian customers, day one.");
    expect(usR).not.toContain("CASL");
    expect(usR).not.toContain("Local Canadian numbers");
    expect(usR).not.toContain("same day you sign up");

    const caR = ca(<RulesCanada />);
    // CA: the CASL-framed proof points and the day-one card, stated as fact.
    expect(caR).toContain("The rules, handled");
    expect(caR).toContain("No registration to file.");
    expect(caR).toContain("CASL");
    expect(caR).toContain("Texting Canadian customers, day one.");
    expect(caR).toContain("Local Canadian numbers");
    expect(caR).toContain("same day you sign up");
    // No US wait, fee, or 10DLC copy reaches a Canadian.
    expect(caR).not.toContain("3 to 7 business days");
    expect(caR).not.toContain("about a week");
    expect(caR).not.toContain("carrier approval");
    expect(caR).not.toContain("one-time $29");
    expect(caR).not.toContain("10DLC");
  });

  it("no em-dashes or en-dash ranges in the CA branch of any edited component", () => {
    for (const html of [
      ca(<Hero />),
      ca(<FirstWeekTimeline />),
      ca(<TheDeal />),
      ca(<Faq />),
      ca(<RulesCanada />),
    ]) {
      expect(html).not.toContain("—");
      expect(html).not.toContain("–");
      expect(html).not.toMatch(/\d–\d/);
    }
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
