/**
 * Message routes (SPEC §7, §8) — any active member. Mounted by the
 * integration layer at /v1 (paths here are /v1-relative):
 *
 *   POST /v1/messages/send        { conversation_id, body?, media? } +
 *        Idempotency-Key. Gate order exactly per §7: membership (middleware)
 *        → subscription active (402) → destination US/CA (422) →
 *        per-destination registration (403) → opt-out (403) → rate/cap
 *        (429/402) via gate_outbound_send → insert → Telnyx. §5 footer on the
 *        first outbound-first message to a contact, exactly once. Media: max
 *        3 × ≤1 MB jpeg/png/gif base64 (422), uploaded to Storage, 24 h
 *        signed media_urls.
 *   POST /v1/messages/:id/retry   re-send a `failed` outbound ONLY while
 *        telnyx_message_id IS NULL (the API call failed before an id was
 *        assigned); carrier-finalized failures → 409 `conflict`.
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
import { estimateSegments } from "@jobtext/shared";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError } from "../http/errors";
import { buildPage } from "../http/pagination";
import {
  decodeOutboundMedia,
  MMS_SEGMENTS,
  OUTBOUND_MEDIA_TYPES,
  signedMediaUrls,
  uploadOutboundMedia,
} from "../messaging/media";
import { applySendMergeFields } from "../messaging/merge";
import {
  appendIdentificationFooter,
  conversationHasInbound,
  dispatchOutbound,
  gateOutboundSend,
  runPreSendGates,
  stampFirstIdentification,
} from "../messaging/send";
import type { AttachmentSummary, MessageRow } from "../messaging/types";
import {
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

const mediaItemSchema = z.object({
  content_type: z.enum(OUTBOUND_MEDIA_TYPES),
  base64: z.string().min(1),
});

const sendSchema = z
  .object({
    conversation_id: z.uuid(),
    body: z.string().max(4096).optional().default(""),
    media: z.array(mediaItemSchema).min(1).max(3).optional(),
  })
  .refine(
    (value) => value.body.trim().length > 0 || (value.media?.length ?? 0) > 0,
    { message: "Provide a body, media, or both." },
  );

/** D14: PATCH /v1/messages/:id — the whole surface is one boolean. */
const donePatchSchema = z.object({
  done: z.boolean(),
});

