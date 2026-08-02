import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/font/local needs the Next build plugin; in vitest we only need the
// stable variable/class contract (AppSurface mounts --font-golos).
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "font-golos-mock", className: "font-golos-mock" }),
}));

import {
  formatMoney,
  PLAN_PRICE_CENTS,
  US_REGISTRATION_FEE_CENTS,
  type BillingCurrency,
} from "@loonext/shared";

import {
  PLAN_MODULE_CARDS,
  PLAN_PRICING,
  US_REGISTRATION_FEE_DOLLARS,
} from "@/lib/api/types";

/**
 * #328 — the expected figures, read from the same book the page reads.
 *
 * Deliberately NOT typed here. A test that spells out "$29" is a second copy of
 * the price with a stricter enforcement mechanism than the first, and the repo
 * has already been bitten by that shape: a guard pinning a literal becomes a
 * CEILING, so the day the figure legitimately changes the test fails and the
 * correction looks like the regression.
 *
 * What is worth pinning is the RELATIONSHIP: that each surface shows its own
 * country's money, that the first month is the sum of its two parts, and that
 * the Canada surfaces never quote a US figure.
 */
const planPrice = (plan: "starter" | "pro", currency: BillingCurrency) =>
  formatMoney(PLAN_PRICE_CENTS[currency][plan], currency);
const registrationFee = (currency: BillingCurrency) =>
  formatMoney(US_REGISTRATION_FEE_CENTS[currency], currency);
const firstMonth = (plan: "starter" | "pro", currency: BillingCurrency) =>
  formatMoney(
    PLAN_PRICE_CENTS[currency][plan] + US_REGISTRATION_FEE_CENTS[currency],
    currency,
  );

import PricingPage from "./page";

import { COMPARE_AS_OF } from "../compare/verification";

import {
  ELSEWHERE_COLUMNS,
  ELSEWHERE_FOOTNOTE,
  ELSEWHERE_ROWS,
  FAQS,
  LEDGER,
  LEDGER_CA,
  PLAN_FAIR_USE_NOTE,
  PLANS,
  PRICING_DATELINE,
  PRICING_DATELINE_CA,
} from "./pricing-data";

/** Every customer-facing string this module exports, flattened. */
function allStrings(): string[] {
  const out: string[] = [
    PRICING_DATELINE,
    PRICING_DATELINE_CA,
    ELSEWHERE_FOOTNOTE,
    PLAN_FAIR_USE_NOTE,
  ];
  for (const plan of PLANS) {
    out.push(plan.name, plan.price, plan.tagline, plan.cta, ...plan.features);
    if (plan.badge) out.push(plan.badge);
  }
  for (const entry of [...LEDGER, ...LEDGER_CA]) {
    out.push(entry.term, entry.detail);
    if (entry.figure) out.push(entry.figure);
  }
  for (const col of ELSEWHERE_COLUMNS) {
    out.push(col.label);
    if (col.sub) out.push(col.sub);
  }
  for (const row of ELSEWHERE_ROWS) {
    out.push(row.label);
    for (const cell of row.cells) {
      out.push(typeof cell === "string" ? cell : cell.value);
      if (typeof cell !== "string" && cell.note) out.push(cell.note);
    }
  }
  for (const faq of FAQS) out.push(faq.q, faq.a);
  return out;
}

