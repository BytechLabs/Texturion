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
 *     consent_attested event (§5, D4). Both are written together AFTER the
 *     send passes the §7 gate (#48): a gate-rejected compose stamps nothing,
 *     so an attested contact can never exist without its audit event.
 *   • gate-rejected composes leave nothing behind (#48): the open
 *     conversation created for the send is reaped while still empty (the
 *     messages FK makes the "still empty" check atomic under concurrency).
 *   • quiet hours (soft, §5): destination local hour outside 08–20 requires
 *     quiet_hours_confirmed=true (409 `quiet_hours_confirmation_required`
 *     otherwise), unless the company switched the confirmation step off
 *     (#225 ask 5); a send inside the window logs a quiet_hours_confirmed
 *     event either way, carrying whether anybody actually confirmed.
 *   • open-conversation conflict (conversations_open_uq): append to the
 *     existing open conversation and return it with 200 — gates and
 *     attestation still apply and are recorded.
 *   • the send itself runs the §7 gate order via the shared send core.
 */
import {
  appendIdentification,
  estimateSegments,
  formatNanpNumber,
  shouldIdentify,
} from "@loonext/shared";
import { Hono } from "hono";
import { z } from "zod";

import { requireCapability } from "../auth/company";
import { assertNumberLevel } from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError } from "../http/errors";
import {
  decodeOutboundMedia,
  MAX_OUTBOUND_MEDIA_BODY_BYTES,
  MAX_OUTBOUND_MEDIA_ITEMS,
  MMS_SEGMENTS,
  signedMediaUrls,
  uploadOutboundMedia,
} from "../messaging/media";
import { resolveDestinationClock } from "../messaging/destination-clock";
import {
  applySendMergeFields,
  resolveSendMergeFields,
} from "../messaging/merge";
import {
  dispatchOutbound,
  gateOutboundSend,
  persistSendInterruption,
  runPreSendGates,
} from "../messaging/send";
import type { AttachmentSummary, MessageRow } from "../messaging/types";
import {
  insertConversationEvents,
  type ConversationEventRow,
} from "./core/events";
import { normalizeNanpPhone } from "./core/phone";
import {
  assertBodyWithinLimit,
  isUniqueViolation,
  parseJsonBody,
  unwrap,
} from "./core/http";
import {
  loadAttachments,
  mediaItemSchema,
  messageJson,
  requireIdempotencyKey,
} from "./messages";

const composeSchema = z
  .object({
    contact_id: z.uuid().optional(),
    phone_e164: z.string().trim().min(1).max(32).optional(),
    phone_number_id: z.uuid(),
    body: z.string().max(4096).refine((value) => value.trim().length > 0, {
      message: "body must not be empty.",
    }),
    // D4: consent is now attested implicitly on compose (the visible "asked us
    // to text them" checkbox was removed as friction). The attestation is still
    // recorded on the contact + audit event so the opt-in trail stays intact;
    // the field is accepted for back-compat but no longer gates the send.
    consent_attested: z.literal(true).optional(),
    quiet_hours_confirmed: z.boolean().optional(),
    /**
     * #475: the saved reply this message was built from, if any. Same contract
     * as POST /v1/messages/send — client-declared, because by the time the body
     * arrives it has been merged and possibly edited and the template cannot be
     * recovered from the text.
     */
    template_id: z.uuid().optional(),
    /** #274: whether the words changed after the template was inserted. */
    template_edited: z.boolean().optional(),
    // #97 outbound MMS: same shape/limits as POST /v1/messages/send — ≤3
    // items from the #189 deliverable set (images/audio/video/vCard/PDF/
    // text), ≤1 MB each (decoded + byte-checked server-side). Ungated
    // (fair-use metered as segments, see the send below).
    media: z
      .array(mediaItemSchema)
      .min(1)
      .max(MAX_OUTBOUND_MEDIA_ITEMS)
      .optional(),
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
  name: string | null;
  consent_source: string | null;
  /** #393: non-null means this contact has already been identified to. */
  first_identification_sent_at: string | null;
  /** #274: the service address, for {address}. */
  address: string | null;
  /** #274: the contact's zone, so {job_day}/{job_time} read in THEIR day. */
  timezone: string | null;
}

type Db = ReturnType<typeof getDb>;

/**
 * Resolve the target contact (§5): existing contacts are resurrected
 * (deleted_at cleared — the user explicitly composed to them); missing ones
 * are created bare (no consent columns — the same posture as a CSV import).
 * Consent is deliberately NOT stamped here (#48): attestation — the contact
 * columns AND the consent_attested audit event, together — is recorded by
 * {@link attestContactConsent} only after the send passes the §7 gate, so a
 * gate-rejected compose can never leave an attested contact with no audit
 * event.
 */
async function resolveComposeContact(
  db: Db,
  args: {
    companyId: string;
    contactId?: string;
    phoneE164?: string;
  },
): Promise<ContactRow> {
  // #274: address + timezone ride along on a query already running, so
  // {address} and the visit day/time cost nothing extra here. ONE string
  // literal, not a concatenation — PostgREST infers the row shape from the
  // literal type, and joining two pieces widens it to `string` and loses it.
  const columns =
    "id,phone_e164,name,consent_source,first_identification_sent_at,address,timezone";

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
        .update({ deleted_at: null })
        .eq("company_id", args.companyId)
        .eq("id", contact.id)
        .select(columns),
      "contact resurrect",
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
        .update({ deleted_at: null })
        .eq("company_id", args.companyId)
        .eq("id", existing.id)
        .select(columns),
      "contact resurrect",
    )[0];
    return updated ?? existing;
  }

  const inserted = await db
    .from("contacts")
    .insert({
      company_id: args.companyId,
      phone_e164: phone,
    })
    .select(columns);
  if (inserted.error) {
    if (isUniqueViolation(inserted.error)) {
      // Concurrent create won: re-select that row.
      return resolveComposeContact(db, {
        companyId: args.companyId,
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
 * Stamp the §5 attestation on the contact — only when it still carries no
 * consent. The `.is("consent_source", null)` filter makes the write atomic
 * against the inbound-webhook race (an inbound between our read and this
 * write stamps `inbound_sms`, which is never downgraded). Called AFTER the
 * consent_attested event insert, so a crash between the two leaves the
 * self-healing gap (event without stamp → the next compose re-attests),
 * never the silent one (stamp without audit event — the #48 bug).
 */
async function attestContactConsent(
  db: Db,
  args: { companyId: string; contactId: string; userId: string },
): Promise<void> {
  const { error } = await db
    .from("contacts")
    .update({
      consent_source: "attested",
      consent_at: new Date().toISOString(),
      consent_attested_by: args.userId,
    })
    .eq("company_id", args.companyId)
    .eq("id", args.contactId)
    .is("consent_source", null);
  if (error) throw new Error(`contact attest failed: ${error.message}`);
}

/**
 * Stamp the #393 identification ledger, so this contact is never sent the
 * suffix twice.
 *
 * `.is("first_identification_sent_at", null)` makes it atomic against two
 * concurrent composes to the same new contact: the loser's update matches no
 * row. Both messages may still carry the suffix — they were composed before
 * either stamped — and that is the right way round to fail. The alternative is
 * reserving the stamp before the send, which would suppress identification on
 * the *only* message a stranger receives if the send then failed.
 *
 * Best-effort by design: a failure here must not fail a message that has
 * already been handed to the carrier. The cost of a lost stamp is one repeated
 * footer on a later send, which is noise; the cost of throwing is a 500 on a
 * send that actually succeeded.
 */
async function stampIdentificationSent(
  db: Db,
  args: { companyId: string; contactId: string },
): Promise<void> {
  const { error } = await db
    .from("contacts")
    .update({ first_identification_sent_at: new Date().toISOString() })
    .eq("company_id", args.companyId)
    .eq("id", args.contactId)
    .is("first_identification_sent_at", null);
  if (error) {
    console.error(`identification stamp failed: ${error.message}`);
  }
}

/**
 * #48: best-effort reap of the open conversation a gate-rejected compose just
 * created. `messages.conversation_id` is ON DELETE RESTRICT, so the DELETE is
 * its own atomic "only while still empty" guard: if a concurrent compose (or
 * an inbound) threaded a message into the row between our gate rejection and
 * this delete, Postgres refuses with a foreign-key violation (23503) and the
 * conversation survives — exactly right, it is no longer empty. Every failure
 * is swallowed: the gate's typed rejection must reach the client.
 */
async function reapEmptyConversation(
  db: Db,
  companyId: string,
  conversationId: string,
): Promise<void> {
  const { error } = await db
    .from("conversations")
    .delete()
    .eq("company_id", companyId)
    .eq("id", conversationId);
  if (error && error.code !== "23503") {
    console.error(
      `compose conversation reap failed for ${conversationId}: ${error.message}`,
    );
  }
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

composeRoutes.post("/conversations", requireCapability("conversations.send"), async (c) => {
  const env = getEnv(c.env);
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const idempotencyKey = requireIdempotencyKey(c);
  // Reject an oversized media payload on Content-Length BEFORE buffering the
  // whole JSON body into Worker memory (SPEC §10; mirrors /messages/send).
  assertBodyWithinLimit(c, MAX_OUTBOUND_MEDIA_BODY_BYTES);
  const body = await parseJsonBody(c, composeSchema);
  const media = body.media ? decodeOutboundMedia(body.media) : [];
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
    const attachments = await loadAttachments(db, companyId, [replay.id]);
    return c.json(
      {
        conversation,
        message: messageJson(replay, attachments.get(replay.id) ?? []),
      },
      200,
    );
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
  // #106: composing from a number needs level 'text' on it (hidden → 404,
  // notes-only → the honest 403).
  await assertNumberLevel(db, {
    companyId,
    userId,
    role: c.get("role"),
    phoneNumberId: number.id,
    need: "text",
  });
  if (!number.number_e164 || number.status !== "active") {
    throw new ApiError("conflict", "This number is not ready to send yet.");
  }

  // Company (business name — merge fields + audit; #393 identification setting;
  // #225 the night-texting confirmation). Optional, because a row read against a
  // Worker deployed ahead of the migration has no such column — and the gate
  // below reads absent as ON so the missing case fails toward asking.
  const company = unwrap<
    {
      id: string;
      name: string;
      first_message_identification: boolean;
      quiet_hours_confirm_enabled?: boolean;
    }[]
  >(
    await db
      .from("companies")
      .select(
        "id,name,first_message_identification,quiet_hours_confirm_enabled",
      )
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
  const clearance = await runPreSendGates(env, companyId, destination);

  // #97: picture messages are ungated — every US-texting company can send them.
  // Each MMS meters as 3 segments (MMS_SEGMENTS, below) through gateOutboundSend,
  // so it counts against the plan's segment allowance + the #85 fair-use overage
  // exactly like text. No paid module, no separate MMS cap. (Incoming pictures
  // are always free.)

  // Quiet hours (soft, §5): 8pm–8am destination local time needs an explicit
  // confirmation. #292/D49: through the ONE resolver, so this path and every
  // automated one share an implementation rather than agreeing by accident —
  // and so a contact whose area code lies can be corrected in one place.
  const clock = await resolveDestinationClock(db, {
    companyId,
    phoneE164: destination,
  });
  // #225 ask 5: an admin may switch the confirmation STEP off — for a 24-hour
  // emergency trade it fires on every 2am job, and a prompt that is always
  // dismissed teaches people to dismiss prompts. THIS IS THE ONLY PLACE THAT
  // READS THE COLUMN, and quiet-hours-confirm.test.ts keeps it that way: the
  // flag governs a human's confirmation dialog, never an automated send's right
  // to fire at 3am. Absent/undefined reads as ON, so a company row loaded
  // before the migration lands keeps the prompt.
  const confirmationRequired = company.quiet_hours_confirm_enabled !== false;
  if (clock.quiet && confirmationRequired && body.quiet_hours_confirmed !== true) {
    // Structural signal: dedicated code (409, same envelope) so the UI shows
    // the quiet-hours confirm dialog by CODE, not by sniffing the message.
    throw new ApiError(
      "quiet_hours_confirmation_required",
      `It's ${String(clock.localHour).padStart(2, "0")}:00 where this customer is. Confirm with quiet_hours_confirmed to send anyway.`,
    );
  }

  // Opt-out pre-check before creating rows (the gate RPC re-checks
  // atomically). Rejections the route cannot pre-check (rate/cap/backstops)
  // are cleaned up after the fact by reapEmptyConversation (#48).
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

  // Contact upsert (§5 — attestation deferred until the gate passes, #48),
  // then conversation create-or-append. A gate-rejected compose leaves the
  // bare contact row behind on purpose: a consent-less contact is inert
  // (same as a CSV import) and may be shared with other conversations.
  const contact = await resolveComposeContact(db, {
    companyId,
    contactId: body.contact_id,
    phoneE164: body.phone_e164,
  });
  const { conversation, created } = await createOrReuseConversation(db, {
    companyId,
    contactId: contact.id,
    phoneNumberId: number.id,
  });

  // Step 0a merge-fields: applied server-side at SEND time, reusing the contact
  // + company already loaded here (no extra query). Unknown/empty tokens degrade
  // cleanly. Runs BEFORE the estimate.
  //
  // #274: same contract as the reply path. A brand-new conversation has no
  // tasks yet, so {job_day}/{job_time} will resolve to nothing and drop — which
  // is correct and is exactly what graceful degradation is for.
  const resolved = await resolveSendMergeFields(db, body.body, {
    companyId,
    // The row is a Record<string, unknown> here, like every other read of
    // it in this handler (see the `as string` casts below).
    conversationId: conversation.id as string,
    userId: c.get("userId"),
    timeZone: contact.timezone ?? null,
  });
  const merged = applySendMergeFields(body.body, {
    contactName: contact.name,
    businessName: company.name,
    contactAddress: contact.address ?? null,
    ourNumber: formatNanpNumber(number.number_e164),
    ...resolved,
  });

  // #393 first-message identification: appended HERE, after merge fields and
  // BEFORE the segment estimate, so the segments we pre-check, meter and bill
  // are the segments actually sent. Appending it any later would bill the
  // customer for a footer the estimate never saw. Off unless the owner enabled
  // it, and once per contact — see D4 and the shared module.
  const identify = shouldIdentify({
    settingEnabled: company.first_message_identification,
    alreadyIdentifiedAt: contact.first_identification_sent_at,
  });
  const text = identify ? appendIdentification(merged, company.name) : merged;

  // §9/§10 estimate: MMS meters (and pre-checks) as 3 segments.
  const segmentsEstimate =
    media.length > 0 ? MMS_SEGMENTS : estimateSegments(text).segments;

  let gated: Awaited<ReturnType<typeof gateOutboundSend>>;
  try {
    gated = await gateOutboundSend(db, {
      companyId,
      conversationId: conversation.id as string,
      senderUserId: userId,
      body: text,
      idempotencyKey,
      segmentsEstimate,
    });
  } catch (cause) {
    // #48: a rejected compose (rate_limited, usage_cap_reached, the gate's
    // backstops, or an RPC failure — in every case no message row committed)
    // must not leave the message-less open conversation it just created in
    // the inbox, where it would clutter the list and absorb the next inbound
    // under threading rule 2. Only a conversation THIS request created is
    // reaped — a reused open conversation predates the request.
    if (created) {
      await reapEmptyConversation(db, companyId, conversation.id as string);
    }
    throw cause;
  }
  const { message, existing } = gated;
  if (existing) {
    // Concurrent duplicate replay landed between our fast-path and the RPC.
    const attachments = await loadAttachments(db, companyId, [message.id]);
    return c.json(
      {
        conversation,
        message: messageJson(message, attachments.get(message.id) ?? []),
      },
      200,
    );
  }

  // Audit trail (§5): every gate-passing compose records a consent_attested
  // event (each compose is an implicit re-attestation, D4); quiet-hours
  // confirmation recorded when it actually gated the send.
  const events: ConversationEventRow[] = [
    {
      company_id: companyId,
      conversation_id: conversation.id as string,
      actor_user_id: userId,
      type: "consent_attested",
      payload: { consent_source: "attested" },
    },
  ];
  if (clock.quiet) {
    events.push({
      company_id: companyId,
      conversation_id: conversation.id as string,
      actor_user_id: userId,
      type: "quiet_hours_confirmed",
      payload: {
        destination_local_hour: clock.localHour,
        // #225: WAS anybody asked? With the confirmation switched off the send
        // still happened inside the quiet window and the trail still has to say
        // so — but recording it as a confirmation nobody gave would be a
        // fabricated attestation, which is the one thing an audit record must
        // never contain.
        confirmed: body.quiet_hours_confirmed === true,
        // #292: which rung of the D49 ladder answered. A confirmation against
        // the shop's clock is a weaker record than one against the customer's
        // own, and the difference matters if it is ever produced as evidence.
        timezone: clock.timezone,
        timezone_source: clock.source,
      },
    });
  }
  // #20: any failure between the queued-row insert and dispatch would strand
  // the row `queued` until the fail-stuck sweeper cron catches it — fail it
  // immediately instead (same idiom as /messages/send) so the composer shows
  // the failure + retry affordance right away, then rethrow.
  let mediaUrls: string[] = [];
  let attachments: AttachmentSummary[] = [];
  try {
    await insertConversationEvents(db, events);

    // #48: stamp the contact's consent columns only now — after the gate
    // passed AND the audit event is durably inserted (event-first, so a crash
    // here can never leave the stamp without its event). Skipped when the
    // contact already carries consent (inbound_sms is never downgraded).
    if (contact.consent_source === null) {
      await attestContactConsent(db, {
        companyId,
        contactId: contact.id,
        userId,
      });
    }

    // §8 outbound media: upload each validated item to Storage and mint the 24h
    // signed URLs Telnyx fetches from. Runs after the queued row exists (the
    // path needs message.id) and before the dispatch that references the URLs.
    if (media.length > 0) {
      const uploaded = await uploadOutboundMedia(db, {
        companyId,
        messageId: message.id,
        items: media,
      });
      attachments = uploaded.summaries;
      mediaUrls = await signedMediaUrls(db, uploaded.storagePaths);
    }
  } catch (cause) {
    await persistSendInterruption(
      db,
      message,
      "The send was interrupted before reaching the carrier.",
    );
    throw cause;
  }

  const sent = await dispatchOutbound(env, db, message, {
    from: number.number_e164,
    to: destination,
    text,
    mediaUrls,
    clearance,
  });

  // #393: stamp the identification ledger only once the carrier has the
  // message. A dispatch that threw never reached the contact, and stamping
  // before it would spend this contact's one identification on a message they
  // never received.
  if (identify) {
    await stampIdentificationSent(db, { companyId, contactId: contact.id });
  }

  // #475: a first message to a new customer is one of the likeliest templated
  // sends there is, so this path counts too. After the dispatch and swallowing
  // its own failure, for the same reason as the reply path: a delivered message
  // must never be reported as failed because a counter did not increment.
  if (body.template_id) {
    try {
      await db.rpc("api_record_template_use", {
        p_company_id: companyId,
        p_template_id: body.template_id,
        p_edited: body.template_edited ?? false,
      });
    } catch (cause) {
      console.warn(`template use not recorded: ${String(cause)}`);
    }
  }

  return c.json(
    { conversation, message: messageJson(sent, attachments) },
    created ? 201 : 200,
  );
});
