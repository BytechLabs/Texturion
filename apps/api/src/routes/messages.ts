/**
 * Message routes (SPEC §7, §8) — any active member. Mounted by the
 * integration layer at /v1 (paths here are /v1-relative):
 *
 *   POST /v1/messages/send        { conversation_id, body?, media? } +
 *        Idempotency-Key. Gate order exactly per §7: membership (middleware)
 *        → subscription active (402) → destination US/CA (422) →
 *        per-destination registration (403) → opt-out (403) → rate/cap
 *        (429/402) via gate_outbound_send → insert → Telnyx. Media: max
 *        3 × ≤1 MB jpeg/png/gif base64 (422), uploaded to Storage, 24 h
 *        signed media_urls.
 *   POST /v1/messages/:id/retry   re-send a `failed` outbound ONLY while
 *        telnyx_message_id IS NULL (the API call failed before an id was
 *        assigned); carrier-finalized failures → 409 `conflict`. Also accepts
 *        a `queued` outbound stuck without a telnyx_message_id beyond the
 *        #20 safety window (a send that crashed before the Telnyx call).
 *        The requeue is ATOMIC (#19/#47): the claim_message_retry RPC
 *        re-checks eligibility, re-runs the SQL rate/cap gates, and flips
 *        failed→queued under row locks — a concurrent duplicate retry loses
 *        with 409, never a second Telnyx call.
 *   PATCH /v1/messages/:id        { done: boolean } — D14 done state. Any
 *        member; company-scoped 404; idempotent (marking done twice is a
 *        no-op returning the row). done=true stamps done_at +
 *        done_by_user_id, done=false clears both; the DB broadcast trigger
 *        emits `message.status` so all open clients update. Applies to
 *        inbound, outbound, and notes alike. On a REAL done↔undone transition
 *        it additionally appends one `conversation_events` audit row
 *        (`message_done`/`message_undone`, actor-stamped, payload {message_id})
 *        per D22 — the no-op path writes none. This is also the ONE completion
 *        path for a promoted task (D17/TASKS.md T2): the handler has no
 *        task-awareness; a task's done state derives from this same done_at.
 *   GET  /v1/conversations/:id/messages   cursor list, newest-first,
 *        (created_at, id) DESC, default 50 max 100; message objects carry
 *        `attachments: [{ id, content_type, size_bytes }]`.
 */
import { estimateSegments } from "@loonext/shared";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import {
  assertNumberLevel,
  requireConversationAccess,
} from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError } from "../http/errors";
import { buildPage } from "../http/pagination";
import {
  decodeOutboundMedia,
  MAX_OUTBOUND_MEDIA_BODY_BYTES,
  MAX_OUTBOUND_MEDIA_BYTES,
  MAX_OUTBOUND_MEDIA_ITEMS,
  MMS_SEGMENTS,
  signedMediaUrls,
  uploadOutboundMedia,
} from "../messaging/media";
import { applySendMergeFields } from "../messaging/merge";
import {
  claimMessageRetry,
  dispatchOutbound,
  gateOutboundSend,
  persistSendInterruption,
  runPreSendGates,
  STUCK_SEND_SECONDS,
} from "../messaging/send";
import type { AttachmentSummary, MessageRow } from "../messaging/types";
import {
  assertBodyWithinLimit,
  keysetFilter,
  parseCursor,
  parseJsonBody,
  parseLimit,
  pathUuid,
  unwrap,
} from "./core/http";
import {
  loadMessageTaskFlags,
  loadNoteTaskLinks,
} from "./core/message-tasks";

/** SPEC §7: sends and composes REQUIRE an Idempotency-Key header. */
export function requireIdempotencyKey(c: Context): string {
  const key = c.req.header("Idempotency-Key")?.trim();
  if (!key || key.length > 255) {
    throw new ApiError(
      "validation_failed",
      "Idempotency-Key header is required.",
    );
  }
  return key;
}

/**
 * Shared outbound-media item shape — reused by the compose route (§7).
 * `content_type` is shape-checked here only; decodeOutboundMedia is the ONE
 * allow-list gate (#189) — it canonicalizes vendor aliases (audio/x-wav …)
 * and names the allowed set in its 422, which a zod enum can't do.
 */
export const mediaItemSchema = z.object({
  content_type: z.string().min(1).max(255),
  // Schema-level ceiling (defense-in-depth): the decoded 1 MB cap × ~2 for
  // base64 expansion + whitespace. The real guard is the Content-Length
  // pre-check on the routes (zod runs only after the body is buffered).
  base64: z.string().min(1).max(MAX_OUTBOUND_MEDIA_BYTES * 2),
});

