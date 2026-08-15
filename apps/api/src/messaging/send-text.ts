import { estimateSegments, formatNanpNumber } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { assertNumberLevel } from "../auth/number-access";
import type { MemberRole } from "../context";
import type { Env } from "../env";
import { ApiError } from "../http/errors";
import { unwrap } from "../routes/core/http";
import { MMS_SEGMENTS } from "./media";
import { applySendMergeFields, resolveSendMergeFields } from "./merge";
import {
  dispatchOutbound,
  gateOutboundSend,
  runPreSendGates,
} from "./send";
import type { MessageRow } from "./types";

/**
 * #243 — the ONE outbound text sequence, so there is never a second one.
 *
 * ## Why this exists
 *
 * The public API needs to send a message, and the order this runs in IS a
 * safety rule: number level, then the pre-send gates (subscription →
 * destination → registration), then merge fields, then the atomic
 * opt-out/rate/cap insert, then dispatch. Reproducing that order in a second
 * route would put the opt-out gate in two places, and opt-out is carrier truth
 * — a STOP can only be lifted by the customer, and a path that checks it
 * second-hand is a compliance failure with a real person on the other end.
 *
 * So both routes call this. `/v1/messages/send` keeps what is genuinely its
 * own — decoded media, the saved-reply counter, the response shape — and hands
 * the sequence here.
 *
 * ## What is deliberately NOT here
 *
 * Media. The public API accepts text only in v1, and threading an
 * upload-and-sign step through a function whose other caller never uses it
 * would make the shared path carry a branch for one of its two callers. The
 * first-party route does its own upload between the gate and the dispatch,
 * which is where it has always happened, and passes the resulting URLs in.
 */

export interface ConversationSendView {
  id: string;
  contact_id: string;
  phone_number_id: string;
  /**
   * #291: the number this THREAD is with, which is the destination. A
   * contact's PRIMARY is a different number the moment they have two, and a
   * text to the wrong line is indistinguishable from one that never sent.
   */
  contact_phone_e164: string;
  contacts: {
    id: string;
    name: string | null;
    address: string | null;
    timezone: string | null;
  };
  phone_numbers: { id: string; number_e164: string | null; status: string };
  companies: { id: string; name: string };
}

/** Conversation + contact + number + company, company-scoped (§10). */
export async function loadSendView(
  db: SupabaseClient,
  companyId: string,
  conversationId: string,
): Promise<ConversationSendView> {
  const rows = unwrap<ConversationSendView[]>(
    await db
      .from("conversations")
      .select(
        "id,contact_id,phone_number_id,contact_phone_e164," +
          // #274: address + timezone on a query already running, so
          // {address} and the visit day/time cost nothing extra.
          "contacts(id,name,address,timezone)," +
          "phone_numbers(id,number_e164,status)," +
          "companies(id,name)",
      )
      .eq("company_id", companyId)
      .eq("id", conversationId)
      .limit(1),
    "conversation lookup",
  );
  const view = rows[0];
  if (!view) throw new ApiError("not_found", "No such conversation.");
  return view;
}

/**
 * #46: the conversation's sending number must be provisioned AND `active`
 * (the same gate compose enforces). Numbers keep their e164 forever after
 * release, and old conversations still reference them — sending from a
 * released/suspended number would die at Telnyx with an opaque carrier error,
 * or worse, go out from a number the company no longer pays for. Returns the
 * usable from-number.
 */
export function requireActiveSendingNumber(view: ConversationSendView): string {
  const fromNumber = view.phone_numbers.number_e164;
  if (!fromNumber) {
    throw new ApiError(
      "conflict",
      "This conversation's number is still provisioning.",
    );
  }
  if (view.phone_numbers.status !== "active") {
    throw new ApiError(
      "conflict",
      "This conversation's number is not active, so it can't send texts.",
    );
  }
  return fromNumber;
}

