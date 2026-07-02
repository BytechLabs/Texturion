/**
 * POST /v1/conversations — outbound-first compose (SPEC §5, §7). POST only:
 * the conversations track owns the GET/PATCH surface. Mounted by the
 * integration layer at /v1.
 *
 *   { contact_id | phone_e164, phone_number_id, body, consent_attested: true,
 *     quiet_hours_confirmed? } + Idempotency-Key
 *
 *   • consent attestation REQUIRED (422 without) — writes
 *     consent_source='attested' (+at/+by) on the contact and a
 *     consent_attested event (§5, D4).
 *   • quiet hours (soft, §5): destination local hour outside 08–20 requires
 *     quiet_hours_confirmed=true (409 `quiet_hours_confirmation_required`
 *     otherwise); confirmed sends log a quiet_hours_confirmed event.
 *   • open-conversation conflict (conversations_open_uq): append to the
 *     existing open conversation and return it with 200 — gates and
 *     attestation still apply and are recorded.
 *   • the send itself runs the §7 gate order via the shared send core.
 */
import { destinationLocalHour, estimateSegments } from "@jobtext/shared";
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError } from "../http/errors";
import {
  appendIdentificationFooter,
  conversationHasInbound,
  dispatchOutbound,
  gateOutboundSend,
  runPreSendGates,
  stampFirstIdentification,
} from "../messaging/send";
import type { MessageRow } from "../messaging/types";
import {
  insertConversationEvents,
  type ConversationEventRow,
} from "./core/events";
import { normalizeNanpPhone } from "./core/phone";
import { isUniqueViolation, parseJsonBody, unwrap } from "./core/http";
import { requireIdempotencyKey } from "./messages";

const composeSchema = z
  .object({
    contact_id: z.uuid().optional(),
    phone_e164: z.string().trim().min(1).optional(),
    phone_number_id: z.uuid(),
    body: z.string().max(4096).refine((value) => value.trim().length > 0, {
      message: "body must not be empty.",
    }),
    // D4: the one mandatory checkbox — "This customer asked us to text them".
    consent_attested: z.literal(true),
    quiet_hours_confirmed: z.boolean().optional(),
  })
  .refine(
    (value) => (value.contact_id === undefined) !== (value.phone_e164 === undefined),
    { message: "Provide exactly one of contact_id or phone_e164." },
  );

const CONVERSATION_COLUMNS =
  "id,company_id,contact_id,phone_number_id,status,is_spam,assigned_user_id," +
  "last_message_at,closed_at,created_at,updated_at";

interface ContactRow {
  id: string;
  phone_e164: string;
  consent_source: string | null;
  first_identification_sent_at: string | null;
}

type Db = ReturnType<typeof getDb>;

/**
 * Resolve + attest the target contact (§5): existing contacts are
 * resurrected (deleted_at cleared) and attested when they carry no consent
 * yet (inbound_sms consent is never downgraded); new contacts are created
 * attested. Returns the contact with its PRE-SEND footer state.
 */
async function resolveAttestedContact(
  db: Db,
  args: {
    companyId: string;
    userId: string;
    contactId?: string;
    phoneE164?: string;
  },
): Promise<ContactRow> {
  const attestation = {
    consent_source: "attested",
    consent_at: new Date().toISOString(),
    consent_attested_by: args.userId,
  };
  const columns =
    "id,phone_e164,consent_source,first_identification_sent_at";

  if (args.contactId) {
    const rows = unwrap<ContactRow[]>(
      await db
        .from("contacts")
        .select(columns)
        .eq("company_id", args.companyId)
        .eq("id", args.contactId)
        .limit(1),
      "contact lookup",
    );
    const contact = rows[0];
    if (!contact) throw new ApiError("not_found", "No such contact.");
    const updated = unwrap<ContactRow[]>(
      await db
        .from("contacts")
        .update({
          deleted_at: null,
          ...(contact.consent_source === null ? attestation : {}),
        })
        .eq("company_id", args.companyId)
        .eq("id", contact.id)
        .select(columns),
      "contact attest",
    )[0];
    return updated ?? contact;
  }

  const phone = normalizeNanpPhone(args.phoneE164 ?? "");
  if (!phone) {
    throw new ApiError(
      "validation_failed",
      "phone_e164 must be a valid US or Canada number.",
    );
  }

  const existing = unwrap<ContactRow[]>(
    await db
      .from("contacts")
      .select(columns)
      .eq("company_id", args.companyId)
      .eq("phone_e164", phone)
      .limit(1),
    "contact lookup",
  )[0];
  if (existing) {
    const updated = unwrap<ContactRow[]>(
      await db
        .from("contacts")
        .update({
          deleted_at: null,
          ...(existing.consent_source === null ? attestation : {}),
        })
        .eq("company_id", args.companyId)
        .eq("id", existing.id)
        .select(columns),
      "contact attest",
    )[0];
    return updated ?? existing;
  }

  const inserted = await db
    .from("contacts")
    .insert({
      company_id: args.companyId,
      phone_e164: phone,
      ...attestation,
    })
    .select(columns);
  if (inserted.error) {
    if (isUniqueViolation(inserted.error)) {
      // Concurrent create won: re-select and attest that row.
      return resolveAttestedContact(db, {
        companyId: args.companyId,
        userId: args.userId,
        phoneE164: phone,
      });
    }
    throw new Error(`contact insert failed: ${inserted.error.message}`);
  }
  const row = (inserted.data ?? [])[0] as ContactRow | undefined;
  if (!row) throw new Error("contact insert returned no row");
  return row;
}

