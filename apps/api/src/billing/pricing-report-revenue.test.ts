import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MODULE_CATALOG } from "./modules";
import {
  FIXED_MONTHLY_COST_CENTS,
  PLAN_MONTHLY_REVENUE_CENTS,
  stripeNetCents,
} from "./costs";

/**
 * #277 — the margin report must value a PAUSED workspace at what it is actually
 * paying.
 *
 * # The defect this file exists to keep fixed
 *
 * A paid pause is a licensed-price swap on the same subscription: the workspace
 * stays `active`, keeps `companies.plan`, and is invoiced a holding fee of a
 * few dollars instead of $29 or $79. Its number and its 10DLC campaign cost us
 * exactly what they did before.
 *
 * `pricing-report.mjs` priced every row from its plan id, so the paused cohort —
 * ~90% less revenue, unchanged cost, near-zero usage — rendered as the most
 * profitable rows in the one report the founder reads to find the least
 * profitable ones. Nothing about that reading looks wrong on the page, which is
 * what makes it expensive.
 *
 * This codebase has now fixed the same class of defect five times: grandfathered
 * modules, phantom extra numbers, the prepaid year, the #85 overage projection,
 * and this. Each was revenue INFERRED from a plan id instead of read from what
 * is being invoiced.
 *
 * # Why the script is evaluated rather than imported
 *
 * `pricing-report.mjs` ends in a top-level `await runScript(...)`, so importing
 * it runs the CLI — which exits the process when the ops credentials are absent.
 * The same reason `flags-roster.test.ts` and `pricing-report-mirror.test.ts`
 * read the source instead.
 *
 * So the module BODY is evaluated with the CLI invocation cut off, and the real
 * functions are exercised against real rows. Every failure mode of the cut is
 * loud: a missed `import` line leaves `runScript` undefined, a missed trailing
 * call leaves a top-level `await` that will not parse, and a renamed function
 * comes back `undefined` from the returned scope.
 */
const REPORT = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "scripts",
    "ops",
    "pricing-report.mjs",
  ),
  "utf8",
);

interface ReportScope {
  revenueCents(row: Record<string, unknown>): number;
  isPaused(row: Record<string, unknown>): boolean;
  assertSnapshotShape(rows: Record<string, unknown>[]): void;
  fixedMonthlyCostCents(row: Record<string, unknown>): number;
  costCents(row: Record<string, unknown>): number;
}

