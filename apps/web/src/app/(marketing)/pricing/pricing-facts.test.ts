import { describe, expect, it } from "vitest";

import {
  PLAN_MODULE_CARDS,
  PLAN_PRICING,
  US_REGISTRATION_FEE_DOLLARS,
} from "@/lib/api/types";

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
  });
});

describe("/pricing figures trace to the shared constants (QA gate 8)", () => {
  it("dateline states the $58-then-$29 US arithmetic from the constants", () => {
    expect(PRICING_DATELINE).toBe("$58 FIRST MONTH (US) · $29 AFTER");
    expect(PRICING_DATELINE).toContain(
      `$${PLAN_PRICING.starter.monthlyDollars + US_REGISTRATION_FEE_DOLLARS}`,
    );
  });

  it("plan cards carry the mirror's prices, seats, numbers, texts, and overage", () => {
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
    // #85: the plan card frames texting as fair use, not a hard message count.
    expect(starter?.features.join(" ")).toContain(
      "Texting included, bound by fair use",
    );
    expect(pro?.features.join(" ")).toContain(
      "More texting for a bigger crew, bound by fair use",
    );
    expect(starter?.features.join(" ")).toContain(
      `${PLAN_PRICING.starter.overageCentsPerText}¢ each`,
    );
    expect(pro?.features.join(" ")).toContain(
      `${PLAN_PRICING.pro.overageCentsPerText}¢ each`,
    );
    // Plain "texts", never billing jargon, in a plan line item (#70).
    for (const plan of PLANS) {
      for (const f of plan.features) {
        expect(f.toLowerCase()).not.toContain("segment");
      }
    }
  });

  it("the ledger names every cost: plans, one-time fee, overage, add-ons, tax, and closes the list", () => {
    const terms = LEDGER.map((e) => e.term);
    expect(terms).toContain("Your plan");
    expect(terms).toContain("Register with the phone companies");
    expect(terms).toContain("Extra texts");
    expect(terms).toContain("Optional add-ons, if you turn them on");
    expect(terms).toContain("Tax");
    expect(terms).toContain("That's the whole list.");

    const registration = LEDGER.find(
      (e) => e.term === "Register with the phone companies",
    );
    expect(registration?.figure).toBe(
      `$${US_REGISTRATION_FEE_DOLLARS}, one time, ever`,
    );
    expect(registration?.detail).toContain("$58 your first month");
    expect(registration?.detail).toContain("you won't pay it again");

    const overage = LEDGER.find((e) => e.term === "Extra texts");
    expect(overage?.figure).toBe(
      `${PLAN_PRICING.starter.overageCentsPerText}¢ · ${PLAN_PRICING.pro.overageCentsPerText}¢`,
    );

    // The add-ons figure and prose agree with the module catalog mirror.
    // #97/#103: two add-ons (voice, extra_storage) — no Picture-messages card.
    const addons = LEDGER.find(
      (e) => e.term === "Optional add-ons, if you turn them on",
    );
    const byId = (id: string) =>
      PLAN_MODULE_CARDS.find((c) => c.id === id)!;
    expect(addons?.figure).toBe(
      `${byId("voice").price} · ${byId("extra_storage").price}`,
    );
    expect(addons?.detail).not.toContain("Picture messages");
    expect(addons?.detail).toContain(`${byId("voice").price}/mo`);
    expect(addons?.detail).toContain("300 minutes included");
    expect(addons?.detail).toContain("10 GB");
    // The included-pictures truth moved into the Extra-texts line.
    const overageLine = LEDGER.find((e) => e.term === "Extra texts");
    expect(overageLine?.detail).toContain("counts as three texts");
    expect(overageLine?.detail).toContain("Pictures are included");

    // The CAD honesty stays (deck: "we'd rather tell you now").
    const tax = LEDGER.find((e) => e.term === "Tax");
    expect(tax?.detail).toContain("CAD billing isn't here yet");
  });

  it('the "priced elsewhere" table keeps the dated July 2026 math and the sourced footnote', () => {
    const total = ELSEWHERE_ROWS.find((r) => r.total);
    expect(total?.cells[0]).toBe(`$${PLAN_PRICING.starter.monthlyDollars}`);
    expect(total?.cells[1]).toBe("~$172");
    expect(total?.cells[2]).toBe("~$64 + extra numbers at $5 ea.");
    expect(
      ELSEWHERE_COLUMNS.filter((c) => c.sub === "as of July 2026"),
    ).toHaveLength(2);
    expect(ELSEWHERE_FOOTNOTE).toContain("July 2026");
    expect(ELSEWHERE_FOOTNOTE).toContain("$19.50");
    expect(ELSEWHERE_FOOTNOTE).toContain("tell us and we'll fix it");
  });
});

describe("/pricing country split (owner ruling v1: no mixing, no US fee shown to Canada)", () => {
  it("the US dateline keeps the $58-then-$29 arithmetic; the Canada dateline is the flat monthly price with no registration fee", () => {
    expect(PRICING_DATELINE).toBe("$58 FIRST MONTH (US) · $29 AFTER");
    expect(PRICING_DATELINE_CA).toBe(
      `$${PLAN_PRICING.starter.monthlyDollars}/MO · NO REGISTRATION FEE`,
    );
    // The Canada dateline never surfaces the US-only first-month figure.
    expect(PRICING_DATELINE_CA).not.toContain(
      `$${PLAN_PRICING.starter.monthlyDollars + US_REGISTRATION_FEE_DOLLARS}`,
    );
  });

  it("the Canada ledger drops the US registration row and never shows the $29 fee or $58 first month", () => {
    const terms = LEDGER_CA.map((e) => e.term);
    expect(terms).not.toContain("Register with the phone companies");
    expect(terms).toContain("No registration, no setup fee");
    // Still names every cost that actually applies to a Canadian business.
    expect(terms).toContain("Your plan");
    expect(terms).toContain("Extra texts");
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

  it("the Canada ledger keeps the country-neutral rows byte-for-byte identical to the US ledger", () => {
    for (const term of [
      "Your plan",
      "Extra texts",
      "Optional add-ons, if you turn them on",
      "Tax",
    ]) {
      expect(LEDGER_CA.find((e) => e.term === term)).toEqual(
        LEDGER.find((e) => e.term === term),
      );
    }
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

  it("keeps the included-pictures truth (#97/#103: 3 texts each, no add-on, no cap)", () => {
    const photos = FAQS.find((f) => f.q === "How do photo messages work?");
    expect(photos?.a).toContain("both ways on every plan");
    expect(photos?.a).toContain("three texts");
    // Retired terms must be gone: no $5 add-on, no 150 cap, no cap-and-drop.
    expect(photos?.a).not.toContain("$5");
    expect(photos?.a).not.toContain("150");
    expect(photos?.a).not.toContain("dropped");
  });

  it("keeps the voice add-on facts in the what-am-I-not-getting answer", () => {
    const not = FAQS.find(
      (f) => f.q === "What am I not getting at these prices?",
    );
    expect(not?.a).toContain("call forwarding add-on ($8/mo)");
    expect(not?.a).toContain("texts back the ones you miss");
  });

  it("keeps the once-ever registration-fee promise", () => {
    const fee = FAQS.find(
      (f) => f.q === "Will I ever pay the $29 registration fee twice?",
    );
    expect(fee?.a).toContain("once per company, ever");
  });
});