/**
 * Create the outbound-first conversation (status 'open', §6) or — on the
 * conversations_open_uq conflict — append to the existing open one (§7).
 */
async function createOrReuseConversation(
  db: Db,
  args: { companyId: string; contactId: string; phoneNumberId: string },
): Promise<{ conversation: Record<string, unknown>; created: boolean }> {
  const inserted = await db
    .from("conversations")
    .insert({
      company_id: args.companyId,
      contact_id: args.contactId,
      phone_number_id: args.phoneNumberId,
      status: "open",
    })
    .select(CONVERSATION_COLUMNS);
  if (!inserted.error) {
    const row = (inserted.data ?? [])[0] as unknown as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new Error("conversation insert returned no row");
    return { conversation: row, created: true };
  }
  if (!isUniqueViolation(inserted.error)) {
    throw new Error(`conversation insert failed: ${inserted.error.message}`);
  }

  const rows = unwrap<Record<string, unknown>[]>(
    await db
      .from("conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("company_id", args.companyId)
      .eq("contact_id", args.contactId)
      .eq("phone_number_id", args.phoneNumberId)
      .is("closed_at", null)
      .limit(1),
    "open conversation lookup",
  );
  const row = rows[0];
  if (!row) throw new Error("open conversation vanished after conflict");
  return { conversation: row, created: false };
}

export const composeRoutes = new Hono<AppEnv>();

composeRoutes.post("/conversations", requireRole("member"), async (c) => {
  const env = getEnv(c.env);
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const idempotencyKey = requireIdempotencyKey(c);
  const body = await parseJsonBody(c, composeSchema);
  const db = getDb(env);

  // Idempotent replay (§7): the same key returns the existing conversation
  // and message with 200 — before re-running any side effect.
  const replay = unwrap<MessageRow[]>(
    await db
      .from("messages")
      .select("*")
      .eq("company_id", companyId)
      .eq("idempotency_key", idempotencyKey)
      .limit(1),
    "idempotency lookup",
  )[0];
  if (replay) {
    const conversation = unwrap<Record<string, unknown>[]>(
      await db
        .from("conversations")
        .select(CONVERSATION_COLUMNS)
        .eq("company_id", companyId)
        .eq("id", replay.conversation_id)
        .limit(1),
      "conversation lookup",
    )[0];
    return c.json({ conversation, message: stripTsv(replay) }, 200);
  }

  // Sending number: must belong to the company and be usable.
  const number = unwrap<
    { id: string; number_e164: string | null; status: string }[]
  >(
    await db
      .from("phone_numbers")
      .select("id,number_e164,status")
      .eq("company_id", companyId)
      .eq("id", body.phone_number_id)
      .limit(1),
    "phone number lookup",
  )[0];
  if (!number) throw new ApiError("not_found", "No such phone number.");
  if (!number.number_e164 || number.status !== "active") {
    throw new ApiError("conflict", "This number is not ready to send yet.");
  }

  // Company (footer business name — §5).
  const company = unwrap<{ id: string; name: string }[]>(
    await db
      .from("companies")
      .select("id,name")
      .eq("id", companyId)
      .limit(1),
    "company lookup",
  )[0];
  if (!company) throw new ApiError("not_found", "No such company.");

  // Destination phone BEFORE any write: contact_id path reads the stored
  // number; phone path normalizes + NANP-validates (422 — §10 layer 2).
  let destination: string;
  if (body.contact_id) {
    const rows = unwrap<{ phone_e164: string }[]>(
      await db
        .from("contacts")
        .select("phone_e164")
        .eq("company_id", companyId)
        .eq("id", body.contact_id)
        .limit(1),
      "contact lookup",
    );
    if (!rows[0]) throw new ApiError("not_found", "No such contact.");
    destination = rows[0].phone_e164;
  } else {
    const normalized = normalizeNanpPhone(body.phone_e164 ?? "");
    if (!normalized) {
      throw new ApiError(
        "validation_failed",
        "phone_e164 must be a valid US or Canada number.",
      );
    }
    destination = normalized;
  }

  // §7 gate order: subscription → destination → registration.
  await runPreSendGates(env, companyId, destination);

  // Quiet hours (soft, §5): 8pm–8am destination local time needs an explicit
  // confirmation; unknown local time (non-geographic code) skips the check.
  const hour = destinationLocalHour(destination, new Date());
  const quietHours = hour !== null && (hour >= 20 || hour < 8);
  if (quietHours && body.quiet_hours_confirmed !== true) {
    // Structural signal: dedicated code (409, same envelope) so the UI shows
    // the quiet-hours confirm dialog by CODE, not by sniffing the message.
    throw new ApiError(
      "quiet_hours_confirmation_required",
      `It's ${String(hour).padStart(2, "0")}:00 where this customer is. Confirm with quiet_hours_confirmed to send anyway.`,
    );
  }

  // Opt-out pre-check before creating rows (the gate RPC re-checks
  // atomically — this keeps a rejected compose from leaving an empty
  // conversation behind).
  const optOuts = unwrap<{ id: string }[]>(
    await db
      .from("opt_outs")
      .select("id")
      .eq("company_id", companyId)
      .eq("phone_e164", destination)
      .is("revoked_at", null)
      .limit(1),
    "opt-out lookup",
  );
  if (optOuts.length > 0) {
    throw new ApiError(
      "recipient_opted_out",
      "This recipient has opted out of receiving texts.",
    );
  }

  // Contact upsert + attestation (§5), then conversation create-or-append.
  const contact = await resolveAttestedContact(db, {
    companyId,
    userId,
    contactId: body.contact_id,
    phoneE164: body.phone_e164,
  });
  const { conversation, created } = await createOrReuseConversation(db, {
    companyId,
    contactId: contact.id,
    phoneNumberId: number.id,
  });

  // §5 footer: first outbound-first message ever sent to this contact —
  // an appended-to thread that contains inbound traffic is a reply, never
  // decorated.
  const footerNeeded =
    contact.first_identification_sent_at === null &&
    (created ||
      !(await conversationHasInbound(db, companyId, conversation.id as string)));
  const text = footerNeeded
    ? appendIdentificationFooter(body.body, company.name)
    : body.body;

  const { message, existing } = await gateOutboundSend(db, {
    companyId,
    conversationId: conversation.id as string,
    senderUserId: userId,
    body: text,
    idempotencyKey,
    segmentsEstimate: estimateSegments(text).segments,
  });
  if (existing) {
    // Concurrent duplicate replay landed between our fast-path and the RPC.
    return c.json({ conversation, message: stripTsv(message) }, 200);
  }

  if (footerNeeded) {
    await stampFirstIdentification(db, companyId, contact.id);
  }

  // Audit trail (§5): attestation always recorded; quiet-hours confirmation
  // recorded when it actually gated the send.
  const events: ConversationEventRow[] = [
    {
      company_id: companyId,
      conversation_id: conversation.id as string,
      actor_user_id: userId,
      type: "consent_attested",
      payload: { consent_source: "attested" },
    },
  ];
  if (quietHours) {
    events.push({
      company_id: companyId,
      conversation_id: conversation.id as string,
      actor_user_id: userId,
      type: "quiet_hours_confirmed",
      payload: { destination_local_hour: hour },
    });
  }
  await insertConversationEvents(db, events);

  const sent = await dispatchOutbound(env, db, message, {
    from: number.number_e164,
    to: destination,
    text,
    mediaUrls: [],
  });

  return c.json(
    { conversation, message: stripTsv(sent) },
    created ? 201 : 200,
  );
});

/** Drop the generated tsvector column from RPC-returned rows. */
function stripTsv(row: MessageRow): Record<string, unknown> {
  const clone = { ...(row as MessageRow & { body_tsv?: unknown }) };
  delete clone.body_tsv;
  return clone;
}
