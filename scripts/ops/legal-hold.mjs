/**
 * [#284] Place or lift a legal hold on a workspace.
 *
 *   node scripts/ops/legal-hold.mjs --company <uuid>
 *   node scripts/ops/legal-hold.mjs --company <uuid> --on --reason "..." --apply
 *   node scripts/ops/legal-hold.mjs --company <uuid> --off --apply
 *
 * A hold suspends every retention deletion for one workspace: the closure
 * purge today, and the D77 retention job when it exists. It changes nothing
 * else. The customer keeps working exactly as before, because a hold that
 * degraded the product would be a punishment for being in a dispute, and would
 * make us reluctant to set one.
 *
 * THIS EXISTS BEFORE THE ENFORCEMENT JOB ON PURPOSE. An enforcement job with
 * no suspend is a compliance problem of its own — the first workspace under
 * dispute would need somebody disabling a cron by hand, at exactly the wrong
 * moment, under exactly the pressure that produces mistakes.
 */
import { fail, runScript, showRows } from "./lib.mjs";

await runScript("legal-hold", async ({ args, apply, db, script }) => {
  const companyId = typeof args.company === "string" ? args.company : null;
  if (!companyId) fail("--company <uuid> is required.");

  const rows = await db.select(
    "companies",
    "id,name,deleted_at,purge_after,legal_hold_at,legal_hold_reason",
    { id: "eq." + companyId },
  );
  const company = rows[0];
  if (!company) fail(`no company with id ${companyId}`);

  showRows("Workspace", [company]);

  const turningOn = args.on === true;
  const turningOff = args.off === true;
  if (turningOn && turningOff) fail("--on and --off are mutually exclusive.");
  if (!turningOn && !turningOff) {
    console.log(
      company.legal_hold_at
        ? `  ON HOLD since ${company.legal_hold_at}: ${company.legal_hold_reason}\n`
        : "  Not on hold. Retention deletions apply normally.\n",
    );
    return;
  }

  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (turningOn && !reason) {
    fail(
      '--reason "<why>" is required to place a hold. A hold nobody can explain ' +
        "is a hold nobody will dare lift.",
    );
  }

  if (turningOff && company.purge_after) {
    console.log(
      `  WARNING: this workspace has a purge date of ${company.purge_after}.\n` +
        "  Lifting the hold makes it eligible for destruction again, possibly\n" +
        "  on the next run. Be sure the matter is closed.\n",
    );
  }

  if (!apply) {
    console.log(`  Would turn the hold ${turningOn ? "ON" : "OFF"}. Re-run with --apply.\n`);
    return;
  }

  const result = await db.rpc("api_set_legal_hold", {
    p_company_id: companyId,
    p_on: turningOn,
    p_reason: turningOn ? reason : null,
    p_actor: null,
  });

  console.log(
    `  ${script}: hold is now ${result?.on_hold ? "ON" : "OFF"} for ${company.name}.\n`,
  );
});
