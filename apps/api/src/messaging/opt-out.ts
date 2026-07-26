/**
 * #331 — carrier-sourced opt-outs, and the one place they are written.
 *
 * SPEC §5 records that manual opt-outs are enforced app-side only: Telnyx has
 * no write API for its opt-out list, and its profile keyword block only ever
 * catches an exact STOP. So the two lists can diverge, and until now nothing
 * noticed. Two signals say the carrier knows something we do not:
 *
 *   1. A send comes back **40300**. Telnyx is refusing delivery to this
 *      number. We recorded that as a failed message and moved on, which meant
 *      the next send tried again, failed again, and the composer stayed open
 *      the whole time.
 *   2. The daily reconciliation finds a number on Telnyx's opt-out list that
 *      is not on ours — an inbound STOP whose webhook we missed.
 *
 * Both are the same fact: a customer told this business to stop, and the
 * carrier heard it when we did not. Recording it with source `carrier` rather
 * than `stop_keyword` keeps the difference legible — one says we saw the
 * keyword, the other says we did not and found out afterwards. That
 * distinction is what makes the reconciliation report readable and what tells
 * a support conversation whether a webhook was dropped.
 *
 * WE NEVER LIFT ONE. `revokeOptOut` refuses `carrier` exactly as it refuses
 * `stop_keyword`: clearing our row does not clear Telnyx's, so the contact
 * page would claim the person is textable while every send came back 40300.
 * Only the customer texting START lifts it.
 */
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAudit } from "../audit/log";

/** How a carrier opt-out reached us. Recorded verbatim on the timeline. */
export type CarrierOptOutSignal =
  /** A send was refused with Telnyx code 40300. */
  | "send_rejected"
  /** The daily reconciliation found it on the carrier's list and not ours. */
  | "reconciliation";

export interface CarrierOptOutInput {
  companyId: string;
  phoneE164: string;
  signal: CarrierOptOutSignal;
  /**
   * The thread it happened in, when there is one. The reconciliation has no
   * conversation to point at, which the `conversation_events_conv_required`
   * check already permits for `opted_out`.
   */
  conversationId?: string | null;
  /** Carrier detail worth keeping, e.g. the 40300 error text. Never a body. */
  detail?: string | null;
}

/**
 * Record one, idempotently, and leave a trail in all three places a person
 * might look: the opt-out list, the conversation timeline, and the audit log.
 *
 * Returns whether this CHANGED anything. A number already opted out is the
 * common case (a second send to the same blocked number) and must not write a
 * second timeline event — the state transition is the arbiter, the same way
 * the manual opt-out route decides.
 *
 * NEVER THROWS. Every caller is doing something else that already succeeded or
 * already failed for its own reasons: a send whose failure is being persisted,
 * a nightly sweep partway through a list. Losing the record is worth a Sentry
 * error, never a thrown one.
 */
export async function recordCarrierOptOut(
  db: SupabaseClient,
  input: CarrierOptOutInput,
): Promise<boolean> {
  try {
    // Resurrect a revoked row first, then try a fresh insert that yields
    // nothing on conflict. Whichever returns a row is the transition; if
    // neither does, the number was already opted out and there is nothing new
    // to say. Same shape as the manual route, for the same race.
    const revived = await db
      .from("opt_outs")
      .update({ source: "carrier", created_by: null, revoked_at: null })
      .eq("company_id", input.companyId)
      .eq("phone_e164", input.phoneE164)
      .not("revoked_at", "is", null)
      .select("id");
    if (revived.error) throw new Error(revived.error.message);

    let changed = (revived.data ?? []).length > 0;
    if (!changed) {
      const inserted = await db
        .from("opt_outs")
        .upsert(
          {
            company_id: input.companyId,
            phone_e164: input.phoneE164,
            source: "carrier",
            created_by: null, // the carrier acted, not a person
            revoked_at: null,
          },
          { onConflict: "company_id,phone_e164", ignoreDuplicates: true },
        )
        .select("id");
      if (inserted.error) throw new Error(inserted.error.message);
      changed = (inserted.data ?? []).length > 0;
    }

    if (!changed) return false;

    const { error: eventError } = await db.from("conversation_events").insert({
      company_id: input.companyId,
      conversation_id: input.conversationId ?? null,
      actor_user_id: null, // the carrier acted, not a person
      type: "opted_out",
      payload: {
        phone_e164: input.phoneE164,
        source: "carrier",
        signal: input.signal,
        ...(input.detail ? { detail: input.detail.slice(0, 500) } : {}),
      },
    });
    if (eventError) throw new Error(eventError.message);

    // #231: an opt-out is a change to who this business may contact, and the
    // one kind nobody on the crew can undo. It belongs on the timeline a
    // dispute is reconstructed from.
    await recordAudit(db, {
      companyId: input.companyId,
      actorUserId: null, // the carrier acted
      action: "opt_out.recorded",
      targetType: "contact",
      targetId: input.phoneE164,
      after: { source: "carrier", signal: input.signal },
    });
    return true;
  } catch (cause) {
    Sentry.captureMessage(
      `carrier opt-out not recorded for ${input.companyId} (${input.signal}): ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      "error",
    );
    return false;
  }
}

/**
 * The Telnyx error code for "this destination has opted out of messages from
 * this sender". The one carrier response that is information rather than a
 * fault: nothing is wrong with the request, the recipient said stop.
 */
export const TELNYX_OPT_OUT_ERROR_CODE = "40300";
