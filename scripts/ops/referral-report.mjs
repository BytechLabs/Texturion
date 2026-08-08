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
 * It also carries the half no link can measure: what new signups SAY when asked
 * how they heard about us. That question is #288's own recommended first step,
 * and it is the only thing that can see an owner who was told about us at a
 * supply counter and then searched for the name a week later.
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

/** Below this many rows, print counts and no percentages. */
const RATE_FLOOR = 10;

function pct(part, whole) {
  if (whole < RATE_FLOOR) return "  —";
  return `${Math.round((part / whole) * 100)}%`.padStart(4);
}

function day(value) {
  return value ? String(value).slice(0, 10) : "—";
}

/**
 * What new signups SAY, which is the only measure that sees word of mouth.
 *
 * Printed FIRST and separately from the funnel below it, because the two answer
 * different questions. The funnel counts people who used a link. This counts
 * people who were told about us at all — including everyone who heard the name,
 * searched for it a week later, and would otherwise be filed as direct traffic.
 *
 * Coverage is stated above the numbers rather than under them. A question a
 * third of signups skip can still be read as the whole picture if the skip rate
 * sits below the conclusion.
 */
function reportSelfReported(companies) {
  const total = companies.length;
  if (total === 0) return;
  const answered = companies.filter(
    (row) => row.signup_source !== null && row.signup_source !== undefined,
  );
  if (answered.length === 0) {
    console.log(
      '\n  Nobody has answered "how did you hear about us?" yet.\n' +
        "  Every workspace here either predates the question or skipped it.\n",
    );
    return;
  }

  const counts = new Map();
  for (const row of answered) {
    counts.set(row.signup_source, (counts.get(row.signup_source) ?? 0) + 1);
  }

  console.log(
    `\n  How they say they heard about us — ${answered.length} of ${total} ` +
      `answered (${Math.round((answered.length / total) * 100)}%)\n`,
  );
  // NULL is not printed as a bucket. A skipped question reported alongside the
  // answers would quietly become the largest "source" we have.
  for (const [source, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(
      `    ${String(count).padStart(3)}  ${source.padEnd(18)}` +
        (answered.length >= RATE_FLOOR ? pct(count, answered.length) : ""),
    );
  }

  const told = counts.get("another_business") ?? 0;
  if (told > 0) {
    console.log(
      `\n  ${told} said another business told them. That is the channel #288 is ` +
        "about,\n  and the only line here a referral link cannot measure.",
    );
  }
}

await runScript(
  "referral-report",
  async ({ args, db }) => {
    const requested = Number(args.days ?? 90);
    const days =
      Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 90;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // #288's cheap first step, and the half of the channel a link cannot see.
    const said = await db.select("companies", "signup_source,created_at", {
      created_at: `gte.${since}`,
      deleted_at: "is.null",
    });
    reportSelfReported(said);

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
          "  that customers already recommend us unprompted. Read that against\n" +
          "  the self-reported answers above — people saying another business\n" +
          "  told them, with no referrals recorded, means the channel is real\n" +
          "  and the link is not reaching it.\n",
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

    line("signed up through a link", live.length);
    // The gate, and the whole abuse answer: the referee sent AND was answered.
    line("earned it (referee activated)", qualified.length, "D12: sent and answered");
    line("referrer's month issued", referrerPaid.length);
    line("referee's month issued", refereePaid.length);

    if (live.length < RATE_FLOOR) {
      console.log(
        `\n  Under ${RATE_FLOOR} referrals, so no rates are shown. At this size one\n` +
          "  more or less moves a percentage by double digits, and a number that\n" +
          "  cannot support a decision should not be formatted like one that can.\n",
      );
    }

    // The one number that costs us something, said plainly. A free month is real
    // money, and the cost-protection mandate says every cost centre gets watched
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
        console.log(`    ${row.company_id}  earned ${day(row.qualified_at)}`);
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