describe("/pricing rendered strings (Law 6)", () => {
  it("contain no em-dashes and no en-dash ranges", () => {
    for (const s of allStrings()) {
      expect(s, s).not.toMatch(/[—–]/);
    }
  });

  it("never describe the site as an artifact (Law 1 purge sweep)", () => {
    for (const s of allStrings()) {
      expect(s.toLowerCase(), s).not.toMatch(
        /real interface|not a screenshot|stock photo|fake review|built with next|set in /,
      );
    }
  });

  it("frames the plan allowances as a fair-use line, not a hard wall (#85)", () => {
    expect(PLAN_FAIR_USE_NOTE.toLowerCase()).toContain("fair use");
    expect(PLAN_FAIR_USE_NOTE.toLowerCase()).toContain("not a hard wall");
    // #121: storage is free, never an "allowance".
    expect(PLAN_FAIR_USE_NOTE.toLowerCase()).not.toContain("storage allowance");
    expect(PLAN_FAIR_USE_NOTE).toContain("Storage is free");
  });

  /**
   * #121 sweep: no hard-limit numbers anywhere in marketing copy. Allowance
   * figures, per-text overage prices, the three-texts-per-picture rule,
   * storage GB figures, and the extra-storage add-on live ONLY on
   * /legal/fair-use. The one sanctioned exception is the "priced elsewhere"
   * table (ELSEWHERE_*): its 500 is an explicitly labelled workload scenario
   * and its ¢ figures are competitors' published prices.
   */
  it("carries no allowance figures, per-text rates, GB figures, or extra-storage copy outside the workload table (#121)", () => {
    const elsewhere = new Set<string>([ELSEWHERE_FOOTNOTE]);
    for (const row of ELSEWHERE_ROWS) {
      elsewhere.add(row.label);
      for (const cell of row.cells) {
        elsewhere.add(typeof cell === "string" ? cell : cell.value);
        if (typeof cell !== "string" && cell.note) elsewhere.add(cell.note);
      }
    }
    for (const s of allStrings()) {
      if (elsewhere.has(s)) continue;
      // D36: 6,000 (the Pro voice allowance) joins the banned figures — every
      // concrete allowance lives only on /legal/fair-use.
      expect(s, s).not.toMatch(/\b500\b|\b2,500\b|\b6,000\b/);
      expect(s, s).not.toMatch(/\d(\.\d+)?¢/);
      expect(s, s).not.toMatch(/\bGB\b/);
      expect(s.toLowerCase(), s).not.toContain("three texts");
      expect(s.toLowerCase(), s).not.toContain("extra storage");
      expect(s.toLowerCase(), s).not.toContain("included storage");
      expect(s.toLowerCase(), s).not.toMatch(/\bminutes a month\b/);
    }
    // And the workload table frames its 500 as a scenario, not an allowance.
    const workload = ELSEWHERE_ROWS.find((r) => r.label.includes("500"));
    expect(workload?.label).toBe("500 texts a month, the workload");
  });
});

