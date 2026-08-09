/**
 * #341 / D48 — DELETE /v1/company: closing a workspace, phase 1.
 *
 * What the customer experiences as deletion happens here and completes here:
 * the workspace closes, every member is signed out and their push
 * registrations go, the number is released and the subscription is cancelled.
 * The erasure itself (phase 2, docs/DELETION.md) runs after a 30-day window.
 *
 * THE SPLIT IS FORCED, not a preference. Storage, Stripe and Telnyx are not
 * transactional, so a synchronous "delete everything now" across 38
 * company-referencing relationships and three buckets can fail halfway with no
 * way back — a workspace left half-erased, some data gone, the row intact, the
 * customer told nothing useful. One transactional state change plus a
 * resumable job is the only shape that cannot do that.
 *
 * OWNER ONLY. An admin can remove members; ending the business's account is
 * the owner's alone.
 *
 * The external steps are best-effort AFTER the transaction, in the order that
 * costs the customer least if one fails: sessions first (access must end even
 * if Telnyx is down), then the number, then Stripe. Each is safely repeatable,
 * and the purge sweep re-attempts what did not land.
 */
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { z } from "zod";

import { recordAuditFromRequest } from "../audit/log";
import { requireCapability } from "../auth/company";
import { revokeSessions } from "../auth/revoke-sessions";
import { requireActionConfirmation } from "../auth/confirm-action";
import { idempotencyKey } from "../billing/idempotency";
import { getStripe } from "../billing/stripe";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv, type Env } from "../env";
import { errorResponse } from "../http/errors";
import { parseOptionalJsonBody } from "./core/http";
import { releaseCompanyNumbers } from "../telnyx/provisioning";
import {
  lookupUserEmail,
  sendDeletionEmail,
  workspaceClosedEmail,
} from "../workspace/deletion-emails";

export const workspaceClosureRoutes = new Hono<AppEnv>();

type Db = ReturnType<typeof getDb>;

interface CloseResult {
  outcome: "closed" | "already" | "not_found";
  purge_after?: string;
  user_ids?: string[];
  phone_number_ids?: string[];
  stripe_subscription_id?: string | null;
  stripe_customer_id?: string | null;
}

/**
 * The body exists only to carry the confirmation code (#537). A DELETE with a body is
 * already how `/v1/device-push-tokens` works, and the alternative — a code in a query
 * string — puts a credential in every access log between here and the customer.
 */
const closeSchema = z.object({
  confirmation_code: z.string().trim().min(1).max(16).optional(),
});

