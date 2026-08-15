import { describe, expect, it } from "vitest";

import {
  describeModuleToggle,
  formatMonthlyCents,
  planModuleCardFromApi,
} from "./module-billing";

import { EN as WEB_EN, FR_CA as WEB_FR } from "@/i18n/catalog";

/** #228 — the module names keys now, so the tests resolve them. */
function resolver(table: unknown) {
  return (key: string, vars: Record<string, string> = {}): string => {
    const [section, name] = key.split(".");
    const text = (table as Record<string, Record<string, string>>)[section]?.[name];
    if (typeof text !== "string") throw new Error(`no entry for ${key}`);
    return Object.entries(vars).reduce(
      (out, [token, value]) => out.split(`{${token}}`).join(value),
      text,
    );
  };
}

const sayEn = resolver(WEB_EN);
const sayFr = resolver(WEB_FR);

describe("formatMonthlyCents", () => {
  it("drops cents on whole dollars and keeps them otherwise", () => {
    expect(formatMonthlyCents(500)).toBe("$5");
    expect(formatMonthlyCents(600)).toBe("$6");
    expect(formatMonthlyCents(750)).toBe("$7.50");
    expect(formatMonthlyCents(1)).toBe("$0.01");
  });
});

describe("describeModuleToggle (#45 confirmation flow)", () => {
  it("enabling states the monthly price AND the prorated charge landing today", () => {
    const change = describeModuleToggle({
      label: "Picture messages",
      monthlyCents: 500,
      enable: true,
    }, sayEn);
    expect(change.title).toBe("Add Picture messages?");
    expect(change.summary).toContain("$5/month");
    expect(change.summary).toContain("prorated");
    expect(change.summary).toContain("today");
    expect(change.confirmLabel).toBe("Add for $5/mo");
  });

  it("disabling states the immediate turn-off and a CONDITIONAL prorated credit", () => {
    // #134/D42: the fixture is the one real module left, Canada numbers
    // (Calling retired — included on every plan, nothing to toggle).
    const change = describeModuleToggle({
      label: "Canada numbers",
      monthlyCents: 500,
      enable: false,
    }, sayEn);
    expect(change.title).toBe("Turn off Canada numbers?");
    expect(change.summary).toContain("right away");
    expect(change.summary).toContain("not at the end of the period");
    expect(change.summary).toContain("prorated credit");
    expect(change.summary).toContain("$5");
    expect(change.confirmLabel).toBe("Turn off");
  });

  it("never promises a credit unconditionally — grandfathered modules have no Stripe line item and get none", () => {
    // Migrations 20260704160000/20260707140000 seeded legacy companies with
    // free (grandfathered) modules; the API disable path finds no
    // subscription item and makes NO Stripe call, so no credit ever exists.
    // GET /v1/billing/modules doesn't say which cohort a company is in, so
    // the credit sentence must be conditioned on the add-on being billed.
    const change = describeModuleToggle({
      label: "Picture messages",
      monthlyCents: 500,
      enable: false,
    }, sayEn);
    expect(change.summary).toContain("If this add-on is on your bill");
    expect(change.summary).not.toMatch(/The unused part .* comes back/);
  });

  it("never promises a specific dollar amount it cannot know (Stripe computes it)", () => {
    const enable = describeModuleToggle({
      label: "Extra storage",
      monthlyCents: 500,
      enable: true,
    }, sayEn);
    // The only dollar figures are the flat monthly price — the prorated
    // amount is described, not invented.
    const dollarMentions = enable.summary.match(/\$\d+(\.\d+)?/g) ?? [];
    expect(new Set(dollarMentions)).toEqual(new Set(["$5"]));
  });
});

describe("planModuleCardFromApi (#59 single-sourcing)", () => {
  it("projects an API catalog row into the display-card shape", () => {
    // #134/D42: the fixture is the remaining real module, Canada numbers.
    // The catalog detail stays number-free — concrete figures live only at
    // /legal/fair-use (D34).
    expect(
      planModuleCardFromApi({
        id: "regions_ca",
        label: "Canada numbers",
        blurb: "Get and text Canadian numbers alongside your US number.",
        detail: "Canadian local numbers, your area code.",
        monthly_cents: 500,
      }),
    ).toEqual({
      id: "regions_ca",
      label: "Canada numbers",
      blurb: "Get and text Canadian numbers alongside your US number.",
      price: "$5",
      detail: "Canadian local numbers, your area code.",
    });
  });

  it("omits the detail line when the API has none", () => {
    const card = planModuleCardFromApi({
      id: "regions_ca",
      label: "Canada numbers",
      blurb: "Get and text Canadian numbers.",
      detail: null,
      monthly_cents: 500,
    });
    expect(card.detail).toBeUndefined();
    expect("detail" in card).toBe(false);
  });
});

describe("#228 the same add-on toggle, read in French", () => {
  const canada = { label: "Canada numbers", monthlyCents: 500 };

  it("keeps the credit CONDITIONAL, which is the whole point of the sentence", () => {
    // The defect this pins is a false billing promise, not a wording
    // preference. A grandfathered module was seeded with no Stripe line
    // item, so the disable path finds nothing to delete and no credit is
    // ever issued — and the API does not say which cohort a workspace is
    // in. A translation that tidied the "if" away would promise money that
    // never arrives. Both phone catalogues said it flatly until this change.
    const off = describeModuleToggle({ ...canada, enable: false }, sayFr);
    expect(off.summary).toMatch(/^.*\bSi ce module figure sur votre facture\b/s);
    expect(off.summary).toContain("crédit au prorata");
    expect(off.summary).not.toMatch(/\{/);
  });

  it("still says the turn-off is immediate, not at period end", () => {
    const off = describeModuleToggle({ ...canada, enable: false }, sayFr);
    expect(off.summary).toContain("immédiatement");
    expect(off.summary).toContain("non à la fin de la période");
  });

  it("carries the price into every slot that names money", () => {
    const on = describeModuleToggle({ ...canada, enable: true }, sayFr);
    expect(on.summary).toContain("$5");
    expect(on.confirmLabel).toContain("$5");
    expect(on.title).toContain("Canada numbers");
    expect(on.summary).not.toMatch(/\{/);
  });

  it("resolves in both languages, so a missing key fails here", () => {
    for (const say of [sayEn, sayFr]) {
      for (const enable of [true, false]) {
        const change = describeModuleToggle({ ...canada, enable }, say);
        for (const text of [change.title, change.summary, change.confirmLabel]) {
          expect(text).not.toContain("settingsMore.");
          expect(text).not.toMatch(/\{/);
        }
      }
    }
  });
});
