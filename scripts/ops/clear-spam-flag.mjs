/**
 * [#404 / #342] Un-mark a conversation somebody flagged as spam by mistake.
 *
 *   node scripts/ops/clear-spam-flag.mjs --company <uuid> --conversation <uuid>
 *   node scripts/ops/clear-spam-flag.mjs --company <uuid> --conversation <uuid> --apply
 *
 * A spam mark silences a real customer, and the person it silences is the one
 * least able to tell you: their texts simply stop appearing. Until now the fix
 * was a hand-written UPDATE, which is the same statement with none of the
 * guards — and a missing `and company_id = ...` on that statement is another
 * workspace's conversation.
 *
 * The company id is required and applied as a filter, not just printed, so
 * this physically cannot reach across tenants even if the wrong conversation
 * id is pasted in.
 */
import { fail, recordPlatformAudit, runScript, showRows } from "./lib.mjs";

await runScript("clear-spam-flag", async ({ args, apply, db, script }) => {
  const companyId = typeof args.company === "string" ? args.company : null;
  const conversationId =
    typeof args.conversation === "string" ? args.conversation : null;
  if (!companyId || !conversationId) {
    fail("--company <uuid> and --conversation <uuid> are both required.");
  }

  // The tenant filter is a FILTER, not a check afterwards: the query cannot
  // return another workspace's row to be accidentally acted on.
  const rows = await db.select(
    "conversations",
    "id,company_id,contact_id,is_spam,spam_reviewed_at,status",
    { id: "eq." + conversationId, company_id: "eq." + companyId },
  );
  const conversation = rows[0];
  if (!conversation) {
    fail(
      `no conversation ${conversationId} in company ${companyId}. ` +
        "Check both ids — a mismatch here is usually the wrong workspace.",
    );
  }

  if (!conversation.is_spam) {
    console.log("  Not marked as spam. Nothing to clear.\n");
    return;
  }

  showRows("conversation", [conversation]);

  if (!apply) return;

  await db.patch(
    "conversations",
    { id: "eq." + conversationId, company_id: "eq." + companyId },
    { is_spam: false, spam_reviewed_at: new Date().toISOString() },
  );

  await recordPlatformAudit(db, {
    script,
    companyId,
    action: "spam.cleared",
    targetType: "conversation",
    targetId: conversationId,
    before: { is_spam: true },
    after: { is_spam: false },
  });

  console.log("  ✔ Cleared. Their messages appear in the inbox again.\n");
});
