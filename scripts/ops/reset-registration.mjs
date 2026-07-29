/**
 * [#404 / #352] Put a rejected 10DLC registration back into a state the
 * customer can act on.
 *
 *   node scripts/ops/reset-registration.mjs --company <uuid>
 *   node scripts/ops/reset-registration.mjs --company <uuid> --apply
 *
 * A rejected brand or campaign is terminal in the product: the wizard has
 * nothing left to do, US texting stays blocked, and the customer is stuck
 * looking at a rejection reason with no button. The fix has been a hand-written
 * UPDATE to move `status` back to draft.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO, and it is the important part.
 *
 * It does not resubmit anything and it does not touch Telnyx. A rejection came
 * from the carrier, and re-submitting the SAME data gets the same answer plus
 * another submission on the count — several of which start costing money and
 * attracting attention. So this only re-opens the wizard so the customer can
 * CORRECT the thing that was wrong; the submission itself goes through the
 * normal route, with its own gates.
 *
 * `rejection_reason` is deliberately preserved. It is the only record of what
 * the carrier objected to, and clearing it would leave the customer editing
 * blind.
 */
import { fail, recordPlatformAudit, runScript, showRows } from "./lib.mjs";

await runScript("reset-registration", async ({ args, apply, db, script }) => {
  const companyId = typeof args.company === "string" ? args.company : null;
  if (!companyId) fail("--company <uuid> is required.");

  const registrations = await db.select(
    "messaging_registrations",
    "id,kind,status,rejection_reason,submission_count,rejected_at",
    { company_id: "eq." + companyId },
  );
  showRows("registrations", registrations);

  const rejected = registrations.filter((r) => r.status === "rejected");
  if (rejected.length === 0) {
    console.log("  Nothing is rejected. Nothing to reset.\n");
    return;
  }

  for (const row of rejected) {
    if (row.submission_count >= 3) {
      // Three rejections is not a data-entry problem any more. Resetting for a
      // fourth attempt spends money to be told the same thing again.
      console.log(
        `  ⚠ the ${row.kind} has been submitted ${row.submission_count} times.\n` +
          "    Read the rejection reason with the customer before resetting —\n" +
          "    another identical submission will be rejected identically.\n",
      );
    }
  }

  if (!apply) return;

  for (const row of rejected) {
    // Only from rejected. A concurrent webhook moving this row to approved
    // must not be stomped back to draft by a support script.
    await db.patch(
      "messaging_registrations",
      {
        id: "eq." + row.id,
        company_id: "eq." + companyId,
        status: "eq.rejected",
      },
      { status: "draft", rejected_at: null },
    );

    await recordPlatformAudit(db, {
      script,
      companyId,
      action: "registration.reset",
      targetType: "messaging_registration",
      targetId: row.id,
      before: { status: "rejected", submission_count: row.submission_count },
      // The reason is kept, so the record shows what they were correcting.
      after: { status: "draft", rejection_reason: row.rejection_reason },
    });
  }

  console.log(
    `  ✔ ${rejected.length} registration(s) back to draft. The customer can\n` +
      "    edit and resubmit from Settings → Numbers. Nothing was sent to\n" +
      "    Telnyx by this script.\n",
  );
});
