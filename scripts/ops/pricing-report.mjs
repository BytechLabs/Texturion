/**
 * [#255] Whether our pricing is right, reported against.
 *
 *   node scripts/ops/pricing-report.mjs
 *   node scripts/ops/pricing-report.mjs --workspaces   # the per-workspace table
 *
 * Read-only, so there is no --apply.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * #255: "for a solo-founder business, pricing is the highest-leverage variable
 * there is — a correct price change is worth more than a quarter of feature
 * work and costs a day. Right now we cannot make one with evidence, so we will
 * make it with taste, and then be unable to tell whether it worked."
 *
 * Every input was already in the database. Revenue is a plan and a module list,
 * cost is metered per company by #216, usage against a limit is a count. What
 * did not exist was a read that put them on one row.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT REFUSES TO DO, WHICH IS MOST OF ITS VALUE
 *
 * The same discipline `retention-report.mjs` applies to a retention rate, for
 * the same reason: the first misleading number drives a bad decision, and a
 * number you are told not to trust still anchors you.
 *
 * So no rate is printed without its denominator, a cohort under five
 * workspaces is marked `(thin)`, and the limit-proximity verdict is WITHHELD
 * entirely below that rather than shown with a caveat somebody reads past.
 *
 * It also prints no recommendation. #255's own devil's advocate warns that
 * instrumentation is not a pricing experiment, and that price tests on a small
 * base are meaningless before they are unfair. The deliverable is VISIBILITY.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE NUMBERS COME FROM
 *
 * Facts from `api_pricing_snapshot()`. Prices and limits are MIRRORED from
 * `apps/api/src/billing` and guarded by a test — see the block below for why
 * importing them does not work, and why an unguarded copy would be the real
 * problem. The guard earned itself immediately: the first draft of the mirror
 * had Pro's included segments and the CA module's price both wrong.
 */
import { runScript } from "./lib.mjs";

/**
 * The server's own numbers, MIRRORED — and guarded.
 *
 * Importing them was the first attempt and it does not work: the Worker's
 * modules use extensionless relative imports, which Node's ESM loader cannot
 * resolve, and adding extensions across `apps/api` to suit one report would be
 * the tail wagging the dog.
 *
 * So this is a mirror, and `scripts/ops/pricing-report.test.ts` fails the build
 * when any value here stops matching `apps/api/src/billing`. That is the same
 * answer this codebase already uses for the Kotlin and Swift ports and for the
 * store declarations: an UNGUARDED duplicate is the problem, a guarded one is a
 * translation.
 */
export const MIRRORED = {
  /** apps/api/src/billing/costs.ts PLAN_MONTHLY_REVENUE_CENTS */
  planMonthlyCents: { starter: 2900, pro: 7900 },
  /** apps/api/src/billing/costs.ts STRIPE_FEES */
  stripeFees: { percent: 0.029, billingPercent: 0.005, fixedCents: 30 },
  /** apps/api/src/billing/modules.ts MODULE_CATALOG monthlyCents */
  moduleMonthlyCents: { regions_ca: 500 },
  /** apps/api/src/billing/plans.ts PLAN_INCLUDED_SEGMENTS */
  includedSegments: { starter: 500, pro: 2500 },
  /** apps/api/src/billing/plans.ts PLAN_LIMITS */
  limits: {
    starter: { seats: 3, numbers: 1 },
    pro: { seats: 15, numbers: 2 },
  },
};

const PLAN_MONTHLY_REVENUE_CENTS = MIRRORED.planMonthlyCents;
const MODULE_CATALOG = MIRRORED.moduleMonthlyCents;
const PLAN_INCLUDED_SEGMENTS = MIRRORED.includedSegments;
const PLAN_LIMITS = MIRRORED.limits;

/** Gross monthly revenue AFTER Stripe's cut, in cents (never below zero). */
export function stripeNetCents(grossCents) {
  const { percent, billingPercent, fixedCents } = MIRRORED.stripeFees;
  return Math.max(0, grossCents * (1 - percent - billingPercent) - fixedCents);
}

/**
 * Below this many workspaces, a proportion is noise wearing a percent sign.
 * Matches the posture `retention-report.mjs` takes for the same reason.
 */
const THIN = 5;

/** At or above this share of a limit, a workspace is "close to the edge". */
const NEAR_LIMIT = 0.9;

/** Below this share, they are paying for headroom they never touch. */
const FAR_UNDER = 0.2;

