/**
 * [#339] Who is running what — the adoption curve a mobile release never had.
 *
 *   node scripts/ops/version-distribution.mjs
 *   node scripts/ops/version-distribution.mjs --days 7
 *
 * Read-only, so there is no --apply. Before this existed, "does everyone have
 * the fix?" could only be answered with a hope; after a release it is the
 * question that decides whether a bug report is a new bug or an old build.
 *
 * The row that matters most is usually the one with no version: sessions from
 * builds shipped before the header existed. That number falling is the whole
 * point, and it is the number a floor would block, so it is never hidden.
 */
import { runScript, showRows } from "./lib.mjs";

await runScript("version-distribution", async ({ args, db }) => {
  const days = Number(args.days ?? 30);
  const window = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30;

  const rows = await db.rpc("api_version_distribution", { p_days: window });

  if (!rows || rows.length === 0) {
    console.log(`  No sessions seen in the last ${window} days.\n`);
    return;
  }

  const totals = new Map();
  for (const row of rows) {
    totals.set(row.platform, (totals.get(row.platform) ?? 0) + Number(row.sessions));
  }

  showRows(
    `Version distribution, last ${window} days`,
    rows.map((row) => {
      const total = totals.get(row.platform) || 1;
      const share = (Number(row.sessions) / total) * 100;
      return {
        platform: row.platform,
        // The un-upgraded population, named rather than blank, because a blank
        // cell reads as missing data instead of as the cohort it is.
        version: row.version ?? "(no version reported)",
        sessions: row.sessions,
        users: row.users,
        share: `${share.toFixed(1)}%`,
      };
    }),
  );

  for (const [platform, total] of totals) {
    const unknown = rows
      .filter((r) => r.platform === platform && !r.version)
      .reduce((sum, r) => sum + Number(r.sessions), 0);
    if (unknown > 0) {
      console.log(
        `  ${platform}: ${((unknown / total) * 100).toFixed(1)}% report no version — ` +
          `a floor would block all of them.`,
      );
    }
  }
  console.log("");
});