function reportScope(): ReportScope {
  const body = REPORT
    // The one import, of the CLI runner the evaluated body must not reach.
    .replace(/^import[^\n]*\n/m, "")
    // Everything from the CLI invocation to EOF.
    .replace(/\nawait runScript\([\s\S]*$/, "\n")
    // `export` is a syntax error inside a Function body.
    .replace(/^export /gm, "");
  const scope = new Function(
    `${body}\nreturn { revenueCents, isPaused, assertSnapshotShape, ` +
      "fixedMonthlyCostCents, costCents };",
  )() as ReportScope;
  for (const name of [
    "revenueCents",
    "isPaused",
    "assertSnapshotShape",
    "fixedMonthlyCostCents",
    "costCents",
  ] as const) {
    expect(
      typeof scope[name],
      `pricing-report.mjs no longer declares ${name} — this guard protects the ` +
        "pause valuation and must be updated, not deleted.",
    ).toBe("function");
  }
  return scope;
}

/**
 * Run the whole report — the `runScript` callback included — against given rows
 * and return everything it printed.
 *
 * The arithmetic tests above evaluate the module body with the CLI invocation
 * cut off. That leaves the report's ACTUAL BODY untested, and the body is where
 * the worst defect in this file lived: it destructured supabase-js's
 * `{ data, error }` off `opsClient().rpc`, which resolves with a plain array. So
 * both came back undefined, `rows` was always empty, and the founder's pricing
 * report printed "No paying workspaces yet" against a database full of them —
 * silently, for its entire life, because nothing ever threw.
 *
 * `runScript` is injected rather than stubbed by module mocking, since the
 * script is evaluated rather than imported. `console` is injected the same way,
 * so the assertions are made against what a human would have seen.
 */
async function runReport(
  rows: Record<string, unknown>[],
  { movements = [], args = {} }: { movements?: unknown[]; args?: Record<string, unknown> } = {},
): Promise<string> {
  const body = REPORT.replace(/^import[^\n]*\n/m, "").replace(/^export /gm, "");
  const printed: string[] = [];
  const runScript = async (
    _name: string,
    run: (ctx: Record<string, unknown>) => Promise<void>,
  ) => {
    await run({
      args,
      apply: false,
      script: "pricing-report",
      db: {
        rpc: async (fn: string) =>
          fn === "api_pricing_snapshot" ? rows : movements,
      },
    });
  };
  await new Function(
    "runScript",
    "console",
    `return (async () => {\n${body}\n})();`,
  )(runScript, { log: (...parts: unknown[]) => printed.push(parts.join(" ")) });
  return printed.join("\n");
}

/** A full `api_pricing_snapshot` row, unpaused, as PostgREST answers it. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    company_id: "00000000-0000-4000-8000-000000000001",
    name: "Acme",
    plan: "pro",
    subscription_status: "active",
    modules: [],
    prepaid_cents: 0,
    prepaid_months: 0,
    // Present-and-null is what PostgREST answers for an unpaused workspace, and
    // what every row must look like for the branch below to be exercised at all.
    paused_at: null,
    paused_price_cents: null,
    // #525: the COST-side fact. Present-and-false is what PostgREST answers for
    // a Canada-only workspace, and every row must carry it or
    // `assertSnapshotShape` refuses the whole report.
    us_texting_enabled: false,
    segments_used: 0,
    seats_used: 1,
    numbers_used: 1,
    provider_cost_cents: 0,
    ...overrides,
  };
}

const PAUSED_FEE_CENTS = 500;

describe("#277 the margin report values a paused workspace at its holding fee", () => {
  const report = reportScope();

  it("prices a paused workspace at the pause fee, not at its plan", () => {
    const paused = row({
      paused_at: "2026-11-04T00:00:00.000Z",
      paused_price_cents: PAUSED_FEE_CENTS,
    });
    expect(report.revenueCents(paused)).toBe(PAUSED_FEE_CENTS);
    // Stated against the real constant rather than a literal: the failure is
    // "valued at the plan price", whatever the plan price happens to be.
    expect(
      report.revenueCents(paused),
      "a paused workspace is being credited with its plan's list price — the " +
        "cohort with ~90% less revenue and unchanged cost then reads as the " +
        "most profitable in the report.",
    ).not.toBe(PLAN_MONTHLY_REVENUE_CENTS.pro);
  });

  it("still counts the add-ons, because a pause does not touch them", () => {
    // The swap replaces the PLAN's licensed item and nothing else on the
    // subscription, so module lines keep invoicing at full price. Dropping them
    // would understate revenue in the other direction.
    const paused = row({
      paused_at: "2026-11-04T00:00:00.000Z",
      paused_price_cents: PAUSED_FEE_CENTS,
      modules: ["regions_ca"],
    });
    expect(report.revenueCents(paused)).toBe(
      PAUSED_FEE_CENTS + MODULE_CATALOG.regions_ca.monthlyCents,
    );
  });

  it("counts a paused workspace with no mirrored fee as zero, never as its plan", () => {
    // The pause fee is provisioned in Stripe and is nowhere in this repository,
    // so a missing one cannot be looked up. Zero is the conservative direction:
    // it makes somebody look at the row. The plan price is the direction that
    // hides it.
    const paused = row({ paused_at: "2026-11-04T00:00:00.000Z" });
    expect(report.revenueCents(paused)).toBe(0);
  });

  it("leaves an unpaused workspace on its plan, and a prepaid year amortised", () => {
    // The guard has to be able to tell the two branches apart, or it would pass
    // just as happily against a function that returned the fee for everybody.
    expect(report.revenueCents(row())).toBe(PLAN_MONTHLY_REVENUE_CENTS.pro);
    expect(
      report.revenueCents(row({ prepaid_cents: 79000, prepaid_months: 12 })),
    ).toBe(Math.round(79000 / 12));
  });

  it("treats a row with NO pause field as unpaused, not as free", () => {
    // The safe direction if a caller's select ever drops the column: the old
    // wrong answer (list price) rather than a book-wide revenue of zero. The
    // loud answer lives in assertSnapshotShape, which runs first.
    const legacy: Record<string, unknown> = {
      plan: "pro",
      modules: [],
      prepaid_cents: 0,
      prepaid_months: 0,
    };
    expect(report.isPaused(legacy)).toBe(false);
    expect(report.revenueCents(legacy)).toBe(PLAN_MONTHLY_REVENUE_CENTS.pro);
  });

  it("actually reports the rows the snapshot returns", async () => {
    // The regression guard for the `{ data, error }` destructure: the ops
    // client resolves WITH the rows, so reading a supabase-js envelope off them
    // yielded undefined and this report told the founder there were no paying
    // workspaces at all. It never threw, so nothing else would have caught it.
    const printed = await runReport(
      [
        row({ name: "Acme" }),
        row({ company_id: "00000000-0000-4000-8000-000000000002", name: "Winter Crew" }),
      ],
      // The per-workspace table, so a row that never arrived cannot hide behind
      // an aggregate that happens to read plausibly.
      { args: { workspaces: true } },
    );
    expect(printed).not.toMatch(/No paying workspaces yet/);
    expect(printed).toContain("2 paying workspace(s)");
    expect(printed).toContain("Acme");
    expect(printed).toContain("Winter Crew");
  });

  it("names the paused cohort in the margin block, and keeps it in the totals", async () => {
    // Paused workspaces belong in the margin — they really are paying and their
    // number and campaign really do cost us — so the reader has to be told they
    // are in there, and told which rows they are.
    const printed = await runReport([
      row({ name: "Acme" }),
      row({
        company_id: "00000000-0000-4000-8000-000000000002",
        name: "Winter Crew",
        paused_at: "2026-11-04T00:00:00.000Z",
        paused_price_cents: PAUSED_FEE_CENTS,
      }),
    ]);
    expect(printed).toMatch(/paused\s+1 of 2 \(Winter Crew\)/);
    // Pro + a $5 hold, after Stripe's cut — NOT two Pro subscriptions.
    const bothAtListPrice = PLAN_MONTHLY_REVENUE_CENTS.pro * 2;
    expect(printed).toContain(
      `gross revenue      $${((PLAN_MONTHLY_REVENUE_CENTS.pro + PAUSED_FEE_CENTS) / 100).toFixed(2)}`,
    );
    expect(printed).not.toContain(`$${(bothAtListPrice / 100).toFixed(2)}`);
  });

  it("says so when a paused workspace had no fee to read", async () => {
    const printed = await runReport([
      row({
        name: "Winter Crew",
        paused_at: "2026-11-04T00:00:00.000Z",
      }),
    ]);
    expect(printed).toContain("with no mirrored pause fee, counted as $0");
  });

  it("keeps the paused cohort out of the limit distribution", async () => {
    // A paused workspace sits at ~0% of every limit by construction. Counted
    // in, it reads as "paying for headroom they never touch" — evidence for a
    // cheaper tier, from somebody who has already bought the cheaper thing.
    const printed = await runReport([
      ...Array.from({ length: 5 }, (_, i) =>
        row({ company_id: `00000000-0000-4000-8000-00000000000${i}`, name: `Live ${i}` }),
      ),
      row({
        company_id: "00000000-0000-4000-8000-000000000009",
        name: "Winter Crew",
        paused_at: "2026-11-04T00:00:00.000Z",
        paused_price_cents: PAUSED_FEE_CENTS,
      }),
    ]);
    // The DENOMINATOR is the assertion: six workspaces, five in the
    // distribution. Counting the paused one would read "of 6" on all three.
    expect(printed).toContain("6 paying workspace(s)");
    expect(printed).toMatch(/at 90%\+ of a limit\s+\d+ of 5/);
    expect(printed).toMatch(/comfortably inside\s+\d+ of 5/);
    expect(printed).toMatch(/under 20%\s+\d+ of 5/);
    expect(printed).toContain("1 paused workspace(s) excluded");
  });

  it("refuses to report at all against a snapshot with no pause columns", () => {
    // Pointed at a database the migration has not reached, every row reads as
    // unpaused and the paused cohort is valued at list price again — the whole
    // defect, restored silently. A report that stops is recoverable; one that
    // quietly prints the old wrong number is what gets acted on.
    expect(() =>
      report.assertSnapshotShape([{ plan: "pro", modules: [] }]),
    ).toThrow(/paused_at/);
    expect(() => report.assertSnapshotShape([row()])).not.toThrow();
    expect(() => report.assertSnapshotShape([])).not.toThrow();
  });

  /**
   * A workspace that PAUSED and then CANCELLED keeps `paused_at` on its row —
   * deliberately: the daily reconcile skips cancelled tenants and
   * `claim_checkout_activation` clears the fact only if they come back (see
   * 20260805080000_resubscribe_clears_pause.sql). The snapshot admits cancelled
   * rows on purpose, so that stale fact reaches this report.
   *
   * Left unhandled it produced two lies from one row: the churned workspace was
   * NAMED in the paused cohort line, so the founder was told they had a paused
   * customer they do not have; and it was priced at a holding fee it stopped
   * paying months ago. The cancelled cohort's own valuation was already wrong in
   * the other direction — every churned tenant counted at its plan's LIST price,
   * for as long as this report has existed — which is why the fix is "invoiced
   * nothing means zero" rather than a special case for the pause.
   */
  it("CH-1: a cancelled workspace is not a paused customer, whatever the row still says", () => {
    const churnedWhilePaused = row({
      subscription_status: "canceled",
      paused_at: "2026-03-01T00:00:00Z",
      paused_price_cents: PAUSED_FEE_CENTS,
    });
    expect(report.isPaused(churnedWhilePaused)).toBe(false);
    // And still paused while it is genuinely live on the pause price.
    expect(
      report.isPaused(
        row({ paused_at: "2026-03-01T00:00:00Z", paused_price_cents: PAUSED_FEE_CENTS }),
      ),
    ).toBe(true);
  });

  it("CH-2: a cancelled workspace is invoiced nothing, so it counts as nothing", () => {
    // Not the plan's list price (what it did before), and not the stale pause
    // fee either — the churned-while-paused row must not slip through on the
    // pause branch.
    expect(report.revenueCents(row({ subscription_status: "canceled" }))).toBe(0);
    expect(
      report.revenueCents(
        row({
          subscription_status: "canceled",
          paused_at: "2026-03-01T00:00:00Z",
          paused_price_cents: PAUSED_FEE_CENTS,
        }),
      ),
    ).toBe(0);
    // Add-ons go with it: a cancelled subscription bills no module lines.
    expect(
      report.revenueCents(row({ subscription_status: "canceled", modules: ["regions_ca"] })),
    ).toBe(0);
    // A live workspace is untouched by any of this.
    expect(report.revenueCents(row())).toBe(PLAN_MONTHLY_REVENUE_CENTS.pro);
  });

  it("CH-3: names the cancelled cohort, and keeps it out of the usage distribution", async () => {
    const printed = await runReport([
      row({ company_id: "a", name: "Live One" }),
      row({ company_id: "b", name: "Live Two" }),
      row({ company_id: "c", name: "Live Three" }),
      row({ company_id: "d", name: "Live Four" }),
      row({ company_id: "e", name: "Live Five" }),
      row({
        company_id: "f",
        name: "Gone Fishing",
        subscription_status: "canceled",
        paused_at: "2026-03-01T00:00:00Z",
        paused_price_cents: PAUSED_FEE_CENTS,
      }),
    ]);
    // Named as cancelled, and NOT as paused — the founder is not told they have
    // a paused customer who has actually left.
    expect(printed).toContain("Gone Fishing");
    expect(printed).toMatch(/cancelled\s+1 of 6/);
    expect(printed).not.toMatch(/paused\s+\d+ of 6/);
    // Counted at zero, so the five live Pro workspaces are the whole revenue.
    expect(printed).toContain(
      `gross revenue      $${((PLAN_MONTHLY_REVENUE_CENTS.pro * 5) / 100).toFixed(2)}`,
    );
    // Excluded from the tier signal: a workspace that left sits at 0% by
    // construction and would read as evidence the limits are too generous.
    expect(printed).toMatch(/under 20%\s+\d+ of 5/);
    expect(printed).toContain("1 cancelled workspace(s) excluded");
  });
});

