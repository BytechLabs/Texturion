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
 * So this is a mirror, and `apps/api/src/billing/pricing-report-mirror.test.ts`
 * fails the build when any value here stops matching `apps/api/src/billing`.
 * That is the same answer this codebase already uses for the Kotlin and Swift
 * ports and for the store declarations: an UNGUARDED duplicate is the problem, a
 * guarded one is a translation.
 *
 * The arithmetic and the printed output have a second guard beside it,
 * `pricing-report-revenue.test.ts`, which evaluates this file — CLI invocation
 * and all — against fixture rows. Both live in `apps/api` rather than next to
 * this script because that is where the vitest projects are, and a guard nobody
 * runs is not one.
 */
export const MIRRORED = {
  /** apps/api/src/billing/costs.ts PLAN_MONTHLY_REVENUE_CENTS */
  planMonthlyCents: { starter: 2900, pro: 7900 },
  /** apps/api/src/billing/costs.ts STRIPE_FEES */
  stripeFees: { percent: 0.029, billingPercent: 0.005, fixedCents: 30 },
  /** apps/api/src/billing/costs.ts FIXED_MONTHLY_COST_CENTS */
  fixedMonthlyCents: { perNumber: 110, us10dlcCampaign: 1000 },
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
const FIXED_MONTHLY_COST_CENTS = MIRRORED.fixedMonthlyCents;

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
 * True when this row is a workspace CURRENTLY living on a #277 paid pause.
 *
 * `paused_at` alone is not that question, and the difference is a cohort the
 * founder would otherwise be told they have. A workspace that paused and then
 * CANCELLED keeps its pause fact on the row: nothing clears it, deliberately —
 * the daily reconcile skips cancelled tenants and `claim_checkout_activation`
 * clears it if they ever come back (see
 * 20260805080000_resubscribe_clears_pause.sql). So a churned workspace reads
 * "paused" here, gets named in the paused cohort line, and is priced at the
 * holding fee it stopped paying months ago.
 *
 * Coalesces an absent field to null so a snapshot without the column reads
 * "not paused" rather than throwing — `assertSnapshotShape` is the thing that
 * refuses that database, and it says why.
 */
export function isPaused(row) {
  return (row.paused_at ?? null) !== null && row.subscription_status !== "canceled";
}

/**
 * True when nobody is invoicing this workspace at all.
 *
 * The snapshot admits `canceled` on purpose — churn is part of the picture the
 * founder is reading — but a cancelled subscription collects NOTHING, and
 * `revenueCents` valued one at its plan's list price. A workspace that left in
 * March was still counted as $79 a month of revenue, against real telecom cost
 * we may still be paying while its number sits in the 30-day grace window. That
 * is the same "revenue inferred from a plan id" defect as the pause and the
 * prepaid year, on the one cohort where the right answer is exactly zero.
 */
export function isChurned(row) {
  return row.subscription_status === "canceled";
}

/**
 * Refuse to report against a snapshot that predates the pause columns.
 *
 * The failure this prevents is silent and one-directional: an older
 * `api_pricing_snapshot` returns no `paused_at`, every row then reads as
 * unpaused, and the paused cohort is valued at its plan's list price — which is
 * the entire defect the columns were added for, reappearing the moment the
 * script is pointed at a database a migration has not reached. A report that
 * refuses to run is recoverable; one that quietly reports the old wrong number
 * is what gets acted on.
 */
export function assertSnapshotShape(rows) {
  if (rows.length === 0) return;
  const missing = ["paused_at", "paused_price_cents"].filter(
    (field) => !(field in rows[0]),
  );
  if (missing.length > 0) {
    throw new Error(
      `api_pricing_snapshot() returned no ${missing.join(" or ")} — this ` +
        "database predates 20260805090000_pricing_snapshot_pause.sql. Without " +
        "it every paused workspace is valued at its plan's list price, which " +
        "renders the least profitable cohort as the most profitable. Apply the " +
        "migration and re-run.",
    );
  }
  // #525: the same refusal for the COST side, and the same reasoning. Without
  // this column the campaign fee silently drops out of every margin — hardest
  // on the paused cohort, whose metered usage is ~$0 and whose entire real cost
  // is the fixed lines. A report that stops is recoverable; one that quietly
  // prints a healthy margin over an omitted cost is what gets acted on.
  if (!("us_texting_enabled" in rows[0])) {
    throw new Error(
      "api_pricing_snapshot() returned no us_texting_enabled — this database " +
        "predates 20260805130000_pricing_snapshot_us_texting.sql. Without it " +
        "the recurring 10DLC campaign fee is missing from every cost figure " +
        "below, and a paused workspace (metered cost ~$0, campaign fee " +
        "unchanged) reads as the highest-margin row in the book. Apply the " +
        "migration and re-run.",
    );
  }
}

/**
 * What this workspace costs us every month before anybody sends anything.
 *
 * `provider_cost_cents` is METERED spend — per-message, per-minute — and this
 * report priced margin from it alone. `apps/api/src/billing/costs.ts` has
 * always held a second term: the number rent and the recurring US 10DLC
 * campaign fee arrive whether or not a single text goes out. The in-app
 * underwater alert adds them (`overage-projection.ts` fixedMonthlyCostCents);
 * this did not, so two views of one cost model disagreed and only the one
 * nobody reads was right.
 *
 * It matters most for the cohort #277 put in this report. A PAUSED workspace
 * has stopped texting on purpose, so metered cost is ~$0 and the margin looked
 * clean — while the held number and the live campaign, which are its ENTIRE
 * cost, were invisible. The pause fee is sized against exactly these two lines,
 * so a report that cannot see them cannot say whether the pause is priced right.
 *
 * KEYED ON `us_texting_enabled`, the same fact `fixedMonthlyCostCents` keys on,
 * so the report and the alert cannot answer differently for one workspace. A
 * pause never takes the campaign down (`deactivateCampaign` runs only on
 * cancellation), so the flag reading true through a pause is the truth.
 *
 * ONE PLACE IT OVER-COUNTS, on purpose: a CANCELLED workspace keeps the flag,
 * but grace expiry deletes its campaign at Telnyx. Inside the 30-day window we
 * genuinely still pay the fee; after it we do not, and this reads $10/mo too
 * high. Kept because costs.ts's rule is that a never-lose-money model must not
 * UNDER-count, and because a churned row is already printed at $0 revenue under
 * a line saying any cost on it is churn rather than price — the one reading
 * this cannot mislead is the pricing decision the report exists for.
 */
export function fixedMonthlyCostCents(row) {
  return (
    Number(row.numbers_used ?? 0) * FIXED_MONTHLY_COST_CENTS.perNumber +
    (row.us_texting_enabled === true ? FIXED_MONTHLY_COST_CENTS.us10dlcCampaign : 0)
  );
}

/** Everything this workspace costs us this month: metered + fixed. */
export function costCents(row) {
  return Number(row.provider_cost_cents ?? 0) + fixedMonthlyCostCents(row);
}

/**
 * A workspace's monthly revenue in cents.
 *
 * #400/D107: a prepaid year invoices the licensed line at $0, so the plan part
 * is worth what was collected spread over the months it bought, not a list
 * price nobody is paying. Counting the list price would mute the one signal
 * that catches a tenant costing more than it pays, for exactly the cohort that
 * has already paid everything it will ever pay.
 *
 * #277: a PAUSE is the same trap and a worse one. A paused workspace stays
 * `active` on its plan — that is the mechanism, not an accident — while its
 * licensed line is swapped to a holding fee of a few dollars. Its number and
 * its 10DLC campaign cost us exactly what they did before. Read from the plan
 * id, it is a $79 customer with almost no usage: the most profitable row in the
 * book, in the one report read to find the least profitable ones.
 *
 * THE FEE IS NOT IN THIS REPOSITORY — it is provisioned in Stripe and mirrored
 * onto the row — so when it is missing there is nothing to look up. A paused
 * row with no mirrored fee is counted as ZERO rather than at list price:
 * whatever it is paying, it is certainly not paying for the plan, and the
 * conservative direction is the one that makes somebody look at the row. The
 * caller prints how many were counted that way, because an unexplained zero is
 * its own bad number.
 *
 * The ADD-ONS still count while paused. A pause swaps the plan's licensed item
 * and touches nothing else on the subscription, so the module lines keep
 * invoicing at full price.
 */
export function revenueCents(row) {
  // A CANCELLED workspace is invoiced nothing — not the plan, not its add-ons.
  // First, because it outranks every other reading: a churned row that also
  // carries a stale pause fact must not be counted at the holding fee either.
  if (isChurned(row)) return 0;
  const planCents = isPaused(row)
    ? (row.paused_price_cents ?? 0)
    : row.prepaid_cents > 0 && row.prepaid_months > 0
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
    // `opsClient().rpc` RESOLVES WITH THE ROWS and REJECTS on a bad status —
    // the plain-fetch contract every other ops script uses (`retention-report`,
    // `storage-report`, `version-distribution`). This one destructured the
    // supabase-js `{ data, error }` shape off an ARRAY, so both came back
    // undefined, `rows` was always empty, and the report printed "No paying
    // workspaces yet" against a database full of them — for as long as it has
    // existed. It never threw, which is why nobody caught it: a report that
    // cannot fail is not the same thing as a report that is right.
    const rows = await db.rpc("api_pricing_snapshot");

    if (rows.length === 0) {
      console.log("\n  No paying workspaces yet. Nothing to report.\n");
      return;
    }
    assertSnapshotShape(rows);

    const priced = rows.map((row) => {
      const gross = revenueCents(row);
      const net = stripeNetCents(gross);
      // #525: metered AND fixed. Split as well as summed, because they answer
      // different questions — metered scales with how much they use the
      // product, fixed arrives on an empty month.
      const metered = Number(row.provider_cost_cents);
      const fixed = fixedMonthlyCostCents(row);
      const cost = metered + fixed;
      return {
        row,
        gross,
        net,
        metered,
        fixed,
        cost,
        margin: net - cost,
        near: proximity(row),
        paused: isPaused(row),
        churned: isChurned(row),
      };
    });

    const thin = priced.length < THIN;
    const label = thin ? " (thin)" : "";

    console.log(`\n  ${priced.length} paying workspace(s)${label}\n`);

    // --- Margin ---------------------------------------------------------
    const grossTotal = priced.reduce((s, p) => s + p.gross, 0);
    const netTotal = priced.reduce((s, p) => s + p.net, 0);
    const meteredTotal = priced.reduce((s, p) => s + p.metered, 0);
    const fixedTotal = priced.reduce((s, p) => s + p.fixed, 0);
    const costTotal = priced.reduce((s, p) => s + p.cost, 0);
    const losing = priced.filter((p) => p.margin < 0);

    console.log("  Margin, this billing period");
    console.log(`    gross revenue      ${money(grossTotal)}`);
    console.log(`    after Stripe       ${money(netTotal)}`);
    // #525: the two halves, named. "Real telecom cost" used to mean metered
    // spend alone, which read as the whole answer and was not — the number rent
    // and the 10DLC campaign fee land on a workspace that sent nothing at all.
    console.log(`    metered telecom    ${money(meteredTotal)}`);
    console.log(`    numbers + 10DLC    ${money(fixedTotal)}`);
    console.log(`    total cost         ${money(costTotal)}`);
    console.log(`    gross margin       ${money(netTotal - costTotal)}`);
    // Never a bare percentage: the count is the thing that makes it readable.
    console.log(
      `    unprofitable       ${losing.length} of ${priced.length}` +
        (losing.length > 0 ? ` (${losing.map((p) => p.row.name).join(", ")})` : ""),
    );

    // #277: named, because a paused workspace is the row most likely to be
    // misread. It is `active` on a plan and paying a few dollars, and its
    // number and 10DLC campaign cost what they always did — so it belongs in
    // the margin above, and the reader needs to know it is in there. Printed
    // only when there are any: a "paused 0 of 7" line invites somebody to read
    // a cohort into a report that has none.
    const paused = priced.filter((p) => p.paused);
    if (paused.length > 0) {
      const unpriced = paused.filter((p) => p.row.paused_price_cents == null);
      console.log(
        `    paused             ${paused.length} of ${priced.length}` +
          ` (${paused.map((p) => p.row.name).join(", ")})` +
          // The fee is provisioned in Stripe, not held here, so a missing one
          // cannot be looked up. Counted as $0 rather than at list price, and
          // SAID so — an unexplained zero is its own misleading number.
          (unpriced.length > 0
            ? `\n    ${" ".repeat(19)}${unpriced.length} with no mirrored pause fee, counted as $0`
            : ""),
      );
      // #525: the pause fee is chosen in a Stripe dashboard against a cost
      // nothing in this repository could previously show. These are the two
      // numbers that decide whether it is priced right — what the held numbers
      // and live campaigns cost us, and what the holding fees actually collect
      // after Stripe's cut. Side by side, no verdict: #255's rule is that this
      // report prints what IS, and a price change on a base this small is
      // unmeasurable before it is unfair.
      //
      // Registering for US texting DURING a pause is allowed (#525), so this
      // total can grow mid-pause by one campaign fee. That is the decision
      // working as intended — the customer buys the carrier wait in the month
      // it costs them nothing — and this is the line that stops it being
      // absorbed silently.
      const pausedFixed = paused.reduce((s, p) => s + p.fixed, 0);
      const pausedNet = paused.reduce((s, p) => s + p.net, 0);
      const withCampaign = paused.filter(
        (p) => p.row.us_texting_enabled === true,
      ).length;
      console.log(
        `    ${" ".repeat(19)}holding ${paused.length} number-set(s) and ` +
          `${withCampaign} live 10DLC campaign(s): ${money(pausedFixed)}/mo of ours` +
          `\n    ${" ".repeat(19)}against ${money(pausedNet)} of holding fees after Stripe`,
      );
    }

    // CHURNED, named for the same reason and a sharper one. A cancelled
    // workspace collects nothing and is counted at zero — which puts it in the
    // `unprofitable` line above the moment it costs us a cent, and its number
    // does keep costing us through the 30-day grace window. That is a CHURN
    // fact, not a pricing one, and an unnamed $0 row sitting in a list the
    // founder reads as "customers whose price is wrong" is the misreading this
    // line exists to prevent.
    const churned = priced.filter((p) => p.churned);
    if (churned.length > 0) {
      console.log(
        `    cancelled          ${churned.length} of ${priced.length}` +
          ` (${churned.map((p) => p.row.name).join(", ")})` +
          `\n    ${" ".repeat(19)}counted at $0 — they are invoiced nothing; any` +
          ` cost here is churn, not price`,
      );
    }

    // --- Limit proximity ------------------------------------------------
    //
    // #255: "how many are at 90%+ of a limit, how many under 20%. That single
    // chart tells us whether the tiers are drawn in the right places."
    //
    // #277: PAUSED WORKSPACES ARE EXCLUDED from this one. They are counted in
    // the margin above because they really are paying and really do cost us —
    // but a paused workspace has deliberately stopped using the product, so it
    // lands in "under 20% of its limits" by construction. Left in, it reads as
    // "paying for headroom they never touch", i.e. as evidence for a cheaper
    // tier, when the actual fact is that they already bought the cheaper thing.
    //
    // CANCELLED workspaces are excluded for the same reason, only more so: they
    // have stopped using the product permanently, so they sit at 0% by
    // construction and would read as the strongest possible evidence that the
    // tiers are too generous.
    const usingIt = priced.filter((p) => !p.paused && !p.churned);
    const thinUsage = usingIt.length < THIN;
    console.log("\n  Where workspaces sit against their limits");
    if (thinUsage) {
      // WITHHELD rather than caveated. A distribution over four workspaces
      // describes four workspaces, and reading it as a tier signal is the bad
      // decision this report exists to prevent.
      console.log(
        `    withheld — ${usingIt.length} unpaused workspace(s) is not a distribution.`,
      );
    } else {
      const near = usingIt.filter((p) => p.near >= NEAR_LIMIT).length;
      const far = usingIt.filter((p) => p.near < FAR_UNDER).length;
      const middle = usingIt.length - near - far;
      console.log(`    at 90%+ of a limit   ${near} of ${usingIt.length}`);
      console.log(`    comfortably inside   ${middle} of ${usingIt.length}`);
      console.log(`    under 20%            ${far} of ${usingIt.length}`);
      console.log(
        "    (90%+ is under-served and would likely pay more; under 20% is\n" +
          "     paying for headroom they never touch and reads the invoice one day.)",
      );
    }
    // Named separately so the excluded count is never a number the reader has
    // to decompose: a pause and a cancellation are different facts, and lumping
    // them would hide whichever one is growing.
    const pausedOut = priced.filter((p) => p.paused).length;
    const churnedOut = priced.filter((p) => p.churned).length;
    if (pausedOut > 0) {
      console.log(
        `    ${pausedOut} paused workspace(s) excluded — a pause is not a usage signal.`,
      );
    }
    if (churnedOut > 0) {
      console.log(
        `    ${churnedOut} cancelled workspace(s) excluded — churn is not a usage signal.`,
      );
    }

    // --- Module attach, now ---------------------------------------------
    const attach = new Map();
    for (const { row } of priced) {
      for (const id of row.modules ?? []) {
        attach.set(id, (attach.get(id) ?? 0) + 1);
      }
    }
    console.log("\n  Add-ons attached right now");
    for (const id of Object.keys(MODULE_CATALOG)) {
      console.log(
        `    ${pad(id, 18)} ${attach.get(id) ?? 0} of ${priced.length}`,
      );
    }

    // --- Expansion and contraction ---------------------------------------
    //
    // #255 asks for these as first-class events. They already were: the attach
    // and drop timestamps have been on `company_modules` since it existed, so
    // this is a read rather than new instrumentation, and the history we
    // already have is the more valuable half.
    //
    // Split by WHEN, because a module attached during checkout is a
    // pricing-page decision and one attached weeks later is expansion. A total
    // that mixes them answers neither question.
    // Same contract as the snapshot above: the rows, or a rejection.
    const moved = await db.rpc("api_module_movements", { p_days: 90 });
    console.log("\n  Add-on movement, last 90 days");
    if (moved.length === 0) {
      console.log("    nothing attached or dropped in the window.");
    } else {
      console.log(
        `    ${pad("add-on", 18)}${pad("at signup", 12)}${pad("later", 9)}dropped`,
      );
      for (const m of moved) {
        console.log(
          `    ${pad(m.module, 18)}${pad(m.attached_at_signup, 12)}` +
            `${pad(m.attached_later, 9)}${m.dropped}`,
        );
      }
      console.log(
        "    (at signup is a pricing-page decision; later is expansion, which\n" +
          "     is the one saying the product earned more after it was sold.)",
      );
    }

    if (args.workspaces === true) {
      console.log("\n  Per workspace");
      console.log(
        `    ${pad("workspace", 26)}${pad("plan", 9)}${pad("net", 10)}` +
          `${pad("cost", 10)}${pad("margin", 10)}${pad("limit", 8)}state`,
      );
      for (const p of [...priced].sort((a, b) => a.margin - b.margin)) {
        console.log(
          `    ${pad(p.row.name.slice(0, 24), 26)}${pad(p.row.plan, 9)}` +
            `${pad(money(p.net), 10)}${pad(money(p.cost), 10)}` +
            `${pad(money(p.margin), 10)}${pad(`${(p.near * 100).toFixed(0)}%`, 8)}` +
            // #277: the plan column says `pro` for a paused workspace, because
            // that is the plan it will resume onto. Without this the row reads
            // as a Pro tenant paying $5, which looks like a billing bug. A
            // cancelled row needs the same sentence for the same reason — `pro`
            // at $0 reads as an unpaid invoice rather than as somebody who left.
            (p.churned ? "cancelled" : p.paused ? "paused" : ""),
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