describe("/pricing figures trace to the shared constants (QA gate 8)", () => {
  it("dateline states the first-month-then-monthly US arithmetic from the price book", () => {
    expect(PRICING_DATELINE).toBe(
      `${firstMonth("starter", "usd")} FIRST MONTH (US) · ${planPrice("starter", "usd")} AFTER`,
    );
    // The first-month figure is the SUM of its parts, which is the assertion
    // worth having: both halves can be right while the total is stale.
    expect(PRICING_DATELINE).toContain(
      `$${PLAN_PRICING.starter.monthlyDollars + US_REGISTRATION_FEE_DOLLARS}`,
    );
  });

  it("plan cards carry the mirror's prices and seats, and use plain de-emphasized bullets that point to fair use", () => {
    const starter = PLANS.find((p) => p.id === "starter");
    const pro = PLANS.find((p) => p.id === "pro");
    expect(starter?.price).toBe(`$${PLAN_PRICING.starter.monthlyDollars}`);
    expect(pro?.price).toBe(`$${PLAN_PRICING.pro.monthlyDollars}`);
    expect(starter?.features.join(" ")).toContain(
      `${PLAN_PRICING.starter.seats} teammates`,
    );
    expect(pro?.features.join(" ")).toContain(
      `${PLAN_PRICING.pro.seats} teammates`,
    );
    // #121 (founder): plain "send and receive" bullets, no "unlimited" emphasis,
    // and an asterisk that points to the fair-use footnote (PLAN_FAIR_USE_NOTE).
    for (const plan of PLANS) {
      const joined = plan.features.join(" ");
      expect(joined).toContain("Send and receive texts and pictures*");
      expect(joined.toLowerCase()).not.toContain("unlimited");
      // No allowance count, per-text ¢ figure, or billing jargon on the cards.
      expect(joined).not.toMatch(/\d(\.\d+)?¢/);
      expect(joined).not.toMatch(/\b500\b|\b2,500\b/);
      for (const f of plan.features) {
        expect(f.toLowerCase()).not.toContain("segment");
      }
    }
    // The overage + cap mechanics move to the asterisk footnote, not the cards.
    expect(PLAN_FAIR_USE_NOTE.startsWith("*")).toBe(true);
    expect(PLAN_FAIR_USE_NOTE).toContain("spending cap you control");
    expect(PLAN_FAIR_USE_NOTE).not.toMatch(/\d(\.\d+)?¢/);
  });

  it("the ledger names every cost: plans, one-time fee, overage, storage, add-ons, tax, and closes the list", () => {
    const terms = LEDGER.map((e) => e.term);
    expect(terms).toContain("Your plan");
    expect(terms).toContain("Register with the phone companies");
    expect(terms).toContain("Extra texts");
    expect(terms).toContain("Storage");
    expect(terms).toContain("Optional add-ons, if you turn them on");
    expect(terms).toContain("Tax");
    expect(terms).toContain("That's the whole list.");

    const registration = LEDGER.find(
      (e) => e.term === "Register with the phone companies",
    );
    expect(registration?.figure).toBe(
      `${registrationFee("usd")}, one time, ever`,
    );
    expect(registration?.detail).toContain(
      `${firstMonth("starter", "usd")} your first month`,
    );
    expect(registration?.detail).toContain("you won't pay it again");

    // #121: the overage row is the fair-use + cap story with no ¢ figure;
    // the concrete rates live only on /legal/fair-use.
    const overage = LEDGER.find((e) => e.term === "Extra texts");
    expect(overage?.figure).toBe("Capped by you");
    expect(overage?.detail).toContain("fair-use policy");
    expect(overage?.detail).toContain("80% and 100%");
    expect(overage?.detail).toContain("fair use policy");
    expect(overage?.detail).not.toMatch(/\d(\.\d+)?¢/);
    expect(overage?.detail).not.toContain("three texts");

    // #121: storage is free, stated as its own $0 row.
    const storage = LEDGER.find((e) => e.term === "Storage");
    expect(storage?.figure).toBe("$0, no caps");
    expect(storage?.detail).toContain("stored free");
    expect(storage?.detail).toContain("nothing pauses");
    expect(storage?.detail).not.toMatch(/\bGB\b/);

    // The add-ons figure and prose agree with the module catalog mirror.
    // #97/#103: no Picture-messages card. #121: no Extra-storage card.
    // #134/D42: no Calling card — calling is included on every plan, and the
    // one add-on left is Canada numbers.
    const addons = LEDGER.find(
      (e) => e.term === "Optional add-ons, if you turn them on",
    );
    const byId = (id: string) =>
      PLAN_MODULE_CARDS.find((c) => c.id === id)!;
    expect(addons?.figure).toBe(`${byId("regions_ca").price}/mo`);
    expect(addons?.detail).not.toContain("Picture messages");
    expect(addons?.detail).not.toContain("extra storage");
    expect(addons?.detail).toContain(`${byId("regions_ca").price}/mo`);
    expect(addons?.detail).toContain("One add-on exists");
    expect(addons?.detail).toContain("Canada numbers");
    // #134: the row leads with the included-calling truth and never sells
    // Calling as an add-on again.
    expect(addons?.detail).toContain("Calling is included in every plan");
    expect(addons?.detail).not.toContain("Calling,");
    // The minute figures live on /legal/fair-use, not sales copy (#121/D36).
    expect(addons?.detail).not.toContain("300 minutes");
    expect(addons?.detail).toContain("fair use policy");
    // Honest availability: Canada numbers can't be switched on yet.
    expect(addons?.detail).toContain("isn't switchable on quite yet");

    // The whole-list row counts one add-on and no storage fees.
    const whole = LEDGER.find((e) => e.term === "That's the whole list.");
    expect(whole?.detail).toContain("one optional add-on");
    expect(whole?.detail).toContain("no storage fees");

    // #328: the tax row names the currency the US reader is charged in. The
    // assertion it replaced required the phrase "CAD billing isn't here yet",
    // which was true when it was written and became false the day CAD billing
    // shipped. A guard pinning a retired fact does not catch drift, it BLOCKS
    // the correction, so it is replaced rather than deleted: what is worth
    // enforcing is that the row still names a currency at all.
    const tax = LEDGER.find((e) => e.term === "Tax");
    expect(tax?.detail).toContain("US dollars");
    expect(tax?.detail).not.toContain("CAD billing isn't here yet");
  });

  it("prices the whole US ledger in USD (#328)", () => {
    const plan = LEDGER.find((e) => e.term === "Your plan");
    expect(plan?.figure).toBe(
      `${planPrice("starter", "usd")} or ${planPrice("pro", "usd")}/mo`,
    );
    // And never leaks a Canadian figure into the US branch.
    for (const entry of LEDGER) {
      const row = `${entry.term} ${entry.figure ?? ""} ${entry.detail}`;
      expect(row, entry.term).not.toContain(planPrice("starter", "cad"));
      expect(row, entry.term).not.toContain(planPrice("pro", "cad"));
    }
  });

  it('the "priced elsewhere" table keeps the dated July 2026 math and the sourced footnote', () => {
    const total = ELSEWHERE_ROWS.find((r) => r.total);
    expect(total?.cells[0]).toBe(`$${PLAN_PRICING.starter.monthlyDollars}`);
    expect(total?.cells[1]).toBe("~$172");
    expect(total?.cells[2]).toBe("~$64 + extra numbers at $5 ea.");
    expect(
      // #403: derived, so it cannot outlive the verification it describes.
      ELSEWHERE_COLUMNS.filter((c) => c.sub === COMPARE_AS_OF),
    ).toHaveLength(2);
    expect(ELSEWHERE_FOOTNOTE).toContain("July 2026");
    expect(COMPARE_AS_OF).toContain("2026");
    expect(ELSEWHERE_FOOTNOTE).toContain("$19.50");
    expect(ELSEWHERE_FOOTNOTE).toContain("tell us and we'll fix it");
  });
});

