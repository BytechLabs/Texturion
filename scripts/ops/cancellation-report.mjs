/**
 * [#277] Why customers leave, and who we talked out of it.
 *
 *   node scripts/ops/cancellation-report.mjs
 *   node scripts/ops/cancellation-report.mjs --days 365
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS.
 *
 * Cancellation runs through the Stripe portal, so the only thing that reached
 * us was a webhook. #277: "Ten cancellations for ten different reasons is
 * noise; ten for the same reason is a roadmap. Today both look identical."
 *
 * READ-ONLY. It selects and prints. Nothing here writes.
 *
 * THE TWO NUMBERS, AND WHY BOTH ARE HERE.
 *
 * A reason is recorded when somebody opens the cancel screen and says why -
 * before the handoff to Stripe, because afterwards they are gone and nobody
 * answers a survey about a product they just left. Saying why is not leaving:
 * some people read the screen and stay.
 *
 *   confirmed    they said this, and the subscription ended
 *   open         they said this, and they are still here
 *
 * The second column is the one a retention offer is measured against, and it is
 * the reason the row is written at intent rather than on the webhook. A report
 * that showed only confirmed cancellations would be measuring the same thing
 * the webhook already told us.
 *
 * WHAT IT REFUSES TO DO.
 *
 * No rates, and no ranking by percentage. At this base size a reason with three
 * statements and one save reads as "our best save at 67%" and would move real
 * money on four data points. #327 is the standing lesson here: a number that
 * cannot support a decision should not be formatted like one that can. Counts
 * only, ordered by how often people said it.
 *
 * TENURE AND PLAN are printed per reason because #277 asks for reasons to be
 * readable "against plan, tenure and usage". Usage is deliberately absent: it
 * needs the message-volume join this script has no business carrying, and a
 * column that is sometimes right is worse than one that is missing.
 */
import { runScript } from "./lib.mjs";

function days(from, to) {
  if (!from) return null;
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function median(values) {
  const sorted = values.filter((v) => v !== null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

await runScript("cancellation-report", async ({ args, db }) => {
  const requested = Number(args.days ?? 180);
  const window = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 180;
  const since = new Date(Date.now() - window * 86_400_000).toISOString();

  const rows =
    (await db.select(
      "cancellation_reasons",
      "reason,detail,confirmed_at,created_at,companies!inner(plan,created_at)",
      { created_at: `gte.${since}`, order: "created_at.desc" },
    )) ?? [];
  if (rows.length === 0) {
    console.log(
      `\n  Nobody has told us why in the last ${window} days.\n\n` +
        `  That is either good news or a broken cancel screen. The screen is\n` +
        `  skippable by design, so a run of zero is worth checking against the\n` +
        `  number of workspaces that actually cancelled in the same window.\n`,
    );
    return;
  }

  const byReason = new Map();
  for (const row of rows) {
    // A skipped question is a real answer and gets its own line rather than
    // being dropped: "most people would not say" is itself a finding.
    const key = row.reason || "(skipped)";
    const entry = byReason.get(key) ?? { confirmed: 0, open: 0, tenures: [], plans: new Map() };
    if (row.confirmed_at) entry.confirmed += 1;
    else entry.open += 1;
    entry.tenures.push(days(row.companies?.created_at, row.confirmed_at));
    const plan = row.companies?.plan ?? "(none)";
    entry.plans.set(plan, (entry.plans.get(plan) ?? 0) + 1);
    byReason.set(key, entry);
  }

  const confirmed = rows.filter((r) => r.confirmed_at).length;
  console.log(
    `\n  Why workspaces said they were leaving — last ${window} days\n` +
      `  ${rows.length} statement(s): ${confirmed} went, ${rows.length - confirmed} still here\n`,
  );

  console.log("  reason            gone   stayed   median tenure   plans");
  console.log("  " + "-".repeat(62));
  const ordered = [...byReason.entries()].sort(
    (a, b) => b[1].confirmed + b[1].open - (a[1].confirmed + a[1].open),
  );
  for (const [reason, entry] of ordered) {
    const tenure = median(entry.tenures);
    const plans = [...entry.plans.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([plan, count]) => `${plan}:${count}`)
      .join(" ");
    console.log(
      `  ${reason.padEnd(16)} ${String(entry.confirmed).padStart(4)} ` +
        `${String(entry.open).padStart(8)} ` +
        `${(tenure === null ? "—" : `${tenure}d`).padStart(15)}   ${plans}`,
    );
  }

  // The free text last, and in full. It is the most valuable column in the
  // table and the one a summary destroys: "too expensive" is a category,
  // "you're fine but I only work six months a year" is the roadmap.
  const written = rows.filter((r) => r.detail);
  console.log(
    `\n  In their own words (${written.length} of ${rows.length} wrote something)\n`,
  );
  for (const row of written) {
    const state = row.confirmed_at ? "gone  " : "stayed";
    console.log(`  ${state}  ${String(row.created_at).slice(0, 10)}  ${row.detail}`);
  }
  console.log("");
});