const sendSchema = z
  .object({
    conversation_id: z.uuid(),
    body: z.string().max(4096).optional().default(""),
    media: z
      .array(mediaItemSchema)
      .min(1)
      .max(MAX_OUTBOUND_MEDIA_ITEMS)
      .optional(),
  })
  .refine(
    (value) => value.body.trim().length > 0 || (value.media?.length ?? 0) > 0,
    { message: "Provide a body, media, or both." },
  );

/**
 * PATCH /v1/messages/:id — flip exactly ONE message facet: `done` (D14) or
 * `pinned` (#3). Each is a single boolean routed through its own security-
 * definer RPC. Exactly-one keeps the request unambiguous (one facet, one
 * broadcast) and mirrors the done surface's minimalism.
 */
const messagePatchSchema = z
  .object({
    done: z.boolean().optional(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => (v.done !== undefined) !== (v.pinned !== undefined), {
    message: "Set exactly one of `done` or `pinned`.",
  });

interface ConversationSendView {
  id: string;
  contact_id: string;
  phone_number_id: string;
  contacts: {
    id: string;
    phone_e164: string;
    name: string | null;
  };
  phone_numbers: { id: string; number_e164: string | null; status: string };
  companies: { id: string; name: string };
}

type Db = ReturnType<typeof getDb>;

/** Conversation + contact + number + company, company-scoped (§10). */
async function loadSendView(
  db: Db,
  companyId: string,
  conversationId: string,
): Promise<ConversationSendView> {
  const rows = unwrap<ConversationSendView[]>(
    await db
      .from("conversations")
      .select(
        "id,contact_id,phone_number_id," +
          "contacts(id,phone_e164,name)," +
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
function requireActiveSendingNumber(view: ConversationSendView): string {
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

/** Attachment summaries for a set of message rows, keyed by message id. */
export async function loadAttachments(
  db: Db,
  companyId: string,
  messageIds: string[],
): Promise<Map<string, AttachmentSummary[]>> {
  const map = new Map<string, AttachmentSummary[]>();
  if (messageIds.length === 0) return map;
  const rows = unwrap<
    (AttachmentSummary & { message_id: string })[]
  >(
    await db
      .from("message_attachments")
      .select("id,message_id,content_type,size_bytes")
      .eq("company_id", companyId)
      .in("message_id", messageIds)
      .order("storage_path", { ascending: true }),
    "attachments lookup",
  );
  for (const row of rows) {
    const list = map.get(row.message_id) ?? [];
    list.push({
      id: row.id,
      content_type: row.content_type,
      size_bytes: row.size_bytes,
    });
    map.set(row.message_id, list);
  }
  return map;
}

/**
 * The message columns the API ever reads — every field of MessageRow, and
 * deliberately NOT the generated `body_tsv` tsvector, which is search-only and
 * can be large. `select("*")` would drag it over the PostgREST→Worker wire on
 * every row only for messageJson to delete it again; naming the columns keeps
 * the fetch lean. Keep in sync with MessageRow.
 */
export const MESSAGE_COLUMNS =
  "id,company_id,conversation_id,direction,body,telnyx_message_id,status," +
  "segments,encoding,sent_by_user_id,error_code,error_detail,idempotency_key," +
  "provider_cost,done_at,done_by_user_id,pinned_at,pinned_by_user_id," +
  "created_at,updated_at";

/** SPEC §7 message object: row + attachments summary, tsv column dropped. */
export function messageJson(
  row: MessageRow,
  attachments: AttachmentSummary[],
): Record<string, unknown> {
  const { ...rest } = row as MessageRow & { body_tsv?: unknown };
  delete (rest as { body_tsv?: unknown }).body_tsv;
  return { ...rest, attachments };
}

export const messageRoutes = new Hono<AppEnv>();

messageRoutes.post("/messages/send", requireRole("member"), async (c) => {
  const env = getEnv(c.env);
  const companyId = c.get("companyId");
  const idempotencyKey = requireIdempotencyKey(c);
  // Reject an oversized media payload on Content-Length BEFORE c.req.json()
  // buffers the whole body into Worker memory (SPEC §10) — the per-item decoded
  // cap in decodeOutboundMedia runs only after the full buffer + a base64 copy.
  assertBodyWithinLimit(c, MAX_OUTBOUND_MEDIA_BODY_BYTES);
  const body = await parseJsonBody(c, sendSchema);
  const media = body.media ? decodeOutboundMedia(body.media) : [];

  const db = getDb(env);
  const view = await loadSendView(db, companyId, body.conversation_id);
  // #106: sending needs level 'text' on the conversation's number (notes-only
  // members get the honest 403; hidden numbers already 404 upstream).
  await assertNumberLevel(db, {
    companyId,
    userId: c.get("userId"),
    role: c.get("role"),
    phoneNumberId: view.phone_number_id ?? null,
    need: "text",
  });
  const fromNumber = requireActiveSendingNumber(view);

  // §7 gate order: subscription → destination US/CA → registration.
  await runPreSendGates(env, companyId, view.contacts.phone_e164);

  // #97: picture messages are ungated — MMS meters as 3 segments (MMS_SEGMENTS,
  // below) through gateOutboundSend, counting against the plan allowance + the
  // #85 fair-use overage exactly like text. No paid module, no separate MMS cap.
  // (Incoming pictures are always free — this path is outbound-only.)

  // Step 0a merge-fields: applied server-side at SEND time to the composed body
  // (and to any saved-reply text the composer pasted in), reusing the contact +
  // company already loaded here — no extra query. Unknown/empty tokens degrade
  // cleanly. Runs BEFORE the segment estimate so it sees the substituted text.
  const merged = applySendMergeFields(body.body, {
    contactName: view.contacts.name,
    businessName: view.companies.name,
  });

  const text = merged;

  // §9/§10 estimate: MMS meters (and pre-checks) as 3 segments.
  const segmentsEstimate =
    media.length > 0 ? MMS_SEGMENTS : estimateSegments(text).segments;

  // §7/§10: opt-out → rate → cap, atomic with the queued insert.
  const { message, existing } = await gateOutboundSend(db, {
    companyId,
    conversationId: view.id,
    senderUserId: c.get("userId"),
    body: text,
    idempotencyKey,
    segmentsEstimate,
  });

  if (existing) {
    // Duplicate request (§7): return the existing row, 200, no Telnyx call.
    if (message.conversation_id !== view.id) {
      throw new ApiError(
        "conflict",
        "Idempotency-Key was already used for a different conversation.",
      );
    }
    const attachments = await loadAttachments(db, companyId, [message.id]);
    return c.json(messageJson(message, attachments.get(message.id) ?? []), 200);
  }

  let mediaUrls: string[] = [];
  let attachments: AttachmentSummary[] = [];
  if (media.length > 0) {
    // #20: these steps run AFTER the gate inserted the queued row but BEFORE
    // dispatch — a throw here used to leave the row stuck 'queued' forever
    // (undeliverable, unretryable, still counting against the cap). Fail the
    // row out instead so the thread shows a retryable failure immediately;
    // the fail-stuck sweeper cron is the backstop for crashes this can't see.
    try {
      const uploaded = await uploadOutboundMedia(db, {
        companyId,
        messageId: message.id,
        items: media,
      });
      attachments = uploaded.summaries;
      mediaUrls = await signedMediaUrls(db, uploaded.storagePaths);
    } catch (cause) {
      await persistSendInterruption(
        db,
        message,
        "The send was interrupted before reaching the carrier.",
      );
      throw cause;
    }
  }

  const sent = await dispatchOutbound(env, db, message, {
    from: fromNumber,
    to: view.contacts.phone_e164,
    text,
    mediaUrls,
  });
  return c.json(messageJson(sent, attachments), 201);
});

messageRoutes.post("/messages/:id/retry", requireRole("member"), async (c) => {
  const env = getEnv(c.env);
  const companyId = c.get("companyId");
  const messageId = pathUuid(c, "id");
  const db = getDb(env);

  const rows = unwrap<MessageRow[]>(
    await db
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("company_id", companyId)
      .eq("id", messageId)
      .limit(1),
    "message lookup",
  );
  const message = rows[0];
  if (!message) throw new ApiError("not_found", "No such message.");

  // §7: retry an API-failure row — failed AND never assigned a Telnyx id
  // (carrier-finalized failures, 40300 etc., are not retryable) — or a #20
  // stuck-queued row: still 'queued' with no Telnyx id and untouched beyond
  // the safety window (the send crashed before the Telnyx call). This is the
  // cheap pre-check for a friendly 409; claim_message_retry re-asserts it
  // ATOMICALLY below.
  const stuckQueued =
    message.status === "queued" &&
    Date.parse(message.updated_at) < Date.now() - STUCK_SEND_SECONDS * 1000;
  if (
    message.direction !== "outbound" ||
    message.telnyx_message_id !== null ||
    (message.status !== "failed" && !stuckQueued)
  ) {
    throw new ApiError(
      "conflict",
      "Only failed sends without a carrier message id can be retried.",
    );
  }

  const view = await loadSendView(db, companyId, message.conversation_id);
  // #106: a retry re-sends to the customer — same level-'text' bar as a send.
  await assertNumberLevel(db, {
    companyId,
    userId: c.get("userId"),
    role: c.get("role"),
    phoneNumberId: view.phone_number_id ?? null,
    need: "text",
  });
  const fromNumber = requireActiveSendingNumber(view);

  // Gates re-run: the world may have changed since the failed attempt.
  await runPreSendGates(env, companyId, view.contacts.phone_e164);
  const optOuts = unwrap<{ id: string }[]>(
    await db
      .from("opt_outs")
      .select("id")
      .eq("company_id", companyId)
      .eq("phone_e164", view.contacts.phone_e164)
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

  // Stored outbound media, loaded up front so its signed URLs can be re-minted
  // BEFORE the atomic claim (below). #97: a picture re-send is ungated — it
  // meters as segments like any send, with no module gate.
  const attachmentRows = unwrap<
    (AttachmentSummary & { storage_path: string })[]
  >(
    await db
      .from("message_attachments")
      .select("id,content_type,size_bytes,storage_path")
      .eq("company_id", companyId)
      .eq("message_id", message.id)
      .order("storage_path", { ascending: true }),
    "attachments lookup",
  );

  // Re-mint signed URLs for any stored outbound media (24 h TTL, §8) BEFORE
  // the atomic claim — signing has no side effects, so a signing failure
  // never leaves the row half-requeued.
  const mediaUrls = await signedMediaUrls(
    db,
    attachmentRows.map((row) => row.storage_path),
  );

  // Same row, new Telnyx call (§7). The RPC is the arbiter (#19/#20/#47):
  // eligibility + the SQL rate/cap gates + the failed→queued flip run under
  // row locks, so of two concurrent retries exactly ONE gets the requeued row
  // back — the loser (and an over-cap/rate-limited retry) gets a typed error
  // and never reaches Telnyx.
  const requeued = await claimMessageRetry(db, {
    companyId,
    messageId: message.id,
    stuckAfterSeconds: STUCK_SEND_SECONDS,
  });

  const sent = await dispatchOutbound(env, db, requeued, {
    from: fromNumber,
    to: view.contacts.phone_e164,
    text: message.body,
    mediaUrls,
  });
  return c.json(
    messageJson(
      sent,
      attachmentRows.map(({ id, content_type, size_bytes }) => ({
        id,
        content_type,
        size_bytes,
      })),
    ),
    200,
  );
});

messageRoutes.patch("/messages/:id", requireRole("member"), async (c) => {
  const env = getEnv(c.env);
  const companyId = c.get("companyId");
  const messageId = pathUuid(c, "id");
  const body = await parseJsonBody(c, messagePatchSchema);
  const db = getDb(env);

  // Company-scoped fetch (§10): a message outside the caller's company is
  // indistinguishable from a missing one — 404 either way.
  const rows = unwrap<MessageRow[]>(
    await db
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("company_id", companyId)
      .eq("id", messageId)
      .limit(1),
    "message lookup",
  );
  const message = rows[0];
  if (!message) throw new ApiError("not_found", "No such message.");

  // #106: done/pin are workflow actions — any visible level ('note'+) may
  // flip them; a hidden number's messages 404 like a wrong id.
  await requireConversationAccess(db, {
    companyId,
    userId: c.get("userId"),
    role: c.get("role"),
    conversationId: message.conversation_id,
    need: "note",
  });

  // D14/D22: the flip AND its audit event are ONE atomic transaction via the
  // set_message_done security-definer RPC — never two PostgREST round-trips (a
  // crash between them left the audit and the done-state permanently
  // inconsistent, and for a promoted message dropped its ONE completion audit).
  // The RPC is company-scoped (§10), idempotent (a redundant mark-done writes
  // nothing and returns 'unchanged' — no update, no broadcast, no done_at/done_by
  // churn), and audits ONLY a real done↔undone transition (message_done/
  // message_undone, body NEVER copied into the payload — D8/D22 PII posture; the
  // timeline joins the live message by message_id). For a promoted message this
  // is the ONE completion audit — tasks never re-audit done (TASKS.md T2.1). The
  // shipped broadcast_message_change trigger fires `message.status` off the
  // UPDATE for free (§8 broadcast-from-DB).
  // #3: pinning reuses the exact same atomic-RPC shape as done — company-
  // scoped, row-locked, idempotent ('unchanged' on a redundant toggle → no
  // write, no broadcast), and the shipped broadcast_message_change trigger
  // fires `message.status` off the UPDATE (§8). Pinning carries no audit event
  // (it's organizational, not an audited transition like done).
  const userId = c.get("userId");
  const { data, error } =
    body.pinned !== undefined
      ? await db.rpc("set_message_pinned", {
          p_company_id: companyId,
          p_message_id: message.id,
          p_pinned: body.pinned,
          p_actor_user_id: userId,
        })
      : await db.rpc("set_message_done", {
          p_company_id: companyId,
          p_message_id: message.id,
          p_done: body.done,
          p_actor_user_id: userId,
        });
  if (error) {
    const fn = body.pinned !== undefined ? "set_message_pinned" : "set_message_done";
    throw new Error(`${fn} failed: ${error.message}`);
  }
  const result = data as {
    outcome: "updated" | "unchanged" | "not_found";
    message: MessageRow | null;
  };
  if (result.outcome === "not_found" || !result.message) {
    throw new ApiError("not_found", "No such message.");
  }

  const updated = result.message;
  const attachments = await loadAttachments(db, companyId, [updated.id]);
  return c.json(messageJson(updated, attachments.get(updated.id) ?? []));
});

messageRoutes.get(
  "/conversations/:id/messages",
  requireRole("member"),
  async (c) => {
    const env = getEnv(c.env);
    const companyId = c.get("companyId");
    const conversationId = pathUuid(c, "id");
    const limit = parseLimit(c, 50, 100);
    const cursor = parseCursor(c);
    const db = getDb(env);

    // Company-scoped existence check (§10) — 404 before listing.
    const conversations = unwrap<{ id: string; phone_number_id: string | null }[]>(
      await db
        .from("conversations")
        .select("id,phone_number_id")
        .eq("company_id", companyId)
        .eq("id", conversationId)
        .limit(1),
      "conversation lookup",
    );
    if (conversations.length === 0) {
      throw new ApiError("not_found", "No such conversation.");
    }
    // #106: a hidden number's thread 404s exactly like a wrong id.
    await assertNumberLevel(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      phoneNumberId: conversations[0].phone_number_id,
      need: "read",
    });

    let query = db
      .from("messages")
      .select(
        "id,conversation_id,direction,body,status,segments,encoding," +
          "sent_by_user_id,error_code,error_detail,telnyx_message_id," +
          "done_at,done_by_user_id,pinned_at,pinned_by_user_id,task_id," +
          "created_at,message_attachments(id,content_type,size_bytes)",
      )
      .eq("company_id", companyId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);
    if (cursor) {
      query = query.or(keysetFilter("created_at", cursor));
    }
    const rows = unwrap<
      (Record<string, unknown> & {
        id: string;
        message_attachments?: AttachmentSummary[];
      })[]
    >(await query, "messages list");

    const page = buildPage(rows, limit, "created_at");
    // Two independent per-page task annotations, resolved in ONE parallel
    // round-trip: D17/T5.1 flags messages that carry a live task (the stone
    // task indicator on a promoted message), and TASKS-V2 D-D resolves the
    // linked task { id, title } for task-linked notes (the "on: <title>" chip).
    const [promoted, taskLinks] = await Promise.all([
      loadMessageTaskFlags(
        db,
        companyId,
        page.data.map((row) => row.id),
      ),
      loadNoteTaskLinks(
        db,
        companyId,
        page.data
          .map((row) => row.task_id)
          .filter((v): v is string => typeof v === "string"),
      ),
    ]);
    return c.json({
      data: page.data.map(({ message_attachments, ...rest }) => ({
        ...rest,
        attachments: message_attachments ?? [],
        has_task: promoted.has(rest.id),
        promoted_task: promoted.get(rest.id) ?? null,
        task:
          typeof rest.task_id === "string"
            ? taskLinks.get(rest.task_id) ?? null
            : null,
      })),
      next_cursor: page.next_cursor,
    });
  },
);
