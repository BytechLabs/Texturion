/**
 * [#404 / #383] Put a member back after an offboarding that should not have
 * happened, or that the customer changed their mind about.
 *
 *   node scripts/ops/restore-member.mjs --company <uuid> --member <uuid>
 *   node scripts/ops/restore-member.mjs --company <uuid> --member <uuid> --apply
 *
 * The normal way back is an invite, and that is the right answer whenever it
 * works. This exists for the case it does not: the seat is full, or the person
 * held work that was reassigned and the customer wants the original state back
 * rather than a fresh membership with a new id.
 *
 * DELIBERATELY DOES NOT restore the role. `offboard_member` records what they
 * were, but somebody being put back after a mistake should return as whatever
 * the owner asks for now — silently handing back `admin` because that is what
 * the row said last week is exactly the kind of decision a support script
 * should not be making on a customer's behalf. Reactivates as `member`, and
 * says so; the owner promotes from the Team screen if they meant to.
 */
import { fail, recordPlatformAudit, runScript, showRows } from "./lib.mjs";

await runScript("restore-member", async ({ args, apply, db, script }) => {
  const companyId = typeof args.company === "string" ? args.company : null;
  const memberId = typeof args.member === "string" ? args.member : null;
  if (!companyId || !memberId) {
    fail("--company <uuid> and --member <uuid> are both required.");
  }

  const rows = await db.select(
    "company_members",
    "id,company_id,user_id,role,deactivated_at,created_at",
    { id: "eq." + memberId, company_id: "eq." + companyId },
  );
  const member = rows[0];
  if (!member) {
    fail(`no member ${memberId} in company ${companyId}.`);
  }

  if (!member.deactivated_at) {
    console.log("  Already active. Nothing to restore.\n");
    return;
  }

  showRows("member", [member]);

  // The seat formula is enforced at invite AND acceptance for a reason; a
  // support restore that ignores it puts the workspace over its plan silently
  // and the next legitimate invite is the one that gets refused.
  const active = await db.count("company_members", {
    company_id: "eq." + companyId,
    deactivated_at: "is.null",
  });
  console.log(`  active members after this: ${active + 1}`);
  console.log("  (check that against the plan's seats before applying)\n");

  if (!apply) return;

  await db.patch(
    "company_members",
    { id: "eq." + memberId, company_id: "eq." + companyId },
    { deactivated_at: null, role: "member" },
  );

  await recordPlatformAudit(db, {
    script,
    companyId,
    action: "member.reactivated",
    targetType: "member",
    targetId: memberId,
    before: { active: false, role: member.role },
    after: { active: true, role: "member" },
  });

  console.log("  ✔ Back on the team, as a MEMBER.");
  console.log("    If they were an admin, the owner promotes them on Team.\n");
});