workspaceClosureRoutes.delete("/company", requireCapability("workspace.own"), async (c) => {
  const companyId = c.get("companyId");
  const env = getEnv(c.env);
  const db = getDb(env);

  // #537 audit: being the owner is not the same as being who you say you are, and a
  // stolen session answers the first question perfectly. Everybody is about to be
  // signed out and the number released — of the three things this file calls
  // irreversible, only the data comes back.
  const body = await parseOptionalJsonBody(c, closeSchema);
  const refused = await requireActionConfirmation(
    c,
    "close_workspace",
    "closing this workspace",
    body.confirmation_code,
  );
  if (refused) return refused;

  const { data, error } = await db.rpc("close_workspace", {
    p_company_id: companyId,
  });
  if (error) throw new Error(`close_workspace failed: ${error.message}`);
  const result = data as CloseResult;

  if (result.outcome === "not_found") {
    return errorResponse(c, "not_found", "No such workspace.");
  }
  if (result.outcome === "already") {
    // Idempotent: a retried request must not extend the window or re-run the
    // teardown. Report the state truthfully rather than pretending it just
    // happened.
    return c.json({
      already_closed: true,
      purge_after: result.purge_after ?? null,
      sessions_ended: 0,
      push_devices_removed: 0,
      numbers_released: 0,
      subscription_cancelled: false,
    });
  }

  const access = await endEveryMembersAccess(db, env, result.user_ids ?? []);
  const numbersReleased = await releaseNumbers(env, companyId);
  const subscriptionCancelled = await cancelSubscription(
    env,
    companyId,
    result.stripe_subscription_id ?? null,
  );

  // #371: the written record, sent to the owner who did it. Last of the
  // best-effort steps because it is the only one that costs the customer
  // nothing if it fails — and it is deliberately AFTER the teardown, so it can
  // say what actually happened rather than what was about to.
  const receiptSentTo = await mailTheOwner(env, db, c.get("userId"), companyId, {
    numbersReleased,
    subscriptionCancelled,
  });

  // #231: the end of a business's account is the single most consequential
  // thing anyone does in this product.
  await recordAuditFromRequest(db, c, {
    companyId,
    action: "workspace.closed",
    targetType: "company",
    targetId: companyId,
    after: {
      purge_after: result.purge_after ?? null,
      sessions_ended: access.sessions,
      push_devices_removed: access.devices,
      // The softphones too — a handset still ringing for a closed workspace is
      // exactly what somebody asks about afterwards.
      voice_credentials_revoked: access.voice,
      numbers_released: numbersReleased,
      subscription_cancelled: subscriptionCancelled,
      receipt_emailed: receiptSentTo,
    },
  });

  return c.json({
    already_closed: false,
    purge_after: result.purge_after ?? null,
    sessions_ended: access.sessions,
    push_devices_removed: access.devices,
    voice_credentials_revoked: access.voice,
    numbers_released: numbersReleased,
    subscription_cancelled: subscriptionCancelled,
    receipt_emailed: receiptSentTo,
  });
});

/**
 * The closure receipt (#371), and the address for the one that follows it.
 *
 * Two sends, 30 days apart, and only this moment has both an owner to ask and
 * a `company_members` row to ask it from — the purge deletes that table long
 * before it finishes. So the address is written to the workspace here and read
 * back by the sweep.
 *
 * Returns whether the customer has it in writing. Never throws: the workspace
 * is already closed, and a mail failure that surfaced as a 500 would tell an
 * owner their deletion did not happen when it entirely did.
 */
async function mailTheOwner(
  env: Env,
  db: Db,
  ownerUserId: string,
  companyId: string,
  outcome: { numbersReleased: number; subscriptionCancelled: boolean },
): Promise<boolean> {
  const email = await lookupUserEmail(db, ownerUserId);
  if (!email) return false;

  // Stored before the send, not after: a failed send is chased by us from
  // Sentry, and an address we never wrote down is one nobody can retry.
  const { data: company, error } = await db
    .from("companies")
    .update({ purge_receipt_email: email })
    .eq("id", companyId)
    .select("name,purge_after")
    .maybeSingle();
  if (error) {
    Sentry.captureMessage(
      `workspace close: receipt address not stored for ${companyId}: ${error.message}`,
      "error",
    );
  }

  const row = (company ?? null) as { name?: string; purge_after?: string } | null;
  const receipt = await sendDeletionEmail(
    env,
    email,
    workspaceClosedEmail({
      companyName: row?.name ?? "Your workspace",
      purgeAfter: row?.purge_after ?? null,
      numbersReleased: outcome.numbersReleased,
      subscriptionCancelled: outcome.subscriptionCancelled,
    }),
    `workspace close ${companyId}`,
  );

  // #386 ask 4: store the id the delivery outcome will be recorded against.
  // A Law 25 or PIPEDA request asks whether we RESPONDED — this turns "we
  // handed it to a queue" into "delivered at 14:02", or into an honest "it
  // bounced" that somebody can act on while the address still exists.
  if (receipt.emailId) {
    const { error: stampError } = await db
      .from("companies")
      .update({ purge_receipt_email_id: receipt.emailId })
      .eq("id", companyId);
    if (stampError) {
      // Never fatal: the receipt was sent, and losing the reference costs
      // evidence rather than the response itself.
      Sentry.captureMessage(
        `workspace close: receipt id not stored for ${companyId}: ${stampError.message}`,
        "error",
      );
    }
  }
  return receipt.sent;
}