export interface PreparedSend {
  view: ConversationSendView;
  fromNumber: string;
  /** The body after merge fields, which is what actually goes out. */
  text: string;
  clearance: Awaited<ReturnType<typeof runPreSendGates>>;
  segmentsEstimate: number;
}

/**
 * Everything before the gate insert: load, check the number level, run the
 * pre-send gates, resolve merge fields, and estimate segments.
 *
 * Split from the dispatch half because the first-party route has to upload
 * media BETWEEN them — after the gate has inserted the queued row, before the
 * carrier call — and #20's lesson is that a throw in that window must fail the
 * row out rather than leave it stuck `queued` forever.
 */
export async function prepareSend(
  env: Env,
  db: SupabaseClient,
  input: {
    companyId: string;
    conversationId: string;
    userId: string;
    role: MemberRole;
    body: string;
    /** MMS meters as 3 segments; text estimates its own. */
    hasMedia: boolean;
  },
): Promise<PreparedSend> {
  const view = await loadSendView(db, input.companyId, input.conversationId);

  // #106: sending needs level 'text' on the conversation's number (notes-only
  // members get the honest 403; hidden numbers already 404 upstream).
  await assertNumberLevel(db, {
    companyId: input.companyId,
    userId: input.userId,
    role: input.role,
    phoneNumberId: view.phone_number_id ?? null,
    need: "text",
  });
  const fromNumber = requireActiveSendingNumber(view);

  // §7 gate order: subscription → destination US/CA → registration.
  const clearance = await runPreSendGates(
    env,
    input.companyId,
    view.contact_phone_e164,
  );

  // Step 0a merge-fields: applied server-side at SEND time, reusing the
  // contact + company already loaded here. {my_name} and the visit day/time
  // each cost a read, so this fetches them ONLY when the text asks — a message
  // with no tokens, which is almost all of them, does no work at all.
  const resolved = await resolveSendMergeFields(db, input.body, {
    companyId: input.companyId,
    conversationId: view.id,
    userId: input.userId,
    timeZone: view.contacts.timezone ?? null,
  });
  const text = applySendMergeFields(input.body, {
    contactName: view.contacts.name,
    businessName: view.companies.name,
    contactAddress: view.contacts.address,
    ourNumber: formatNanpNumber(fromNumber),
    ...resolved,
  });

  return {
    view,
    fromNumber,
    text,
    clearance,
    segmentsEstimate: input.hasMedia ? MMS_SEGMENTS : estimateSegments(text).segments,
  };
}

/**
 * The whole sequence, for a caller with no media.
 *
 * Returns the existing row untouched on an idempotency replay, exactly as the
 * first-party route does — a duplicate request must never reach the carrier.
 */
export async function sendTextToConversation(
  env: Env,
  db: SupabaseClient,
  input: {
    companyId: string;
    conversationId: string;
    userId: string;
    role: MemberRole;
    body: string;
    idempotencyKey: string;
  },
): Promise<{ message: MessageRow; existing: boolean }> {
  const prepared = await prepareSend(env, db, { ...input, hasMedia: false });

  // §7/§10: opt-out → rate → cap, atomic with the queued insert.
  const { message, existing } = await gateOutboundSend(db, {
    companyId: input.companyId,
    conversationId: prepared.view.id,
    senderUserId: input.userId,
    body: prepared.text,
    idempotencyKey: input.idempotencyKey,
    segmentsEstimate: prepared.segmentsEstimate,
  });

  if (existing) {
    if (message.conversation_id !== prepared.view.id) {
      throw new ApiError(
        "conflict",
        "Idempotency-Key was already used for a different conversation.",
      );
    }
    return { message, existing: true };
  }

  const sent = await dispatchOutbound(env, db, message, {
    from: prepared.fromNumber,
    to: prepared.view.contact_phone_e164,
    text: prepared.text,
    mediaUrls: [],
    clearance: prepared.clearance,
  });
  return { message: sent, existing: false };
}