describe("/pricing country split (owner ruling v1: no mixing, no US fee shown to Canada)", () => {
  it("the US dateline keeps the first-month arithmetic; the Canada dateline is the flat CANADIAN monthly price with no registration fee", () => {
    expect(PRICING_DATELINE).toBe(
      `${firstMonth("starter", "usd")} FIRST MONTH (US) · ${planPrice("starter", "usd")} AFTER`,
    );
    // #328: the chip a Canadian reader actually sees. This is the largest
    // figure on the page for them, and it used to be the US one.
    expect(PRICING_DATELINE_CA).toBe(
      `${planPrice("starter", "cad")}/MO · NO REGISTRATION FEE`,
    );
    expect(PRICING_DATELINE_CA).not.toContain(planPrice("starter", "usd"));
    // The Canada dateline never surfaces the US-only first-month figure.
    expect(PRICING_DATELINE_CA).not.toContain(
      `$${PLAN_PRICING.starter.monthlyDollars + US_REGISTRATION_FEE_DOLLARS}`,
    );
  });

  it("the Canada ledger drops the US registration row and never shows the US fee or first-month figure", () => {
    const terms = LEDGER_CA.map((e) => e.term);
    expect(terms).not.toContain("Register with the phone companies");
    expect(terms).toContain("No registration, no setup fee");
    // Still names every cost that actually applies to a Canadian business.
    expect(terms).toContain("Your plan");
    expect(terms).toContain("Extra texts");
    expect(terms).toContain("Storage");
    expect(terms).toContain("Optional add-ons, if you turn them on");
    expect(terms).toContain("Tax");
    expect(terms).toContain("That's the whole list.");

    const registration = LEDGER_CA.find(
      (e) => e.term === "No registration, no setup fee",
    );
    expect(registration?.detail).toContain("registers nothing");
    expect(registration?.detail).toContain("same day");

    // No US fee ($29) or US first-month figure ($58) anywhere in the CA ledger.
    for (const entry of LEDGER_CA) {
      expect(entry.detail).not.toContain(
        `$${US_REGISTRATION_FEE_DOLLARS} your first month`,
      );
      expect(entry.detail).not.toContain(
        `$${PLAN_PRICING.starter.monthlyDollars + US_REGISTRATION_FEE_DOLLARS} your first month`,
      );
    }
    // The closing line drops "one registration fee" and states there is none.
    const whole = LEDGER_CA.find((e) => e.term === "That's the whole list.");
    expect(whole?.detail).toContain("No registration fee");
  });

  /**
   * #328 narrowed this. It used to require FIVE rows to be byte-for-byte equal
   * across the two ledgers, which encoded "the price is the same in both
   * countries" as a structural invariant. That was true and is now false, and a
   * test asserting it would have made the correct change look like a break.
   *
   * The rows that carry no money still have to match exactly, because a
   * divergence there IS a drift: nobody should be rewriting the storage
   * sentence for one country. The rows that carry money are asserted below
   * instead, on the property that actually matters.
   */
  it("the Canada ledger keeps the money-free rows byte-for-byte identical to the US ledger", () => {
    for (const term of [
      "Extra texts",
      "Storage",
      "Optional add-ons, if you turn them on",
    ]) {
      expect(LEDGER_CA.find((e) => e.term === term)).toEqual(
        LEDGER.find((e) => e.term === term),
      );
    }
  });

  it("prices the Canada ledger in Canadian dollars, and never in US ones (#328)", () => {
    const plan = LEDGER_CA.find((e) => e.term === "Your plan");
    expect(plan?.figure).toBe(
      `${planPrice("starter", "cad")} or ${planPrice("pro", "cad")}/mo`,
    );
    // The whole point: no US plan figure survives anywhere in the CA branch.
    for (const entry of LEDGER_CA) {
      const row = `${entry.term} ${entry.figure ?? ""} ${entry.detail}`;
      expect(row, entry.term).not.toContain(planPrice("starter", "usd"));
      expect(row, entry.term).not.toContain(planPrice("pro", "usd"));
    }
    // And the tax row says which money, rather than apologising for USD.
    const tax = LEDGER_CA.find((e) => e.term === "Tax");
    expect(tax?.detail).toContain("Canadian dollars");
    expect(tax?.detail).not.toContain("CAD billing isn't here yet");
  });
});

