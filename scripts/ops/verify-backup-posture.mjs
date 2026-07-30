/**
 * [#249] Ask production what its backup posture actually IS.
 *
 *   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... node scripts/ops/verify-backup-posture.mjs
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS.
 *
 * #249 was filed because we had a backup plan and no evidence it worked.
 * `backup-drill.mjs` answered half of that — the logical restore path, measured.
 * The other half was a *claim about the platform*: D74 recorded **RPO 5 minutes**
 * on the grounds that it "is what Supabase PITR's WAL granularity gives us", and
 * `DISASTER-RECOVERY.md` carried a row marked *pending verification* saying so.
 *
 * Nobody had checked. That is the same shape as the thing #249 complained about,
 * one level up: an unverified number in a binding document, which is exactly the
 * number that gets quoted into a security questionnaire.
 *
 * It did not need a dashboard visit. The Management API answers it, read-only,
 * with the token CI already holds — so this is a script rather than a task.
 *
 * WHAT IT PRINTS, and why each line is load-bearing:
 *
 *   pitr_enabled   Whether point-in-time recovery is on. If FALSE, the real RPO
 *                  is the gap since the last daily backup — up to 24 hours — and
 *                  any tighter number in our docs is a wish.
 *   walg_enabled   WAL-G is running, which is how the daily physical backups are
 *                  taken. It being true does NOT imply PITR: the daily snapshot
 *                  and continuous WAL retention are separately billed things,
 *                  and conflating them is the mistake D74 made.
 *   the window     Oldest and newest backup, and the count. This is the actual
 *                  recovery envelope: you cannot restore to a moment older than
 *                  the oldest backup, whatever the retention setting claims.
 *
 * Read-only. It takes no dump, holds no data, and touches nothing.
 *
 * ---------------------------------------------------------------------------
 * TWO MODES, because "inform a decision" and "watch for a change" want opposite
 * exit codes.
 *
 *   (default)   Exits 1 while PITR is off. This is for gating: answering a
 *               security questionnaire, or quoting an RPO anywhere. A non-zero
 *               exit is the script refusing to let the tighter claim be made.
 *
 *   --monitor   Exits 1 only when the backup situation is WORSE than what
 *               DISASTER-RECOVERY.md already records: no backups at all, or the
 *               newest one older than --max-age-hours (default 36).
 *
 * #249 asks for "a periodic re-check, so the doc asserts a fact instead of
 * assigning a chore". A weekly job running the DEFAULT mode would be red forever,
 * because PITR being off is a recorded founder decision rather than news — and a
 * permanently red scheduled job is one people learn to scroll past, which is
 * worse than no job. So the periodic check alarms on the thing nobody has decided
 * and nobody would otherwise notice: backups silently stopping.
 *
 * PITR turning ON is reported loudly in both modes and fails neither: it is good
 * news, and the thing to do about it is update the documents, not page anybody.
 */

const API = "https://api.supabase.com/v1";
/**
 * How stale the newest daily backup may be before --monitor calls it broken.
 *
 * 36 hours, not 24: the snapshot is taken on the platform's own schedule, so a
 * 24-hour threshold would fire on ordinary drift in when it runs. 36 still
 * catches a genuine stop within two days, and does not cry wolf.
 */
const DEFAULT_MAX_AGE_HOURS = 36;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(
      `Missing ${name}. Both are CLI-only credentials — see the commented ` +
        `block in apps/api/.dev.vars, or the same-named GitHub secrets.`,
    );
    process.exit(2);
  }
  return value;
}

/** Hours between two ISO instants, one decimal place. */
function hoursBetween(fromIso, toIso) {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.round((ms / 3_600_000) * 10) / 10;
}

async function main() {
  const token = required("SUPABASE_ACCESS_TOKEN");
  const ref = required("SUPABASE_PROJECT_REF");

  const monitor = process.argv.includes("--monitor");
  const ageFlag = process.argv.find((arg) => arg.startsWith("--max-age-hours="));
  const maxAgeHours = ageFlag
    ? Number(ageFlag.split("=")[1])
    : DEFAULT_MAX_AGE_HOURS;
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    console.error("--max-age-hours must be a positive number of hours.");
    process.exit(2);
  }

  const response = await fetch(`${API}/projects/${ref}/database/backups`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    console.error(
      `Management API answered HTTP ${response.status}. A 401 means the token ` +
        `is wrong or expired; a 404 means the project ref is.`,
    );
    process.exit(1);
  }
  const data = await response.json();
  const backups = (data.backups ?? [])
    .map((row) => row.inserted_at)
    .sort();

  const pitr = data.pitr_enabled === true;
  console.log(`project        ${ref} (${data.region ?? "unknown region"})`);
  console.log(`pitr_enabled   ${pitr}`);
  console.log(`walg_enabled   ${data.walg_enabled === true}`);
  console.log(`backups        ${backups.length}`);
  if (backups.length > 0) {
    const newest = backups[backups.length - 1];
    console.log(`oldest         ${backups[0]}`);
    console.log(`newest         ${newest}`);
    console.log(
      `age of newest  ${hoursBetween(newest, new Date().toISOString())}h`,
    );
  }

  console.log("");
  if (pitr) {
    console.log(
      "RPO: minutes. PITR is on, so recovery is to an arbitrary point inside " +
        "the retention window. D74's 5-minute figure is supportable.",
    );
  } else {
    console.log(
      "RPO: UP TO 24 HOURS. PITR is OFF — the only restore points are the " +
        "daily physical backups above. Any tighter RPO in our documents is a " +
        "wish, and must not be quoted to a customer or a questionnaire.",
    );
    console.log(
      "Enabling PITR is a paid add-on and a founder decision. Until it is on, " +
        "24 hours is the honest number.",
    );
  }

  if (!monitor) {
    // Exit 1 when reality contradicts the tighter claim, so this can gate a
    // release or a questionnaire answer rather than merely inform one.
    process.exit(pitr ? 0 : 1);
  }

  // --monitor: the periodic re-check (#249). Alarms on backups going away, not
  // on the PITR decision that is already written down.
  const problems = [];
  if (backups.length === 0) {
    problems.push("NO BACKUPS AT ALL. There is nothing to restore from.");
  } else {
    const ageHours = hoursBetween(
      backups[backups.length - 1],
      new Date().toISOString(),
    );
    if (ageHours > maxAgeHours) {
      problems.push(
        `Newest backup is ${ageHours}h old, over the ${maxAgeHours}h ceiling. ` +
          `Daily snapshots have stopped or are failing.`,
      );
    }
  }

  console.log("");
  if (problems.length === 0) {
    console.log(
      `monitor: OK — backups are arriving (newest under ${maxAgeHours}h).` +
        (pitr
          ? ""
          : " PITR is still off, which is recorded in docs/DISASTER-RECOVERY.md " +
            "and is not what this mode watches for."),
    );
    // Good news that needs a document change rather than an alarm.
    if (pitr) {
      console.log(
        "monitor: PITR IS NOW ON. Update docs/DISASTER-RECOVERY.md §2 and D74 — " +
          "the recorded 24-hour RPO is no longer the honest number.",
      );
    }
    process.exit(0);
  }

  for (const problem of problems) console.error(`monitor: ${problem}`);
  process.exit(1);
}

await main();
