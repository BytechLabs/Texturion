/**
 * [#288] Referral as a channel, with a number attached.
 *
 *   node scripts/ops/referral-report.mjs
 *   node scripts/ops/referral-report.mjs --days 30
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS SEPARATELY FROM attribution-report.mjs.
 *
 * That report now names `(referral)` as a landing page, which is what makes
 * referred signups visible at all — before it they were counted as ordinary
 * direct traffic, because a link pasted into a text message arrives with no
 * parameters, no referrer and no campaign.
 *
 * But a landing-page table can only ever answer "how many arrived and how many
 * activated". The referral programme is a FUNNEL with money at the end of it, and
 * three of its four numbers have nowhere to appear in a page ranking: how many
 * referrals were made, how many were earned, and how many months we gave away
 * for them. #288's last scope line asks for exactly this — "so referral becomes a
 * channel with a number attached rather than a feature we shipped and stopped
 * thinking about".
 *
 * READ-ONLY. Nothing here writes.
 *
 * WHAT IT REFUSES TO REPORT.
 *
 * A conversion rate off four referrals. At our size the difference between two
 * and three qualifying is thirty-three percentage points, and a number that
 * cannot support a decision should not be formatted like one that can (#327).
 * Counts always; rates only past the floor.
 */
import { runScript } from "./lib.mjs";

/** Below this many referrals, print counts and no percentages. */
const RATE_FLOOR = 10;

function pct(part, whole) {
  if (whole < RATE_FLOOR) return "  —";
  return `${Math.round((part / whole) * 100)}%`.padStart(4);
}

function day(value) {
  return value ? String(value).slice(0, 10) : "—";
}

await runScript(
  "referral-report",
  async ({ args, db }) => {
    const requested = Number(args.days ?? 90);
    const days =
      Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 90;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const rows = await db.select(
      "referrals",
      "id,company_id,referee_company_id,created_at,qualified_at," +
        "referrer_rewarded_at,referee_rewarded_at,voided_at,voided_reason",
      { created_at: `gte.${since}` },
    );

    if (rows.length === 0) {
      console.log(
        `\n  No referrals recorded in the last ${days} days.\n\n` +
          "  That is a finding rather than a blank: #288's own devil's advocate\n" +
          "  says the honest precondition for a referral programme is evidence\n" +
          "  that customers already recommend us unprompted. If this stays at\n" +
          "  zero, the programme is not the thing to invest in next.\n",
      );
      return;
    }

    const live = rows.filter((row) => row.voided_at === null);
    const voided = rows.length - live.length;
    const qualified = live.filter((row) => row.qualified_at !== null);
    // Both sides are paid at once, but they are stamped separately and either
    // can be held back — a referrer whose subscription lapsed, or a paused
    // workspace whose free month would be spent on a ~$5 holding fee (#277).
    // Counting only one side would hide exactly that.
    const referrerPaid = live.filter((row) => row.referrer_rewarded_at !== null);
    const refereePaid = live.filter((row) => row.referee_rewarded_at !== null);
    const owed = qualified.filter((row) => row.referrer_rewarded_at === null);

    console.log(
      `\n  Referral channel — last ${days} days\n\n` +
        `  ${rows.length} referral(s) recorded` +
        (voided > 0 ? `, ${voided} voided` : "") +
        "\n",
    );

    const line = (label, count, note = "") =>
      console.log(
        `  ${label.padEnd(34)}${String(count).padStart(5)}  ` +
          `${pct(count, live.length)}  ${note}`,
      );

    line("signed up through a link", live.length, "");
    // The gate, and the whole abuse answer: the referee sent AND was answered.
    line("earned it (referee activated)", qualified.length, "D12: sent and answered");
    line("referrer's month issued", referrerPaid.length, "");
    line("referee's month issued", refereePaid.length, "");

    if (live.length < RATE_FLOOR) {
      console.log(
        `\n  Under ${RATE_FLOOR} referrals, so no rates are shown. At this size one\n` +
          "  more or less moves a percentage by double digits, and a number that\n" +
          "  cannot support a decision should not be formatted like one that can.\n",
      );
    }

    // The one number that costs us something, said plainly. A free month is real
    // money and the cost-protection mandate says every cost centre gets watched
    // before it is prompted.
    const monthsGiven = referrerPaid.length + refereePaid.length;
    console.log(
      `\n  Free months given away: ${monthsGiven}` +
        (monthsGiven > 0
          ? ` (${referrerPaid.length} to referrers, ${refereePaid.length} to referees)`
          : ""),
    );

    if (owed.length > 0) {
      // Not a rounding difference: rewardSide leaves a row UNSTAMPED when it
      // refuses to spend a month on a paused plan or a cancelled subscription,
      // and payPendingReferralRewards pays it on the next resume. A number that
      // does not move for weeks is a referrer who is owed and not being paid.
      console.log(
        `\n  Earned but not yet paid: ${owed.length}\n` +
          "  These are referrers with nothing to discount right now — paused, or\n" +
          "  cancelled. The row stays unstamped and POST /v1/billing/resume pays\n" +
          "  it. If this number does not move, that retry is not running.",
      );
      for (const row of owed.slice(0, 10)) {
        console.log(
          `    ${row.company_id}  earned ${day(row.qualified_at)}`,
        );
      }
      if (owed.length > 10) {
        // Never a silent cap: a truncated list that does not say so reads as
        // the whole list.
        console.log(`    … and ${owed.length - 10} more`);
      }
    }

    const reasons = rows
      .filter((row) => row.voided_at !== null)
      .map((row) => row.voided_reason ?? "(no reason recorded)");
    if (reasons.length > 0) {
      const counts = new Map();
      for (const reason of reasons) {
        counts.set(reason, (counts.get(reason) ?? 0) + 1);
      }
      console.log("\n  Voided:");
      for (const [reason, count] of counts) {
        console.log(`    ${String(count).padStart(3)}  ${reason}`);
      }
    }

    console.log("");
  },
  { readOnly: true },
);
