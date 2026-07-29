/**
 * [#283] Flip a feature flag, or contain an incident, without a deploy.
 *
 *   node scripts/ops/set-flag.mjs --list
 *   node scripts/ops/set-flag.mjs --key kill:calls --off --note "telnyx incident" --apply
 *   node scripts/ops/set-flag.mjs --key kill:calls --on --apply
 *   node scripts/ops/set-flag.mjs --key rollout:x --percent 10 --apply
 *   node scripts/ops/set-flag.mjs --key rollout:x --internal --apply
 *   node scripts/ops/set-flag.mjs --key kill:ai --company <uuid> --off --apply
 *   node scripts/ops/set-flag.mjs --key kill:ai --company <uuid> --clear --apply
 *
 * THE POINT IS THAT THIS DOES NOT DEPLOY. The launch-blocking calls outage was
 * one header shipped to everyone, and the fix had to go through CI — the path
 * that is unavailable exactly when the deploy path is what broke. A flag takes
 * effect within the Worker's ten-second flag cache.
 *
 * Dry run by default, like every script here. On a kill switch the dry run
 * matters more than usual: it prints how many workspaces the change reaches
 * before it reaches them.
 */
import { fail, runScript, showRows } from "./lib.mjs";

/**
 * The keys the code declares. Mirrors apps/api/src/flags/registry.ts.
 *
 * Duplicated deliberately: this script is plain ESM with no build step and
 * cannot import the Worker's TypeScript. `flags-roster.test.ts` fails CI if
 * the two lists drift, which is the same guard the liveness table uses.
 */
const KILL_SWITCHES = ["kill:ai", "kill:calls", "kill:realtime", "kill:outbound-send"];

await runScript("set-flag", async ({ args, apply, db, script }) => {
  if (args.list === true) {
    const rows = await db.select(
      "feature_flags",
      "key,enabled,rollout_percent,internal_only,note,updated_at",
    );
    showRows("Flags with a row (everything else is at its code default)", rows);
    const overrides = await db.select(
      "feature_flag_overrides",
      "key,company_id,enabled,note",
    );
    showRows("Per-workspace overrides", overrides);
    console.log(`  Kill switches declared in code: ${KILL_SWITCHES.join(", ")}\n`);
    return;
  }

  const key = typeof args.key === "string" ? args.key : null;
  if (!key) fail("--key <flag> is required (or --list).");

  const on = args.on === true;
  const off = args.off === true;
  if (on && off) fail("--on and --off are mutually exclusive.");

  const company = typeof args.company === "string" ? args.company : null;

  // ---- per-workspace override -------------------------------------------
  if (company) {
    if (args.clear === true) {
      console.log(`  Clearing the ${key} override for ${company}.`);
      console.log("  That workspace returns to whatever the global switch says.\n");
      if (!apply) return;
      await db.rpc("api_clear_feature_flag_override", {
        p_key: key,
        p_company_id: company,
      });
      console.log(`  ${script}: override cleared.\n`);
      return;
    }

    if (!on && !off) fail("--company needs --on, --off, or --clear.");
    console.log(`  Setting ${key} = ${on} for workspace ${company} ONLY.`);
    console.log("  This beats the global switch in both directions.\n");
    if (!apply) return;
    await db.rpc("api_override_feature_flag", {
      p_key: key,
      p_company_id: company,
      p_enabled: on,
      p_note: args.note ?? null,
      p_actor: null,
    });
    console.log(`  ${script}: override set.\n`);
    return;
  }

  // ---- global --------------------------------------------------------------
  const percent = args.percent === undefined ? null : Number(args.percent);
  if (percent !== null && (!Number.isInteger(percent) || percent < 0 || percent > 100)) {
    fail(`--percent must be a whole number 0-100, got "${args.percent}".`);
  }

  const internal = args.internal === true;
  // Three-valued: null means "no global statement", which is different from
  // off — it falls through to the code default.
  const enabled = on ? true : off ? false : null;

  if (KILL_SWITCHES.includes(key) && enabled === false && !args.note) {
    fail(
      `switching off ${key} takes a subsystem away from every customer. ` +
        `--note "<why>" is required, because the next person to look at this ` +
        `row is you at 3am with no memory of today.`,
    );
  }

  const before = await db.select(
    "feature_flags",
    "key,enabled,rollout_percent,internal_only,note,updated_at",
    { key: "eq." + key },
  );
  showRows("Flag now", before.length ? before : [{ key, state: "(no row — code default)" }]);
  showRows("Flag after", [
    {
      key,
      enabled: enabled === null ? "(unsaid — code default)" : enabled,
      percent: percent ?? "-",
      internal_only: internal,
      note: args.note ?? "-",
    },
  ]);

  if (KILL_SWITCHES.includes(key) && enabled === false) {
    console.log(
      "  This is a KILL SWITCH going OFF. Every workspace loses this subsystem\n" +
        "  within ~10 seconds. Re-run with --on --apply to restore it; that is\n" +
        "  also ~10 seconds and involves no deploy.\n",
    );
  }

  if (!apply) return;

  const result = await db.rpc("api_set_feature_flag", {
    p_key: key,
    p_enabled: enabled,
    p_percent: percent,
    p_internal: internal,
    p_note: args.note ?? null,
    p_actor: null,
  });

  console.log(
    `  ${script}: ${key} updated — reaching ` +
      `${result?.reached_companies ?? 0} of ${result?.active_companies ?? 0} workspaces.\n`,
  );
});