/**
 * #525 — the COST side of the same row.
 *
 * # The defect this file now also keeps fixed
 *
 * #277 made this report value a paused workspace at the holding fee it actually
 * pays. It left the other half saying zero: cost was `provider_cost_cents`, the
 * METERED per-message spend, and a paused workspace sends nothing. So the
 * cohort came back into the report at ~$5 of revenue against ~$0 of cost —
 * still the healthiest-looking margin in the book, arriving from the opposite
 * direction.
 *
 * The real cost was never metered. `FIXED_MONTHLY_COST_CENTS` has held it since
 * #85: the held number's rent and the recurring US 10DLC campaign fee, charged
 * whether or not a single text goes out. The in-app underwater alert adds them
 * (`overage-projection.ts` fixedMonthlyCostCents); this report did not, so two
 * views of one cost model disagreed and the founder read the wrong one.
 *
 * That matters most for a paused workspace because those two lines are its
 * ENTIRE cost, and because the pause fee is chosen by hand in a Stripe
 * dashboard — against a number this report is the only place to see.
 *
 * `enable-us` is deliberately open during a pause (#525: the carrier wait is
 * free in a quiet winter and the $29 is charged once per workspace ever), so a
 * pause can acquire a campaign mid-hold. Allowed, disclosed on the screen, and
 * accounted for here.
 */
