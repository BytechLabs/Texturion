/**
 * #346 — deleting your own account.
 *
 * Apple 5.1.1(v) requires in-app ACCOUNT deletion for any app with account
 * creation, and Play asks the same. Every deletion path we had was about
 * deleting a workspace, which most users cannot do: that is owner-only, and a
 * crew of field staff will never be one. A tech who wants to leave had no
 * mechanism at all — they could be removed by somebody else (#276), which is
 * not the same thing.
 *
 * COMPANY-EXEMPT, deliberately. This is about the person, not one of their
 * workspaces, and someone with no membership at all must still be able to
 * leave. Both routes act on the caller's own `userId` and nothing else — there
 * is no id parameter to get wrong.
 *
 * The shape is severance, not erasure: the personal data goes and the person
 * can never sign in again, while messages sent, tasks created, consent
 * attested and audit entries stay, attributed to a nameless former member.
 * They have to — 11 restrict foreign keys point at the auth user through those
 * records, the history belongs to the business, and the consent part of it is
 * under the CASL three-year floor.
 */
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";

import { recordAudit } from "../audit/log";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import {
  accountDeletedEmail,
  lookupUserEmail,
  sendDeletionEmail,
} from "../workspace/deletion-emails";

export const accountRoutes = new Hono<AppEnv>();

type Db = ReturnType<typeof getDb>;

interface Preview {
  blocked_by: "owner" | null;
  owned?: { id: string; name: string }[];
  memberships?: number;
  conversations?: number;
  tasks?: number;
}

/**
 * What deleting this account would do — so the confirmation can say it before
 * anything happens, including the one case where the answer is "not yet".
 */
accountRoutes.get("/account/deletion-preview", async (c) => {
  const db = getDb(getEnv(c.env));
  const { data, error } = await db.rpc("account_deletion_preview", {
    p_user_id: c.get("userId"),
  });
  if (error) {
    throw new Error(`account_deletion_preview failed: ${error.message}`);
  }
  const preview = data as Preview;
  return c.json({
    blocked_by: preview.blocked_by,
    owned_workspaces: preview.owned ?? [],
    memberships: preview.memberships ?? 0,
    open_conversations: preview.conversations ?? 0,
    open_tasks: preview.tasks ?? 0,
  });
});

accountRoutes.delete("/account", async (c) => {
  const userId = c.get("userId");
  const env = getEnv(c.env);
  const db = getDb(env);

  const { data: previewData, error: previewError } = await db.rpc(
    "account_deletion_preview",
    { p_user_id: userId },
  );
  if (previewError) {
    throw new Error(`account_deletion_preview failed: ${previewError.message}`);
  }
  const preview = previewData as Preview;
  if (preview.blocked_by === "owner") {
    // Specific, not generic: an owner deleting their account would strand a
    // workspace with no owner and no transfer path (#332). Name the
    // workspaces, and say what to do about them.
    const names = (preview.owned ?? []).map((row) => row.name).join(", ");
    return errorResponse(
      c,
      "conflict",
      `You own ${names}. Hand each one to someone else, or close it, and then you can delete your account.`,
    );
  }

  // Every workspace they belong to gets the #276 offboarding: open work
  // released to the crew, softphone revoked, the removal on the audit log.
  // Releasing rather than reassigning is the honest default — the person is
  // leaving and there is nobody to nominate on their behalf.
  const memberships = await listMemberships(db, userId);
  for (const membership of memberships) {
    const { data, error } = await db.rpc("offboard_member", {
      p_company_id: membership.company_id,
      p_member_id: membership.id,
      p_reassign_to: null,
    });
    if (error) {
      throw new Error(`offboard_member failed: ${error.message}`);
    }
    const result = data as { conversations?: number; tasks?: number };
    // #231: the business's record of why one of its people vanished.
    await recordAudit(db, {
      companyId: membership.company_id,
      actorUserId: userId,
      action: "member.deactivated",
      targetType: "member",
      targetId: membership.id,
      after: {
        reason: "account_deleted",
        conversations_moved: Number(result.conversations ?? 0),
        tasks_moved: Number(result.tasks ?? 0),
      },
    });
  }

  const { data, error } = await db.rpc("delete_account", { p_user_id: userId });
  if (error) throw new Error(`delete_account failed: ${error.message}`);
  const result = data as { outcome: string; personal_rows?: number };
  if (result.outcome === "owner") {
    // Raced: they became an owner between the preview and here.
    return errorResponse(
      c,
      "conflict",
      "You own a workspace. Hand it to someone else, or close it, and then you can delete your account.",
    );
  }

  // #371 — the receipt, and the ORDERING IS THE WHOLE POINT. `severAuthIdentity`
  // replaces the address with a non-routable `.invalid` one, so a receipt sent
  // afterwards has nowhere to go. It goes now, while the address still exists.
  const receiptSent = await sendDeletionEmail(
    env,
    await lookupUserEmail(db, userId),
    accountDeletedEmail({ workspacesLeft: memberships.length }),
    `account deletion ${userId}`,
  );

  await severAuthIdentity(db, userId);

  return c.json({
    deleted: true,
    workspaces_left: memberships.length,
    personal_rows_removed: Number(result.personal_rows ?? 0),
    receipt_emailed: receiptSent,
  });
});

async function listMemberships(
  db: Db,
  userId: string,
): Promise<{ id: string; company_id: string }[]> {
  const { data, error } = await db
    .from("company_members")
    .select("id,company_id,companies!inner(deleted_at)")
    .eq("user_id", userId)
    .is("companies.deleted_at", null);
  if (error) throw new Error(`membership lookup failed: ${error.message}`);
  return (data ?? []) as { id: string; company_id: string }[];
}

/**
 * The auth identity: email, password, linked sign-in providers, metadata.
 *
 * The row itself cannot go — 11 restrict foreign keys reach it — so it is
 * emptied instead and permanently banned. Afterwards there is no address to
 * mail, no credential to present and no provider to sign in with: the account
 * is gone in every sense a person experiences, and what is left is a foreign
 * key with nothing attached to it.
 *
 * Best-effort AFTER the data is already gone: failing the request here would
 * tell someone their deletion did not happen when most of it did. It raises in
 * Sentry instead, because an identity we failed to sever is ours to finish.
 */
async function severAuthIdentity(db: Db, userId: string): Promise<void> {
  try {
    const { error } = await db.auth.admin.updateUserById(userId, {
      // Unique and non-routable: RFC 2606 reserves .invalid for exactly this.
      email: `deleted-${userId}@account.invalid`,
      phone: "",
      user_metadata: {},
      app_metadata: {},
      // "none" is GoTrue's forever.
      ban_duration: "876000h",
    });
    if (error) throw new Error(error.message);
  } catch (cause) {
    Sentry.captureMessage(
      `account deletion: auth identity not severed for ${userId}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      "error",
    );
  }
}
