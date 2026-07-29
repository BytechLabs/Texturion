/**
 * [#404] Undo a workspace closure, within the 30-day window.
 *
 *   node scripts/ops/reopen-workspace.mjs --company <uuid>
 *   node scripts/ops/reopen-workspace.mjs --company <uuid> --apply
 *
 * The product promises this in `close-workspace-card.tsx` — "email us and we
 * can undo it" — and until now there was no route, no script and no surface
 * behind that sentence. Fulfilling it meant reversing a closure by hand on a
 * schema with 37 tables.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CAN AND CANNOT BRING BACK, because the difference is the whole
 * honesty of the promise.
 *
 * CAN: the workspace itself. Clearing `deleted_at` and `purge_after` stops the
 * purge clock and restores every conversation, contact, message and task —
 * closure is a soft delete precisely so this is possible.
 *
 * CANNOT: the phone number. Closing releases it AT TELNYX immediately, on
 * purpose (holding a number costs us money for a workspace that asked to
 * leave), and once released it is back in the carrier's pool and may already
 * belong to another business. Nothing in this repo can take it back.
 *
 * So this script REPORTS the number's fate rather than quietly restoring a
 * workspace whose number is gone. The customer needs to hear that from us in
 * the same breath as "you're back", not discover it when a job text bounces.
 *
 * CANNOT: the subscription. It was cancelled at Stripe; the owner resubscribes
 * through the normal checkout, which is a route that already exists.
 */
import { fail, recordPlatformAudit, runScript, showRows } from "./lib.mjs";

await runScript("reopen-workspace", async ({ args, apply, db, script }) => {
  const companyId = typeof args.company === "string" ? args.company : null;
  if (!companyId) {
    fail("--company <uuid> is required. This never runs against every tenant.");
  }

  const rows = await db.select(
    "companies",
    "id,name,deleted_at,purge_after,subscription_status",
    { id: "eq." + companyId },
  );
  const company = rows[0];
  if (!company) fail(`no company with id ${companyId}`);

  if (!company.deleted_at) {
    console.log(`  ${company.name} is not closed. Nothing to undo.\n`);
    return;
  }

  const purgeAfter = company.purge_after ? new Date(company.purge_after) : null;
  if (purgeAfter && purgeAfter.getTime() <= Date.now()) {
    // Past the window the customer was given, the data may already be gone —
    // and saying "reopened" over an empty workspace is worse than saying no.
    fail(
      `the 30-day window closed on ${purgeAfter.toISOString()}. ` +
        "Check whether the purge has already run before doing anything: past " +
        "that point this is not an undo, it is a resurrection of a shell.",
    );
  }

  showRows("workspace", [
    {
      name: company.name,
      closed_at: company.deleted_at,
      purge_after: company.purge_after,
      subscription: company.subscription_status,
    },
  ]);

  // The part the customer will ask about first.
  const numbers = await db.select("phone_numbers", "id,number_e164,status", {
    company_id: "eq." + companyId,
  });
  showRows("numbers", numbers);

  const released = numbers.filter((n) => n.status === "released");
  if (released.length > 0) {
    console.log(
      `  ⚠ ${released.length} number(s) were RELEASED at the carrier when this\n` +
        "    workspace closed. Reopening does NOT get them back — they are in\n" +
        "    Telnyx's pool and may already belong to somebody else. Tell the\n" +
        "    customer this in the same message as the good news.\n",
    );
  }

  const members = await db.select(
    "company_members",
    "id,user_id,role,deactivated_at",
    { company_id: "eq." + companyId },
  );
  showRows("members who regain access", members);

  if (!apply) return;

  // Belt and braces on the filter that matters: only a company that is STILL
  // closed. A concurrent purge must not race this into resurrecting a shell.
  await db.patch(
    "companies",
    { id: "eq." + companyId, deleted_at: "not.is.null" },
    { deleted_at: null, purge_after: null },
  );

  await recordPlatformAudit(db, {
    script,
    companyId,
    action: "workspace.reopened",
    targetType: "company",
    targetId: companyId,
    before: { deleted_at: company.deleted_at, purge_after: company.purge_after },
    after: {
      deleted_at: null,
      purge_after: null,
      numbers_released_and_not_recoverable: released.length,
      subscription_status: company.subscription_status,
    },
  });

  console.log(`  ✔ ${company.name} is open again, and the purge clock is stopped.`);
  console.log("    Still to do, by hand:");
  if (released.length > 0) {
    console.log("      · tell them the number is gone, and offer a new one");
  }
  console.log("      · the owner resubscribes through the normal checkout\n");
});
