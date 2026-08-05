import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MODULE_CATALOG } from "./modules";
import { PLAN_MONTHLY_REVENUE_CENTS } from "./costs";

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
    `${body}\nreturn { revenueCents, isPaused, assertSnapshotShape };`,
  )() as ReportScope;
  for (const name of ["revenueCents", "isPaused", "assertSnapshotShape"] as const) {
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