const money = (cents) =>
  `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

const pad = (text, width) => String(text).padEnd(width);

/**
 * A workspace's monthly revenue in cents.
 *
 * #400/D107: a prepaid year invoices the licensed line at $0, so the plan part
 * is worth what was collected spread over the months it bought, not a list
 * price nobody is paying. Counting the list price would mute the one signal
 * that catches a tenant costing more than it pays, for exactly the cohort that
 * has already paid everything it will ever pay.
 */
function revenueCents(row) {
  const planCents =
    row.prepaid_cents > 0 && row.prepaid_months > 0
      ? Math.round(row.prepaid_cents / row.prepaid_months)
      : PLAN_MONTHLY_REVENUE_CENTS[row.plan];
  const modules = (row.modules ?? []).reduce(
    (sum, id) => sum + (MODULE_CATALOG[id] ?? 0),
    0,
  );
  return planCents + modules;
}

/** How close this workspace sits to the tightest limit it has. */
function proximity(row) {
  const limits = PLAN_LIMITS[row.plan];
  const shares = [
    Number(row.segments_used) / PLAN_INCLUDED_SEGMENTS[row.plan],
    Number(row.seats_used) / limits.seats,
    Number(row.numbers_used) / limits.numbers,
  ].filter((share) => Number.isFinite(share));
  return shares.length === 0 ? 0 : Math.max(...shares);
}

await runScript(
  "pricing-report",
  async ({ db, args }) => {
    const { data, error } = await db.rpc("api_pricing_snapshot");
    if (error) throw new Error(`api_pricing_snapshot failed: ${error.message}`);
    const rows = data ?? [];

    if (rows.length === 0) {
      console.log("\n  No paying workspaces yet. Nothing to report.\n");
      return;
    }

    const priced = rows.map((row) => {
      const gross = revenueCents(row);
      const net = stripeNetCents(gross);
      const cost = Number(row.provider_cost_cents);
      return { row, gross, net, cost, margin: net - cost, near: proximity(row) };
    });

    const thin = priced.length < THIN;
    const label = thin ? " (thin)" : "";

    console.log(`\n  ${priced.length} paying workspace(s)${label}\n`);

    // --- Margin ---------------------------------------------------------
    const grossTotal = priced.reduce((s, p) => s + p.gross, 0);
    const netTotal = priced.reduce((s, p) => s + p.net, 0);
    const costTotal = priced.reduce((s, p) => s + p.cost, 0);
    const losing = priced.filter((p) => p.margin < 0);

    console.log("  Margin, this billing period");
    console.log(`    gross revenue      ${money(grossTotal)}`);
    console.log(`    after Stripe       ${money(netTotal)}`);
    console.log(`    real telecom cost  ${money(costTotal)}`);
    console.log(`    gross margin       ${money(netTotal - costTotal)}`);
    // Never a bare percentage: the count is the thing that makes it readable.
    console.log(
      `    unprofitable       ${losing.length} of ${priced.length}` +
        (losing.length > 0 ? ` (${losing.map((p) => p.row.name).join(", ")})` : ""),
    );

    // --- Limit proximity ------------------------------------------------
    //
    // #255: "how many are at 90%+ of a limit, how many under 20%. That single
    // chart tells us whether the tiers are drawn in the right places."
    console.log("\n  Where workspaces sit against their limits");
    if (thin) {
      // WITHHELD rather than caveated. A distribution over four workspaces
      // describes four workspaces, and reading it as a tier signal is the bad
      // decision this report exists to prevent.
      console.log(
        `    withheld — ${priced.length} workspace(s) is not a distribution.`,
      );
    } else {
      const near = priced.filter((p) => p.near >= NEAR_LIMIT).length;
      const far = priced.filter((p) => p.near < FAR_UNDER).length;
      const middle = priced.length - near - far;
      console.log(`    at 90%+ of a limit   ${near} of ${priced.length}`);
      console.log(`    comfortably inside   ${middle} of ${priced.length}`);
      console.log(`    under 20%            ${far} of ${priced.length}`);
      console.log(
        "    (90%+ is under-served and would likely pay more; under 20% is\n" +
          "     paying for headroom they never touch and reads the invoice one day.)",
      );
    }

    // --- Module attach --------------------------------------------------
    const attach = new Map();
    for (const { row } of priced) {
      for (const id of row.modules ?? []) {
        attach.set(id, (attach.get(id) ?? 0) + 1);
      }
    }
    console.log("\n  Add-ons attached");
    for (const id of Object.keys(MODULE_CATALOG)) {
      console.log(
        `    ${pad(id, 18)} ${attach.get(id) ?? 0} of ${priced.length}`,
      );
    }

    if (args.workspaces === true) {
      console.log("\n  Per workspace");
      console.log(
        `    ${pad("workspace", 26)}${pad("plan", 9)}${pad("net", 10)}` +
          `${pad("cost", 10)}${pad("margin", 10)}limit`,
      );
      for (const p of [...priced].sort((a, b) => a.margin - b.margin)) {
        console.log(
          `    ${pad(p.row.name.slice(0, 24), 26)}${pad(p.row.plan, 9)}` +
            `${pad(money(p.net), 10)}${pad(money(p.cost), 10)}` +
            `${pad(money(p.margin), 10)}${(p.near * 100).toFixed(0)}%`,
        );
      }
    }

    console.log(
      "\n  This reports what IS. It recommends nothing: a price change on a\n" +
        "  small base is unmeasurable before it is unfair, and D109 states the\n" +
        "  cadence and the grandfathering posture for when one is made.\n",
    );
  },
  { readOnly: true },
);