interface ConversationSendView {
  id: string;
  contact_id: string;
  phone_number_id: string;
  contacts: {
    id: string;
    phone_e164: string;
    name: string | null;
    first_identification_sent_at: string | null;
  };
  phone_numbers: { id: string; number_e164: string | null; status: string };
  companies: { id: string; name: string; google_review_link: string | null };
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
          "contacts(id,phone_e164,name,first_identification_sent_at)," +
          "phone_numbers(id,number_e164,status)," +
          "companies(id,name,google_review_link)",
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

/** Attachment summaries for a set of message rows, keyed by message id. */
async function loadAttachments(
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

/** SPEC §7 message object: row + attachments summary, tsv column dropped. */
function messageJson(
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
  const body = await parseJsonBody(c, sendSchema);
  const media = body.media ? decodeOutboundMedia(body.media) : [];

  const db = getDb(env);
  const view = await loadSendView(db, companyId, body.conversation_id);
  const fromNumber = view.phone_numbers.number_e164;
  if (!fromNumber) {
    throw new ApiError(
      "conflict",
      "This conversation's number is still provisioning.",
    );
  }

  // §7 gate order: subscription → destination US/CA → registration.
  await runPreSendGates(env, companyId, view.contacts.phone_e164);

  // Step 0a merge-fields: applied server-side at SEND time to the composed body
  // (and to any saved-reply text the composer pasted in), reusing the contact +
  // company already loaded here — no extra query. Unknown/empty tokens degrade
  // cleanly. Runs BEFORE the §5 footer + the segment estimate so both see the
  // substituted text.
  const merged = applySendMergeFields(body.body, {
    contactName: view.contacts.name,
    businessName: view.companies.name,
    reviewLink: view.companies.google_review_link,
  });

  // §5 first-message identification: only the first OUTBOUND-FIRST message
  // ever sent to the contact; replies to inbound threads are never decorated.
  const footerNeeded =
    view.contacts.first_identification_sent_at === null &&
    !(await conversationHasInbound(db, companyId, view.id));
  const text = footerNeeded
    ? appendIdentificationFooter(merged, view.companies.name)
    : merged;

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

  if (footerNeeded) {
    await stampFirstIdentification(db, companyId, view.contacts.id);
  }

  let mediaUrls: string[] = [];
  let attachments: AttachmentSummary[] = [];
  if (media.length > 0) {
    const uploaded = await uploadOutboundMedia(db, {
      companyId,
      messageId: message.id,
      items: media,
    });
    attachments = uploaded.summaries;
    mediaUrls = await signedMediaUrls(db, uploaded.storagePaths);
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
      .select("*")
      .eq("company_id", companyId)
      .eq("id", messageId)
      .limit(1),
    "message lookup",
  );
  const message = rows[0];
  if (!message) throw new ApiError("not_found", "No such message.");

  // §7: retry only an API-failure row — failed AND never assigned a Telnyx
  // id. Carrier-finalized failures (40300 etc.) are not retryable.
  if (
    message.direction !== "outbound" ||
    message.status !== "failed" ||
    message.telnyx_message_id !== null
  ) {
    throw new ApiError(
      "conflict",
      "Only failed sends without a carrier message id can be retried.",
    );
  }

  const view = await loadSendView(db, companyId, message.conversation_id);
  const fromNumber = view.phone_numbers.number_e164;
  if (!fromNumber) {
    throw new ApiError(
      "conflict",
      "This conversation's number is still provisioning.",
    );
  }

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

  // Same row, new Telnyx call (§7): back to queued, error columns cleared.
  const requeued = unwrap<MessageRow[]>(
    await db
      .from("messages")
      .update({ status: "queued", error_code: null, error_detail: null })
      .eq("id", message.id)
      .eq("company_id", companyId)
      .select("*"),
    "message requeue",
  )[0];
  if (!requeued) throw new Error(`message ${message.id} vanished during retry`);

  // Re-mint signed URLs for any stored outbound media (24 h TTL, §8).
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
  const mediaUrls = await signedMediaUrls(
    db,
    attachmentRows.map((row) => row.storage_path),
  );

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
  const body = await parseJsonBody(c, donePatchSchema);
  const db = getDb(env);

  // Company-scoped fetch (§10): a message outside the caller's company is
  // indistinguishable from a missing one — 404 either way.
  const rows = unwrap<MessageRow[]>(
    await db
      .from("messages")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", messageId)
      .limit(1),
    "message lookup",
  );
  const message = rows[0];
  if (!message) throw new ApiError("not_found", "No such message.");

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
  const userId = c.get("userId");
  const { data, error } = await db.rpc("set_message_done", {
    p_company_id: companyId,
    p_message_id: message.id,
    p_done: body.done,
    p_actor_user_id: userId,
  });
  if (error) throw new Error(`set_message_done failed: ${error.message}`);
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
    const conversations = unwrap<{ id: string }[]>(
      await db
        .from("conversations")
        .select("id")
        .eq("company_id", companyId)
        .eq("id", conversationId)
        .limit(1),
      "conversation lookup",
    );
    if (conversations.length === 0) {
      throw new ApiError("not_found", "No such conversation.");
    }

    let query = db
      .from("messages")
      .select(
        "id,conversation_id,direction,body,status,segments,encoding," +
          "sent_by_user_id,error_code,error_detail,telnyx_message_id," +
          "done_at,done_by_user_id,task_id," +
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

    const page = buildPage(rows, limit);
    // D17/T5.1: flag messages that carry a live task so the thread can render
    // the stone task indicator on a promoted message (one batch query/page).
    const promoted = await loadMessageTaskFlags(
      db,
      companyId,
      page.data.map((row) => row.id),
    );
    // TASKS-V2 D-D: resolve the linked task { id, title } for task-linked notes
    // so the thread renders the "on: <task title>" chip (one batch/page).
    const taskLinks = await loadNoteTaskLinks(
      db,
      companyId,
      page.data
        .map((row) => row.task_id)
        .filter((v): v is string => typeof v === "string"),
    );
    return c.json({
      data: page.data.map(({ message_attachments, ...rest }) => ({
        ...rest,
        attachments: message_attachments ?? [],
        has_task: promoted.has(rest.id),
        task:
          typeof rest.task_id === "string"
            ? taskLinks.get(rest.task_id) ?? null
            : null,
      })),
      next_cursor: page.next_cursor,
    });
  },
);
