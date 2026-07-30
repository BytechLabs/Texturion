/**
 * [#327] D12's week-4 retention target, reported against.
 *
 *   node scripts/ops/retention-report.mjs
 *   node scripts/ops/retention-report.mjs --weeks 26
 *   node scripts/ops/retention-report.mjs --segment activated
 *
 * Read-only, so there is no --apply.
 *
 * D12 commits to "week-4 logo retention >= 85%" and nothing could say whether
 * we were above or below it. #327 is blunt about why that matters more than a
 * missing chart: this is a solo founder making constant prioritisation calls,
 * and "intuition favours what is visible. Bugs and feature requests are
 * visible. A cohort quietly failing to reach week four is not."
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REFUSES TO DO, WHICH IS MOST OF ITS VALUE.
 *
 * #327 asks for the number and then immediately warns about it: "a 70% week-4
 * figure from eleven workspaces is not evidence of anything... otherwise the
 * first misleading number will drive a bad decision, which is worse than
 * having no number."
 *
 * So this never prints a bare rate. Every line carries the cohort size, small
 * cohorts are marked `(thin)`, backfilled anchors are marked `(approx)`, and
 * the verdict against 85% is WITHHELD entirely for a thin cohort rather than
 * shown with a caveat somebody will read past. A rate you are told not to
 * trust still anchors you; a rate you are not shown cannot.
 *
 * The database excludes immature cohorts, so nothing here is a cohort that has
 * not had the chance to churn. That is invisible in the output by design — the
 * newest weeks simply are not listed, and the header says how far back the
 * mature data reaches.
 */
import { runScript } from "./lib.mjs";

/** D12's committed floor. */
const TARGET = 0.85;

function pct(rate) {
  return rate === null || rate === undefined
    ? "  n/a"
    : `${(Number(rate) * 100).toFixed(0).padStart(3)}%`;
}

/**
 * The verdict, or nothing.
 *
 * Withheld below the small-cohort floor rather than annotated. #327's failure
 * mode is a number driving a decision it cannot support, and "72% (thin)" still
 * reads as 72% to somebody deciding what to build next week.
 */
function verdict(row) {
  if (row.is_small) return "too thin to judge";
  if (row.rate === null) return "";
  return Number(row.rate) >= TARGET ? `meets ${TARGET * 100}%` : `BELOW ${TARGET * 100}%`;
}

await runScript("retention-report", async ({ args, db }) => {
  const weeks = Number(args.weeks ?? 12);
  const window = Number.isFinite(weeks) && weeks > 0 ? Math.floor(weeks) : 12;
  const only = typeof args.segment === "string" ? args.segment : null;

  const rows = await db.rpc("api_retention_cohorts", { p_weeks: window });

  if (!rows || rows.length === 0) {
    console.log(
      `\n  No mature cohorts in the last ${window} weeks.\n\n` +
        "  A cohort is reported once its 28th day has passed — before that it\n" +
        "  cannot have churned at week four, and showing it would report ~100%.\n" +
        "  So this is not an error: it means nobody has been paying long enough.\n",
    );
    return;
  }

  const weeksSeen = [...new Set(rows.map((r) => r.cohort_week))].sort().reverse();
  console.log(
    `\n  D12 week-4 logo retention — target ${TARGET * 100}%\n` +
      `  ${weeksSeen.length} mature cohort(s), newest ${weeksSeen[0]}, ` +
      `oldest ${weeksSeen[weeksSeen.length - 1]}\n`,
  );

  const segments = only
    ? [only]
    : ["all", "activated", "plan", "country", "crew"];

  for (const segment of segments) {
    const inSegment = rows.filter((r) => r.segment === segment);
    if (inSegment.length === 0) continue;
    console.log(`  ── ${segment} ${"─".repeat(Math.max(0, 58 - segment.length))}`);
    for (const week of weeksSeen) {
      for (const row of inSegment.filter((r) => r.cohort_week === week)) {
        const flags = [
          row.is_small ? "thin" : null,
          row.is_approximate ? "approx" : null,
        ].filter(Boolean);
        console.log(
          `  ${row.cohort_week}  ${String(row.segment_value).padEnd(14)}` +
            `${pct(row.rate)}  ${String(row.retained).padStart(3)}/${String(row.cohort_size).padEnd(3)}` +
            `  ${verdict(row).padEnd(18)}` +
            `${flags.length > 0 ? `(${flags.join(", ")})` : ""}`,
        );
      }
    }
    console.log("");
  }

  // The comparison #327 says is the real question: "If that gap is large,
  // activation is the whole growth strategy and the backlog should reflect it;
  // if it is small, activation is a vanity milestone and we should know that
  // too." Computed across every mature cohort, because per-week it is always
  // too thin to mean anything at this scale.
  const activation = rows.filter((r) => r.segment === "activated");
  const roll = (value) => {
    const matching = activation.filter((r) => r.segment_value === value);
    const size = matching.reduce((sum, r) => sum + Number(r.cohort_size), 0);
    const kept = matching.reduce((sum, r) => sum + Number(r.retained), 0);
    return { size, kept, rate: size === 0 ? null : kept / size };
  };
  const yes = roll("activated");
  const no = roll("not activated");

  console.log("  ── does activation predict survival? ─────────────────────────");
  console.log(
    `  activated      ${pct(yes.rate)}  ${yes.kept}/${yes.size}\n` +
      `  not activated  ${pct(no.rate)}  ${no.kept}/${no.size}`,
  );
  if (yes.size < 20 || no.size < 20) {
    // Deliberately no gap figure here. Subtracting two thin rates produces a
    // confident-looking number with none of the confidence, and that is exactly
    // the artefact this whole report is written to avoid.
    console.log(
      "\n  Not enough workspaces on one side to compare yet. The gap is the\n" +
        "  question worth answering — whether activation is the growth strategy\n" +
        "  or a vanity milestone — and it needs 20 a side before it means\n" +
        "  anything.\n",
    );
  } else {
    const gap = (yes.rate - no.rate) * 100;
    console.log(
      `\n  Gap: ${gap >= 0 ? "+" : ""}${gap.toFixed(0)} points.\n` +
        (Math.abs(gap) >= 15
          ? "  Large. Activation looks like the growth strategy, and the backlog\n  should reflect that.\n"
          : "  Small. Activation may be a vanity milestone rather than the lever.\n"),
    );
  }

  if (rows.some((r) => r.is_approximate)) {
    console.log(
      "  (approx) — anchored from signup date rather than measured from Stripe,\n" +
        "  for workspaces that predate the anchor column. Checkout happens inside\n" +
        "  onboarding here, so the two are usually minutes apart; it is still an\n" +
        "  approximation and is marked rather than smoothed over.\n",
    );
  }
});