/**
 * Every member signed out and unsubscribed from push — deactivated ones
 * included, because somebody removed last week can still hold a live session
 * and a workspace that is closed must be closed to all of them.
 *
 * Push rows are per person, not per workspace, so they are only removed for a
 * member whose LAST workspace this was; otherwise closing one workspace would
 * silence another one's customer messages on the same phone.
 */
async function endEveryMembersAccess(
  db: Db,
  env: Env,
  userIds: readonly string[],
): Promise<{ sessions: number; devices: number; voice: number }> {
  let ended = 0;
  let devices = 0;
  let voice = 0;
  for (const userId of userIds) {
    try {
      // Through the shared path, which also deletes each member's softphone
      // credential at Telnyx. This used to call `api_revoke_user_sessions`, a
      // wrapper returning a bare count, and nothing here ever spoke to Telnyx at
      // all — so closing a workspace deleted every credential ROW and left every
      // credential alive at the provider. A handset that had already registered
      // went on ringing for a business that no longer exists, and could answer a
      // customer as it.
      const result = await revokeSessions(db, env, {
        userId,
        sessionIds: null,
        except: null,
        actor: null,
        reason: "member_removed",
      });
      ended += result.sessions;
      devices += result.devices;
      voice += result.voice;
    } catch (cause) {
      Sentry.captureMessage(
        `workspace close: session revoke failed for ${userId}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        "error",
      );
    }
    const { data: others, error: othersError } = await db
      .from("company_members")
      .select("company_id, companies!inner(deleted_at)")
      .eq("user_id", userId)
      .is("companies.deleted_at", null);
    if (othersError) continue;
    if ((others ?? []).length > 0) continue; // still somewhere else — keep push
    for (const table of ["push_subscriptions", "device_push_tokens"] as const) {
      // `.select()` is not decoration: PostgREST returns the removed rows only
      // when asked, and without it there is no way to say how many devices
      // actually went quiet.
      const { data, error } = await db
        .from(table)
        .delete()
        .eq("user_id", userId)
        .select("id");
      if (error) {
        Sentry.captureMessage(
          `workspace close: ${table} cleanup failed for ${userId}: ${error.message}`,
          "error",
        );
        continue;
      }
      devices += (data ?? []).length;
    }
  }
  return { sessions: ended, devices, voice };
}

/**
 * Release the numbers. Chargeable and worth nothing to a closed workspace, so
 * this does not wait for the purge window — but it is also the step that
 * cannot be undone, which is why the copy says the number is gone for good
 * rather than implying a reopened workspace comes back whole.
 */
async function releaseNumbers(env: Env, companyId: string): Promise<number> {
  try {
    // The same release the grace-expiry path uses (SPEC §9/§11): it already
    // handles purchased vs hosted, converges on a 404 from Telnyx, and reports
    // per-number failures in aggregate.
    const released = await releaseCompanyNumbers(env, companyId);
    return released.length;
  } catch (cause) {
    // Never fatal: a carrier blip must not leave the workspace open. The
    // customer asked to leave, and a number we still hold is a cost to US, not
    // a risk to them — the daily release cron re-attempts it.
    Sentry.captureMessage(
      `workspace close: number release failed for ${companyId}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      "error",
    );
    return 0;
  }
}

/** Stop the billing. The customer asked to leave; they should not be charged. */
async function cancelSubscription(
  env: Env,
  companyId: string,
  subscriptionId: string | null,
): Promise<boolean> {
  if (!subscriptionId) return false;
  try {
    await getStripe(env).subscriptions.cancel(subscriptionId, undefined, {
      // Derived key: a retried close replays the cancel instead of erroring on
      // an already-cancelled subscription.
      idempotencyKey: idempotencyKey(companyId, "workspace_close", subscriptionId),
    });
    return true;
  } catch (cause) {
    Sentry.captureMessage(
      `workspace close: subscription cancel failed for ${companyId}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      "error",
    );
    return false;
  }
}
