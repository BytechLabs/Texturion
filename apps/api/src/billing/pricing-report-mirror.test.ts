import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MODULE_CATALOG, PLAN_MODULES } from "./modules";
import { PLAN_INCLUDED_SEGMENTS, PLAN_IDS, PLAN_LIMITS } from "./plans";
import { PLAN_MONTHLY_REVENUE_CENTS, STRIPE_FEES } from "./costs";

/**
 * #255 — `scripts/ops/pricing-report.mjs` mirrors this package's price and
 * limit tables. This is what stops the mirror from becoming a lie.
 *
 * # Why the report does not just import them
 *
 * It tried. The Worker's modules use extensionless relative imports, which
 * Node's ESM loader cannot resolve, and adding `.ts` extensions across
 * `apps/api` to suit one ops script would be the tail wagging the dog.
 *
 * So it is a mirror, and this is the guard — the same answer the Kotlin and
 * Swift ports use, and the same one `store-declarations.test.ts` uses for the
 * app-store files. An UNGUARDED duplicate is the problem; a guarded one is a
 * translation.
 *
 * # It earned itself on the first run
 *
 * The first draft of the mirror had Pro's included segments at 2000 (they are
 * 2500) and the CA module at $9 (it is $5). Both were plausible, neither would
 * have thrown, and both would have quietly misstated margin on the one report a
 * pricing decision is supposed to rest on.
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

/**
 * Pull the mirrored literal out of the script by executing just that object.
 *
 * Parsed rather than imported for the same reason the script cannot import
 * this package: crossing the boundary at runtime is what does not work. A
 * regex over the source is honest about being a text check.
 */
function mirrored(): Record<string, unknown> {
  const match = /export const MIRRORED = (\{[\s\S]*?\n\});/.exec(REPORT);
  if (!match) throw new Error("pricing-report.mjs has no MIRRORED block");
  return new Function(`return ${match[1]}`)() as Record<string, unknown>;
}

describe("#255 the pricing report mirrors this package exactly", () => {
  const m = mirrored();

  it("finds the block at all, so a rename cannot make this vacuous", () => {
    // A guard that silently matches nothing reports success forever.
    expect(Object.keys(m).length).toBeGreaterThanOrEqual(5);
  });

  it("mirrors the plan monthly price", () => {
    expect(m.planMonthlyCents).toEqual(PLAN_MONTHLY_REVENUE_CENTS);
  });

  it("mirrors Stripe's cut, which decides whether a workspace looks profitable", () => {
    expect(m.stripeFees).toEqual({
      percent: STRIPE_FEES.percent,
      billingPercent: STRIPE_FEES.billingPercent,
      fixedCents: STRIPE_FEES.fixedCents,
    });
  });

  it("mirrors every module's price, and knows about every module", () => {
    const expected = Object.fromEntries(
      PLAN_MODULES.map((id) => [id, MODULE_CATALOG[id].monthlyCents]),
    );
    // Equality both ways: a NEW module absent from the mirror would be revenue
    // the report silently does not count.
    expect(m.moduleMonthlyCents).toEqual(expected);
  });

  it("mirrors the included segments and the seat and number limits", () => {
    expect(m.includedSegments).toEqual(PLAN_INCLUDED_SEGMENTS);
    expect(m.limits).toEqual(
      Object.fromEntries(
        PLAN_IDS.map((id) => [
          id,
          { seats: PLAN_LIMITS[id].seats, numbers: PLAN_LIMITS[id].numbers },
        ]),
      ),
    );
  });

  it("covers every plan, so a third tier cannot ship unmirrored", () => {
    for (const key of ["planMonthlyCents", "includedSegments", "limits"]) {
      expect(
        Object.keys(m[key] as Record<string, unknown>).sort(),
        `${key} does not cover every plan`,
      ).toEqual([...PLAN_IDS].sort());
    }
  });
});
