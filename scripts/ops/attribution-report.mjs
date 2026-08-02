/**
 * [#296 ask 2] Which marketing pages actually produce customers.
 *
 *   node scripts/ops/attribution-report.mjs
 *   node scripts/ops/attribution-report.mjs --days 30
 *   node scripts/ops/attribution-report.mjs --min 5     # lower the ranking floor
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS.
 *
 * Six trade landing pages and three comparison pages were built with no
 * feedback loop: nothing could say whether /compare or /for/plumbers produced a
 * customer. #296 gates per-competitor alternative pages on that answer, so the
 * answer had to exist before the next page gets written.
 *
 * READ-ONLY. It calls one function that only reads. Nothing here writes.
 *
 * WHAT IT REPORTS AND WHAT IT REFUSES TO.
 *
 * Signups are the cheap number and activations are the honest one — a page
 * producing signups who never send a message has produced support load, not
 * customers. Activation is D12's definition (they sent, and somebody answered),
 * taken from the same SQL the activation-stall alert judges on.
 *
 * Rows below the cohort floor are printed but NOT ranked, and carry no rate.
 * At our base size a page with three signups and two activations reads as "our
 * best page at 67%" and would move real money on four data points. #327 is the
 * standing lesson: a number that cannot support a decision should not be
 * formatted like one that can.
 */
import { runScript } from "./lib.mjs";

function pct(rate) {
  return rate === null || rate === undefined
    ? "   —"
    : `${(Number(rate) * 100).toFixed(0).padStart(3)}%`;
}

function day(value) {
  return value ? String(value).slice(0, 10) : "—";
}

await runScript(
  "attribution-report",
  async ({ args, db }) => {
    const requested = Number(args.days ?? 90);
    const days = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 90;
    const requestedMin = Number(args.min ?? 10);
    const min =
      Number.isFinite(requestedMin) && requestedMin > 0 ? Math.floor(requestedMin) : 10;

    const rows = await db.rpc("api_signup_attribution", {
      p_days: days,
      p_small_cohort: min,
    });

    if (!rows || rows.length === 0) {
      console.log(
        `\n  No workspaces created in the last ${days} days.\n`,
      );
      return;
    }

    const total = rows.reduce((sum, r) => sum + Number(r.signups), 0);
    const attributed = rows
      .filter((r) => r.landing_path !== "(unattributed)")
      .reduce((sum, r) => sum + Number(r.signups), 0);

    console.log(
      `\n  Signups by first landing page — last ${days} days\n` +
        `  ${total} workspace(s), ${attributed} with a recorded landing page ` +
        `(${total === 0 ? 0 : Math.round((attributed / total) * 100)}% coverage)\n`,
    );

    // Coverage is stated before the table on purpose. Attribution that covers a
    // third of signups can still be read as the whole picture if the number
    // sits under the conclusion instead of above it.
    if (attributed < total / 2) {
      console.log(
        "  Note: most signups carry no landing page. Every workspace created\n" +
          "  before attribution shipped is unattributed, as is anyone with\n" +
          "  storage blocked or a touch older than 30 days. Rank the attributed\n" +
          "  rows against EACH OTHER; do not read them as a share of growth.\n",
      );
    }

    const header =
      "  page".padEnd(34) +
      "signups".padStart(8) +
      "active".padStart(8) +
      "rate".padStart(7) +
      "  first      last";
    console.log(header);
    console.log(`  ${"─".repeat(header.length - 2)}`);

    const rankable = rows.filter((r) => !r.is_small);
    const thin = rows.filter((r) => r.is_small);

    for (const row of [...rankable, ...thin]) {
      const name = String(row.landing_path).slice(0, 32);
      console.log(
        `  ${name.padEnd(32)}` +
          String(row.signups).padStart(8) +
          String(row.activated).padStart(8) +
          (row.is_small ? "      —" : pct(row.activation_rate).padStart(7)) +
          `  ${day(row.first_signup_at)} ${day(row.last_signup_at)}` +
          (row.is_small ? "  (too thin to rank)" : ""),
      );
    }

    if (rankable.length === 0) {
      console.log(
        `\n  Nothing is above the ${min}-signup floor yet, so no page can be\n` +
          "  ranked against another. That is the honest answer, not a bug:\n" +
          "  #296 gates new competitor pages on this table, and building them\n" +
          "  off four data points is the decision the gate exists to prevent.\n",
      );
      return;
    }

    const best = rankable[0];
    console.log(
      `\n  Most activations: ${best.landing_path} — ${best.activated} of ` +
        `${best.signups} (${pct(best.activation_rate).trim()})\n`,
    );

    const hosts = [...new Set(rankable.flatMap((r) => r.referrer_hosts ?? []))];
    if (hosts.length > 0) {
      console.log(`  Referrers seen: ${hosts.slice(0, 12).join(", ")}\n`);
    }
  },
  { readOnly: true },
);