describe("/pricing FAQ (all nine, facts intact)", () => {
  it("keeps all nine questions", () => {
    expect(FAQS).toHaveLength(9);
  });

  it("keeps the no-trial answer with the 30-day guarantee", () => {
    const trial = FAQS.find((f) => f.q === "Is there a free trial?");
    expect(trial?.a).toContain("30-day full money-back guarantee");
  });

  it("keeps the keep-my-number porting story", () => {
    const port = FAQS.find(
      (f) => f.q === "Can I keep my current business number?",
    );
    expect(port?.a).toContain("Bring my number");
    expect(port?.a).toContain("1 to 7 business days");
    expect(port?.a).toContain("free");
  });

  it("keeps the included-pictures truth (#97/#103/#121: included, storage free, mechanics on /legal/fair-use)", () => {
    const photos = FAQS.find((f) => f.q === "How do photo messages work?");
    expect(photos?.a).toContain("both ways on every plan");
    expect(photos?.a).toContain("storage is free");
    expect(photos?.a).toContain("fair use policy");
    // #121: the three-texts metering detail lives only on /legal/fair-use.
    expect(photos?.a).not.toContain("three texts");
    expect(photos?.a).not.toContain("included storage");
    // Retired terms must be gone: no $5 add-on, no 150 cap, no cap-and-drop.
    expect(photos?.a).not.toContain("$5");
    expect(photos?.a).not.toContain("150");
    expect(photos?.a).not.toContain("dropped");
  });

  it("the over-usage answer keeps the alerts + cap story with no rates or multiplier (#121)", () => {
    const over = FAQS.find(
      (f) => f.q === "What happens if we send more than usual?",
    );
    expect(over?.a).toContain("80% and again at 100%");
    expect(over?.a).toContain("spending cap you control");
    expect(over?.a).toContain("fair use policy");
    expect(over?.a).not.toMatch(/\d(\.\d+)?¢/);
    expect(over?.a).not.toContain("3×");
  });

  it("carries the included-calling facts in the what-am-I-not-getting answer (#134/D42)", () => {
    const not = FAQS.find(
      (f) => f.q === "What am I not getting at these prices?",
    );
    // #134/D42: the $8 Calling module retired — calling is included on every
    // plan, both directions, and the answer must say so instead of selling
    // an add-on that no longer exists.
    expect(not?.a).toContain("Calling is included on every plan");
    // #491/D43: cell forwarding is DELETED. This assertion used to require the
    // phrase "forward to your cell", which pinned a claim the product had
    // stopped honouring — a guard asserting a false fact is worse than no
    // guard, because it makes the CORRECTION look like the regression. The app
    // settings have carried `expect(html).not.toContain("forward")` since D43;
    // the marketing half of that deletion was never done.
    expect(not?.a).not.toContain("forward");
    expect(not?.a).toContain("ring the whole crew");
    expect(not?.a).toContain("call customers back");
    expect(not?.a).toContain("text back");
    expect(not?.a).toContain("fair use");
    expect(not?.a).not.toContain("add-on");
    expect(not?.a).not.toContain("$8");
    expect(not?.a).not.toContain("no calling inside the app");
    // D36-D43: the browser softphone IS the product. The old answer disclaimed
    // "no softphone" in the same breath as describing one.
    expect(not?.a).not.toContain("no softphone");
  });

  it("#134/D42: no string anywhere on /pricing sells calling for $8 or as an add-on", () => {
    for (const s of allStrings()) {
      expect(s, s).not.toMatch(/\$8\b/);
      expect(s.toLowerCase(), s).not.toContain("calling add-on");
      expect(s.toLowerCase(), s).not.toContain("calling module");
    }
  });

  it("keeps the once-ever registration-fee promise, without a figure in the question", () => {
    const fee = FAQS.find(
      (f) => f.q === "Will I ever pay the registration fee twice?",
    );
    expect(fee?.a).toContain("once per company, ever");
  });

  /**
   * #328 — the FAQ is the one block on this page that is NOT country-branched:
   * both readers get the same nine answers. So no figure may appear in it,
   * because any figure here is wrong for half the audience. The amounts live in
   * the honesty ledger a few sections up, which IS branched.
   */
  it("carries no plan or fee figure anywhere, because it is read by both countries", () => {
    for (const faq of FAQS) {
      const text = `${faq.q} ${faq.a}`;
      for (const currency of ["usd", "cad"] as const) {
        expect(text, faq.q).not.toContain(planPrice("starter", currency));
        expect(text, faq.q).not.toContain(planPrice("pro", currency));
        expect(text, faq.q).not.toContain(registrationFee(currency));
      }
    }
  });

  it("answers the currency question with what we now actually do (#328)", () => {
    const currency = FAQS.find((f) => f.q === "What currency am I billed in?");
    expect(currency?.a).toContain("Canadian dollars");
    expect(currency?.a).toContain("US dollars");
    // The retired promise. "CAD billing is coming" shipped, so a page still
    // saying it is coming is the page contradicting the invoice.
    for (const faq of FAQS) {
      expect(faq.a, faq.q).not.toContain("CAD billing is coming");
    }
  });
});