describe("#525 the margin report can see the fixed cost it is paying", () => {
  const report = reportScope();
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  it("PC525-1: prices the campaign only for a workspace that has one", () => {
    // Stated against the real constants, so the failure is "the campaign fee is
    // missing" rather than "12.20 is not 1.10", whatever the fees become.
    expect(report.fixedMonthlyCostCents(row({ us_texting_enabled: true }))).toBe(
      FIXED_MONTHLY_COST_CENTS.perNumber + FIXED_MONTHLY_COST_CENTS.us10dlcCampaign,
    );
    // The guard has to be able to tell the branches apart, or it would pass
    // just as happily against a function charging every Canada-only workspace
    // $10/mo it does not owe — which fails in the other direction and mislabels
    // them unprofitable.
    expect(report.fixedMonthlyCostCents(row())).toBe(
      FIXED_MONTHLY_COST_CENTS.perNumber,
    );
    // Rent scales with the numbers we actually hold.
    expect(report.fixedMonthlyCostCents(row({ numbers_used: 3 }))).toBe(
      3 * FIXED_MONTHLY_COST_CENTS.perNumber,
    );
  });

  it("PC525-2: total cost is metered PLUS fixed, never metered alone", () => {
    const metered = 250;
    const paused = row({
      paused_at: "2026-11-04T00:00:00.000Z",
      paused_price_cents: PAUSED_FEE_CENTS,
      us_texting_enabled: true,
      provider_cost_cents: metered,
    });
    expect(report.costCents(paused)).toBe(
      metered + FIXED_MONTHLY_COST_CENTS.perNumber +
        FIXED_MONTHLY_COST_CENTS.us10dlcCampaign,
    );
    // The old answer, named. A paused workspace's metered cost is ~$0 by
    // construction, so this reading made its margin look like pure profit.
    expect(
      report.costCents(paused),
      "cost is being read from provider_cost_cents alone — the held number and " +
        "the live 10DLC campaign are a paused workspace's entire cost, and " +
        "they are missing from every margin in this report.",
    ).not.toBe(metered);
  });

  it("PC525-3: a paused workspace carrying a campaign reads as unprofitable", async () => {
    // The end-to-end statement, and the one that would have caught the defect:
    // the holding fee is real money and so is the $11.10 we spend to hold the
    // number and the campaign, and the report has to be able to say which is
    // bigger.
    const printed = await runReport([
      row({ name: "Acme" }),
      row({
        company_id: "00000000-0000-4000-8000-000000000002",
        name: "Winter Crew",
        paused_at: "2026-11-04T00:00:00.000Z",
        paused_price_cents: PAUSED_FEE_CENTS,
        us_texting_enabled: true,
      }),
    ]);
    expect(
      printed,
      "the paused workspace is being reported as profitable: it pays a ~$5 " +
        "holding fee and we pay for its number and its live 10DLC campaign.",
    ).toMatch(/unprofitable\s+1 of 2 \(Winter Crew\)/);
    // And the fixed total is on the page as its own line, from the mirrored
    // constants: two numbers rented, one campaign carried.
    expect(printed).toContain(
      `numbers + 10DLC    ${money(
        2 * FIXED_MONTHLY_COST_CENTS.perNumber +
          FIXED_MONTHLY_COST_CENTS.us10dlcCampaign,
      )}`,
    );
  });

  it("PC525-4: says what the paused cohort costs, beside what it collects", () => {
    // The pause price is provisioned in a Stripe dashboard and is nowhere in
    // this repository, so this is the only place the two figures meet. Printed
    // side by side with NO verdict: #255's rule is that this report says what
    // IS, because a price change on a base this small is unmeasurable before it
    // is unfair.
    return runReport([
      row({ name: "Acme" }),
      row({
        company_id: "00000000-0000-4000-8000-000000000002",
        name: "Winter Crew",
        paused_at: "2026-11-04T00:00:00.000Z",
        paused_price_cents: PAUSED_FEE_CENTS,
        us_texting_enabled: true,
      }),
    ]).then((printed) => {
      expect(printed).toContain(
        `holding 1 number-set(s) and 1 live 10DLC campaign(s): ${money(
          FIXED_MONTHLY_COST_CENTS.perNumber +
            FIXED_MONTHLY_COST_CENTS.us10dlcCampaign,
        )}/mo of ours`,
      );
      expect(printed).toContain(
        `against ${money(stripeNetCents(PAUSED_FEE_CENTS))} of holding fees after Stripe`,
      );
    });
  });

  it("PC525-5: refuses to report at all against a snapshot with no US column", () => {
    // Pointed at a database the migration has not reached, the campaign fee
    // silently drops out of every cost figure and the paused cohort is the
    // highest-margin row in the book again — the whole defect, restored without
    // a word on the page.
    const { us_texting_enabled: _dropped, ...legacy } = row();
    expect(() => report.assertSnapshotShape([legacy])).toThrow(
      /us_texting_enabled/,
    );
    expect(() => report.assertSnapshotShape([row()])).not.toThrow();
  });
});
