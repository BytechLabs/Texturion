/**
 * Features-crew tests (v4 "FIRST RESPONSE"): the four /features/* pages,
 * /canada, the shared FEATURE-template blocks, the product embeds, and the
 * v4 frame chrome.
 *
 * What must hold (DESIGN-DIRECTION v4):
 *  - Law 1: no artifact talk anywhere ("real interface", "screenshot",
 *    "stock photos", font/framework credits). Product demos render unlabeled,
 *    with no demo-labeling chip (owner amendment 2026-07-08).
 *  - Law 2: product embeds carry APP tokens only (no marketing cobalt inside
 *    a frame); pages mount them inside PanelFrame's `.app-scope` region.
 *  - Law 6: no em-dashes (or en-dash ranges) in rendered output.
 *  - Law 7: the factual claims (prices, allowances, timelines, limits)
 *    survive the redesign, worded per COPY-DECK v2.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import BusinessNumberPage, {
  metadata as businessNumberMetadata,
} from "@/app/(marketing)/features/business-number/page";
import CanadaPage, { metadata as canadaMetadata } from "@/app/(marketing)/canada/page";
import CompliancePage, {
  metadata as complianceMetadata,
} from "@/app/(marketing)/features/compliance/page";
import SharedInboxPage, {
  metadata as sharedInboxMetadata,
} from "@/app/(marketing)/features/shared-inbox/page";
import TemplatesAndTagsPage, {
  metadata as templatesMetadata,
} from "@/app/(marketing)/features/templates-and-tags/page";
import { CountryProvider } from "@/components/marketing/country";
import { BrowserFrame } from "@/components/marketing/frame/browser-frame";
import { PhoneFrame } from "@/components/marketing/frame/phone-frame";
import { ConsentVisual } from "./consent-visual";
import {
  FeatureCta,
  PricingSnippet,
  TruthStrip,
  UseCaseSteps,
} from "./feature-page";
import { InboxListVisual } from "./inbox-list-visual";
import { NumberCardsVisual } from "./number-cards-visual";
import { OptOutVisual } from "./opt-out-visual";
import { QuietHoursVisual } from "./quiet-hours-visual";
import { RegistrationStepperVisual } from "./registration-stepper-visual";
import { SavedRepliesVisual } from "./saved-replies-visual";
import { TagsDoneVisual } from "./tags-done-visual";

const PAGES: Record<string, string> = {
  "shared-inbox": renderToStaticMarkup(<SharedInboxPage />),
  "business-number": renderToStaticMarkup(<BusinessNumberPage />),
  compliance: renderToStaticMarkup(<CompliancePage />),
  "templates-and-tags": renderToStaticMarkup(<TemplatesAndTagsPage />),
  canada: renderToStaticMarkup(<CanadaPage />),
};

// The two features-crew pages rendered in the Canada branch. The foundation's
// CountryProvider takes `initialCountry` so a static render can exercise either
// branch deterministically; renderToStaticMarkup never runs the effect that
// would otherwise adopt localStorage, so the tree stays in "ca". PAGES above is
// the US branch (default "us", no provider needed).
const CA_PAGES: Record<string, string> = {
  "business-number": renderToStaticMarkup(
    <CountryProvider initialCountry="ca">
      <BusinessNumberPage />
    </CountryProvider>,
  ),
  compliance: renderToStaticMarkup(
    <CountryProvider initialCountry="ca">
      <CompliancePage />
    </CountryProvider>,
  ),
};

const EMBEDS: Record<string, string> = {
  inbox: renderToStaticMarkup(<InboxListVisual />),
  numbers: renderToStaticMarkup(<NumberCardsVisual />),
  stepper: renderToStaticMarkup(<RegistrationStepperVisual />),
  consent: renderToStaticMarkup(<ConsentVisual />),
  optOut: renderToStaticMarkup(<OptOutVisual />),
  quietHours: renderToStaticMarkup(<QuietHoursVisual />),
  savedReplies: renderToStaticMarkup(<SavedRepliesVisual />),
  tagsDone: renderToStaticMarkup(<TagsDoneVisual />),
};

describe("laws that hold across every features/canada page (Laws 1, 6)", () => {
  for (const [name, html] of Object.entries(PAGES)) {
    it(`${name}: no em-dashes, no artifact talk, no font/framework credits`, () => {
      expect(html).not.toContain("—"); // em-dash
      // En-dash ranges ("3–7", "9–11") converted to "to"/"between" phrasing.
      expect(html).not.toMatch(/\d–\d/);
      expect(html).not.toMatch(
        /real interface|not a screenshot|screenshot|stock photo|fake review|built with next|set in |pending, added before launch/i,
      );
    });
  }

  it("attaches no demo-labeling chip on any page (owner amendment 2026-07-08)", () => {
    for (const html of Object.values(PAGES)) {
      expect(html).not.toContain("SCRIPTED DEMO");
      expect(html).not.toContain("EXAMPLE CONVERSATION");
    }
  });

  it("no fake liveness (Law 11): staged current-state frames never pulse or claim to be live", () => {
    // Invented unread counts / in-flight states sit inside an unlabeled
    // PanelFrame; nothing pulses or advertises itself as live.
    for (const [name, html] of Object.entries({ ...PAGES, ...EMBEDS })) {
      expect(html, name).not.toContain("animate-pulse");
      expect(html, name).not.toMatch(/\bonline now|\blive now|typing…/i);
    }
  });

  it("every page opens with its coverage-map dateline", () => {
    expect(PAGES["shared-inbox"]).toContain("1 OWNER PER CONVERSATION");
    expect(PAGES["business-number"]).toContain(
      "THE NUMBER BELONGS TO THE BUSINESS",
    );
    expect(PAGES.compliance).toContain("STOP MEANS STOP · INSTANTLY");
    expect(PAGES["templates-and-tags"]).toContain("TYPE / · TAP · SENT");
    expect(PAGES.canada).toContain("DAY ONE · NO WAIT");
  });

  it("bands alternate (Law 10): no two adjacent Frost section bands on any page", () => {
    // FrSection emits its ground class pair verbatim and first
    // ("bg-[...--fr-frost|--fr-ground)] text-[...--fr-ink)] py..."), which no
    // chip/well shares adjacently, so the match sequence IS the band sequence.
    const BAND =
      /bg-\[color:var\(--fr-(frost|ground)\)\] text-\[color:var\(--fr-ink\)\] py/g;
    for (const [name, html] of Object.entries(PAGES)) {
      const grounds = [...html.matchAll(BAND)].map((m) => m[1]);
      expect(grounds.length, `${name}: pages are built from FrSection bands`)
        .toBeGreaterThan(3);
      for (let i = 1; i < grounds.length; i++) {
        expect(
          `${grounds[i - 1]}→${grounds[i]}`,
          `${name}: bands ${i - 1} and ${i} fuse into one wash`,
        ).not.toBe("frost→frost");
      }
    }
  });

  it("every page mounts at least one real product embed inside .app-scope (Law 2)", () => {
    for (const [name, html] of Object.entries(PAGES)) {
      if (name === "canada") continue; // canada's hero object is marketing-voice
      expect(html, name).toContain("app-scope");
    }
    // Canada still embeds the consent record component.
    expect(PAGES.canada).toContain("app-scope");
  });
});

describe("factual claims survive the v4 restage (Law 7)", () => {
  it("shared-inbox: seats, allowances, and the first-month arithmetic", () => {
    const html = PAGES["shared-inbox"];
    expect(html).toContain("$29");
    expect(html).toContain("$79");
    // #96/#121: fair-use posture, never a pinned per-plan message count, and
    // the policy where the concrete numbers live is linked. Storage is free,
    // never an "included storage" pool that implies a cap.
    expect(html).toContain("fair-use basis");
    expect(html).toContain('href="/legal/fair-use"');
    expect(html).not.toContain("2,500");
    expect(html).not.toContain("included storage");
    expect(html).toContain("storage is free");
    expect(html).toMatch(/up to 3 people/);
    expect(html).toMatch(/up to 15 people/);
    expect(html).toMatch(/first month is \$58/);
    expect(html).toMatch(/receiving texts is\s+always free and unlimited/i);
    // #134/D42: calling is included on every plan — the $8 add-on is gone.
    expect(html).toContain("Calling is included on every plan");
    expect(html).not.toMatch(/\$8\/mo/);
    expect(html).not.toContain("Calling add-on");
  });

  it("business-number: free porting, the port window, the sole-prop cap, the US wait", () => {
    const html = PAGES["business-number"];
    expect(html).toMatch(/Porting is free/i);
    expect(html).toMatch(/a few days to two weeks/);
    expect(html).toMatch(/often faster in Canada/);
    expect(html).toMatch(/3 to 7 business days/);
    expect(html).toMatch(/without an EIN/);
    expect(html).toMatch(/single number regardless of plan/);
    expect(html).toMatch(/first month is \$58/);
  });

  it("compliance: the honest 10DLC countdown, STOP handling, consent record, the careful claim", () => {
    const html = PAGES.compliance;
    expect(html).toMatch(/3 to 7 business days/);
    expect(html).toMatch(/opted out on the spot|opted out instantly/i);
    expect(html).toMatch(/UNSUBSCRIBE, CANCEL, END, and QUIT/);
    expect(html).toMatch(/your name and the date/);
    expect(html).toMatch(/helps you follow/i);
    expect(html).toMatch(/It(&#x27;|')s 9:14/);
    expect(html).toMatch(/8pm and 8am/);
    // The em-dash-free range wording, never "3-7" digits-hyphen.
    expect(html).not.toMatch(/3[-–—]7 business days/);
  });

  it("templates-and-tags: never auto-send, real merge variables, the done-mark scope", () => {
    const html = PAGES["templates-and-tags"];
    expect(html).toMatch(/never sends on its own/);
    expect(html).toMatch(/\{first_name\}/);
    expect(html).toMatch(/Quote sent/);
    expect(html).toMatch(/not a task list|not a job, a task, or a to-do list/i);
    expect(html).toMatch(/first month is \$58/);
  });

  it("canada: day-one texting, USD billing, US data residency, the later-US path", () => {
    const html = PAGES.canada;
    expect(html).toMatch(/text customers today/i);
    expect(html).toMatch(/USD/);
    expect(html).toMatch(/stored (and processed )?in the United States/i);
    expect(html).toMatch(/one-time \$29/);
    expect(html).toMatch(/3 to 7\s*business day/);
    expect(html).toMatch(/helps you follow/i);
  });

  it("canada: the province ledger is generated from the app's NANP table", () => {
    const html = PAGES.canada;
    for (const province of [
      "British Columbia",
      "Alberta",
      "Ontario",
      "Quebec",
      "Prince Edward Island",
      "Newfoundland and Labrador",
    ]) {
      expect(html).toContain(province);
    }
    // Spot-check codes that must exist in the shared table.
    for (const code of ["604", "403", "416", "514", "902", "867"]) {
      expect(html).toContain(code);
    }
  });
});

describe("country branching: a Canadian sees only the Canada story (owner ruling v1)", () => {
  it("CA copy carries no em-dashes or en-dash ranges (Law 6)", () => {
    for (const [name, html] of Object.entries(CA_PAGES)) {
      expect(html, name).not.toContain("—");
      expect(html, name).not.toMatch(/\d–\d/);
    }
  });

  it("bands still alternate in CA mode (Law 10): no two adjacent Frost bands", () => {
    const BAND =
      /bg-\[color:var\(--fr-(frost|ground)\)\] text-\[color:var\(--fr-ink\)\] py/g;
    for (const [name, html] of Object.entries(CA_PAGES)) {
      const grounds = [...html.matchAll(BAND)].map((m) => m[1]);
      expect(grounds.length, `${name}: still built from FrSection bands`)
        .toBeGreaterThan(3);
      for (let i = 1; i < grounds.length; i++) {
        expect(
          `${grounds[i - 1]}→${grounds[i]}`,
          `${name}: bands ${i - 1} and ${i} fuse into one wash`,
        ).not.toBe("frost→frost");
      }
    }
  });

  it("business-number (CA): same-day, no-fee, no-registration facts, no US wait/fee/EIN", () => {
    const html = CA_PAGES["business-number"];
    // The Canada story is present.
    expect(html).toMatch(/the same day it goes active/);
    expect(html).toMatch(/No registration, no fee, and no approval wait/);
    expect(html).toMatch(/no registration and no one-time/);
    expect(html).toMatch(/text Canadian customers the same day/);
    // Shared, country-neutral facts still hold.
    expect(html).toMatch(/Porting is free/i);
    expect(html).toMatch(/often faster in Canada/);
    // The US-only wait, fee, and 10DLC sole-prop cap never reach a Canadian.
    expect(html).not.toMatch(/3 to 7 business days/);
    expect(html).not.toContain("first month is $58");
    expect(html).not.toContain("one-time $29");
    expect(html).not.toMatch(/without an EIN/);
    expect(html).not.toMatch(/single number regardless of plan/);
  });

  it("compliance (CA): no-registration + CASL framing, and zero US registration copy", () => {
    const html = CA_PAGES.compliance;
    // The Canada story is present.
    expect(html).toMatch(/no carrier registration to text Canadian customers/);
    expect(html).toMatch(/needs no carrier registration/);
    expect(html).toContain("CASL");
    expect(html).toMatch(/the same day your number is active/);
    expect(html).toMatch(/Do I need to register to text customers in Canada/);
    expect(html).toMatch(/Let us handle the compliance details/);
    // No US wait, fee, or carrier-registration obligation, in copy OR the embed.
    expect(html).not.toMatch(/3 to 7 business days/);
    expect(html).not.toContain("first month is $58");
    expect(html).not.toContain("one-time $29");
    expect(html).not.toContain("carrier approval");
    expect(html).not.toContain("carrier paperwork"); // the closing-CTA leak, now branched
    expect(html).not.toContain("Registration filed for you"); // the closing-CTA leak
    expect(html).not.toContain("US texting registration"); // the registration-stepper embed
    expect(html).not.toContain("Business registered with the phone companies");
  });

  it("US branch carries none of the CA-only no-registration carve-outs", () => {
    const bn = PAGES["business-number"];
    expect(bn).not.toContain("the same day it goes active");
    expect(bn).not.toContain("No registration, no fee, and no approval wait");
    const comp = PAGES.compliance;
    expect(comp).not.toContain("No registration for Canada");
    expect(comp).not.toContain(
      "no carrier registration to text Canadian customers",
    );
    expect(comp).not.toContain("Let us handle the compliance details");
  });
});

describe("product embeds keep APP tokens (Law 2)", () => {
  for (const [name, html] of Object.entries(EMBEDS)) {
    it(`${name}: no marketing tokens inside the product surface`, () => {
      expect(html).not.toContain("--fr-cobalt");
      expect(html).not.toContain("--fr-ink");
      expect(html).not.toContain("--fr-frost");
      expect(html).not.toContain("--petrol"); // dead v3 alias (cobalt now)
      expect(html).not.toContain("—");
    });
  }

  it("the embeds draw with the app's own utility tokens", () => {
    expect(EMBEDS.inbox).toMatch(/bg-primary/); // the unread petrol dot
    expect(EMBEDS.inbox).toMatch(/app-tint/); // avatar + assign highlight
    expect(EMBEDS.stepper).toMatch(/bg-primary/); // the done node
    expect(EMBEDS.stepper).toContain("3 to 7 business days");
    expect(EMBEDS.optOut).toContain(
      "This customer opted out of texting. Sends are blocked.",
    );
    expect(EMBEDS.quietHours).toMatch(/9:14 PM/);
    expect(EMBEDS.savedReplies).toContain("{first_name}");
    expect(EMBEDS.tagsDone).toContain("Done · Priya · 2:14 PM");
    expect(EMBEDS.numbers).toContain("(416) 555-0119");
  });
});

describe("the FEATURE-template blocks", () => {
  it("TruthStrip: cobalt left edge on the Frost wash, green tick only when good", () => {
    const html = renderToStaticMarkup(
      <TruthStrip
        items={[
          { text: "Receiving texts: free, unlimited.", good: true },
          { text: "Prices in USD, plus sales tax where it applies." },
        ]}
      />,
    );
    expect(html).toContain("border-l-[3px]");
    expect(html).toContain("--fr-cobalt");
    expect(html).toContain("--fr-frost");
    expect((html.match(/--fr-green/g) ?? []).length).toBe(1);
    expect(html).toContain("fr-mono-data");
  });

  it("UseCaseSteps: mono numerals in cobalt circles (§5.5)", () => {
    const html = renderToStaticMarkup(
      <UseCaseSteps
        heading="Three jobs."
        steps={[
          { title: "One", body: "First." },
          { title: "Two", body: "Second." },
          { title: "Three", body: "Third." },
        ]}
      />,
    );
    expect(html).toContain("fr-mono-data");
    expect((html.match(/rounded-full bg-\[color:var\(--fr-cobalt\)\]/g) ?? []).length).toBe(3);
  });

  it("PricingSnippet: price as art plus the deck's guarantee microcopy", () => {
    const html = renderToStaticMarkup(
      <PricingSnippet>
        <p>Starter is $29/mo.</p>
      </PricingSnippet>,
    );
    expect(html).toContain("fr-figure");
    expect(html).toContain("$29");
    expect(html).toContain(
      "30-day money-back guarantee. Full refund, including the registration fee. No fine print.",
    );
    expect(html).toContain("Get your number");
    expect(html).toContain("See pricing");
  });

  it("FeatureCta: the subpage close is the Frost band, never cobalt (Law 3)", () => {
    const html = renderToStaticMarkup(
      <FeatureCta heading="Close." sub="One promise, one button." />,
    );
    expect(html).toContain("--fr-frost");
    expect(html).not.toMatch(/bg-\[color:var\(--fr-cobalt\)\] text-white"?[^>]*<h2/);
    expect(html).toContain("$29/MO FLAT · MONTH TO MONTH · 30-DAY MONEY-BACK");
  });
});

describe("v4 frame chrome", () => {
  it("BrowserFrame: clean white card, NO faux-browser chrome or URL (#84), no hairline borders (Law 10)", () => {
    const html = renderToStaticMarkup(
      <BrowserFrame>
        <div>content</div>
      </BrowserFrame>,
    );
    expect(html).toContain("content");
    expect(html).toContain("--fr-card");
    // #84: the three-dot "Mac shell" + mono URL chip are gone.
    expect(html).not.toContain("loonext.com");
    expect(html).not.toContain("fr-mono-data");
    expect(html).not.toContain("--fr-frost");
    expect(html).not.toMatch(/border-b|border-\[color:var\(--hairline\)\]/);
  });

  it("PhoneFrame: Dispatch Ink bezel; the push banner mark is the double-o brand tile (#206)", () => {
    const html = renderToStaticMarkup(
      <PhoneFrame pushBanner={{ title: "Loonext", body: "New text from Karen M" }}>
        <div>screen</div>
      </PhoneFrame>,
    );
    expect(html).toContain("--fr-ink");
    expect(html).toContain("New text from Karen M");
    // The app's own icon inside the frame is the paper tile with the two
    // rings (ink + olive) — the OLD petrol loon tile is gone for good.
    expect(html).toContain("#FDFDF9"); // paper tile
    expect(html).toContain("#66801F"); // the olive second ring
    expect(html).not.toContain("#0F766E");
    expect(html).not.toContain("--fr-cobalt");
  });
});

describe("metadata (Law 6 + owner rule 12: canonical domain https://loonext.com)", () => {
  const METAS = {
    "shared-inbox": [sharedInboxMetadata, "/features/shared-inbox"],
    "business-number": [businessNumberMetadata, "/features/business-number"],
    compliance: [complianceMetadata, "/features/compliance"],
    "templates-and-tags": [templatesMetadata, "/features/templates-and-tags"],
    canada: [canadaMetadata, "/canada"],
  } as const;

  for (const [name, [meta, path]] of Object.entries(METAS)) {
    it(`${name}: canonical resolves to loonext.com, strings are dash-free`, () => {
      expect(meta.alternates?.canonical).toBe(`https://loonext.com${path}`);
      const strings = [
        String(meta.title ?? ""),
        String(meta.description ?? ""),
      ].join(" ");
      expect(strings).not.toContain("—");
      expect(strings).not.toMatch(/\d–\d/);
      expect(strings).not.toContain("loonext.app");
    });
  }
});