describe("/pricing rendered page (#121)", () => {
  const html = renderToStaticMarkup(createElement(PricingPage));

  it("links the fair-use policy, where the concrete numbers live", () => {
    expect(html).toContain('href="/legal/fair-use"');
  });

  it("never sells extra storage or states GB caps / allowance counts / picture metering", () => {
    expect(html).not.toContain("Extra storage");
    expect(html).not.toContain("extra storage");
    expect(html).not.toMatch(/\bGB\b/);
    expect(html).not.toContain("2,500");
    expect(html).not.toContain("counts as three texts");
    expect(html).not.toContain("included storage");
  });
});

/**
 * #425 — the exit, stated where the objection fires.
 *
 * The dominant player in this category is well liked (4.6/5 on G2 across 2,066
 * reviews) and holds a **D-** from the BBB, with the complaints concentrated on
 * billing after an attempted cancellation and not being able to reach anybody.
 * So the exit is the axis nobody in this market defends, and it is one a $29
 * product can take at almost no cost.
 *
 * These assertions exist because the claims are only worth making while they
 * are TRUE. Each maps to a shipped behaviour — self-serve cancellation (#421),
 * an in-app route to a human (#382), and the honest account of what happens to
 * the number (#413) — and if one of those regresses, the page becomes the kind
 * of promise this issue exists to avoid making.
 */
describe("/pricing states what leaving looks like (#425)", () => {
  const html = renderToStaticMarkup(createElement(PricingPage));

  it("says you cancel yourself, which is the whole differentiator", () => {
    expect(html).toContain("Cancel yourself, from billing settings");
    expect(html).toContain("No phone call, no");
    expect(html).toContain("retention chat");
  });

  it("promises no charge after cancellation, the literal complaint against the leader", () => {
    expect(html).toContain("Nothing is charged after that");
  });

  it("is HONEST about the number rather than comforting", () => {
    // #413: "cannot be recovered" is not the same as "someone else will have
    // it", and the second is the true one. A page that markets an easy exit
    // while soft-pedalling the irreversible part would be exactly the
    // overclaim #425 ask 4 warns against — and D48's standard applies: a
    // feature that claims total erasure is lying.
    expect(html).toContain("given to");
    expect(html).toContain("another business");
    expect(html).toContain("reach someone else");
    expect(html).toContain("Port it out first");
    // The comforting half-truth must not come back.
    expect(html).not.toContain("can't be recovered");
    expect(html).not.toContain("cannot be recovered");
  });

  it("says a person is reachable on the way out", () => {
    expect(html).toContain("reachable from inside the app");
  });

  it("keeps the exit secondary to the offer", () => {
    // Reassurance, not a section of its own: somebody deciding to START should
    // not meet a heading about leaving. If this ever becomes an <h2> it has
    // been promoted past what it should carry on this page.
    expect(html).toContain(">And if you leave later</h3>");
  });

  it("links the full cancellation terms rather than summarising them alone", () => {
    expect(html).toContain('href="/legal/terms"');
  });
});
