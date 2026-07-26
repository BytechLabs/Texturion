/**
 * Conversation routes (SPEC §6, §7) — all any-active-member per the §10
 * matrix. POST /v1/conversations (outbound-first compose) belongs to the
 * messaging track and is NOT defined here.
 *
 *   GET    /v1/conversations                 cursor list on
 *          (last_message_at, id) DESC, default 25; filters status,
 *          assigned_user_id, tag_id, is_spam, unread, q — served by the
 *          api_list_conversations SQL function (the per-user `unread`
 *          anti-join is inexpressible in PostgREST). Rows embed contact,
 *          tags, unread, and `last_message` ({ id, direction, body ≤160,
 *          created_at, has_attachments } | null) — the G4 snippet source.
 *   GET    /v1/conversations/:id             conversation + contact + tags +
 *          embedded first page of messages ({ data, next_cursor }, 50/page,
 *          attachments summarized per message).
 *   PATCH  /v1/conversations/:id             { status?, assigned_user_id?,
 *          is_spam? } — closed_at set/cleared with status; mark-as-spam
 *          forces closed (§6); one conversation_events row per changed field.
 *   POST   /v1/conversations/:id/notes       { body } → messages row with
 *          direction='note' (SPEC §6: notes ARE messages rows — they thread,
 *          search, paginate for free; status NULL per messages_note_status).
 *   POST   /v1/conversations/:id/read        upsert conversation_reads.
 *   DELETE /v1/conversations/:id/read        drop the caller's watermark row
 *          (mark unread — the conversation counts as unread again everywhere).
 *   GET    /v1/conversations/:id/events      audit timeline, cursor list.
 *   POST   /v1/conversations/:id/tags        { tag_id } | { name }
 *          (create-on-attach).
 *   DELETE /v1/conversations/:id/tags/:tag_id detach.
 */
import type { BusinessHours } from "@loonext/shared";
import { runAiFeature } from "../ai/run";
import { notifyNoteMention } from "../notifications/mention";
import { Hono } from "hono";
import { z } from "zod";

import {
  loadAiSettings,
} from "../ai/settings";
import {
  assertEgressWithinAllowance,
  assertMintRateWithinLimit,
} from "../attachments/egress";
import { requireRole } from "../auth/company";
import { listConversationViewers } from "../auth/conversation-audience";
import {
  assertNumberLevel,
  requireConversationAccess,
  resolveNumberAccess,
} from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { buildPage, encodeCursor, type Cursor } from "../http/pagination";
import {
  buildSuggestionMessages,
  envelopeShape,
  hasBusinessHours,
  parseSuggestionOutput,
  sanitizeWithReport,
  shouldSuggest,
  SUGGEST_REPLY_CONTEXT_MESSAGES,
  SUGGEST_REPLY_MAX_DRAFT_CHARS,
  SUGGEST_REPLY_MAX_OUTPUT_TOKENS,
  SUGGEST_REPLY_FEATURE_SPEC,
  SUGGEST_REPLY_MODEL,
  type SuggestionMessage,
  threadTextOf,
} from "../messaging/reply-suggestions";
import {
  ATTACHMENTS_BUCKET,
  ATTACHMENT_SIGNED_URL_TTL_SECONDS,
} from "./core/attachments";
import {
  insertConversationEvents,
  type ConversationEventRow,
} from "./core/events";
import {
  escapeLike,
  expectOk,
  keysetFilter,
  parseCursor,
  executionCtxOf,
  parseJsonBody,
  parseLimit,
  parseWith,
  pathUuid,
  unwrap,
} from "./core/http";
import {
  loadMessageTaskFlags,
  loadNoteTaskLinks,
} from "./core/message-tasks";

const MMS_BUCKET = "mms-media";
const MMS_SIGNED_URL_TTL_SECONDS = 3600;

const CONVERSATION_COLUMNS =
  "id,company_id,contact_id,phone_number_id,status,is_spam,assigned_user_id," +
  "pinned_at,pinned_by_user_id,last_message_at,closed_at,created_at,updated_at";

const MESSAGE_COLUMNS =
  "id,conversation_id,direction,body,status,segments,encoding," +
  "sent_by_user_id,error_code,error_detail,telnyx_message_id," +
  "done_at,done_by_user_id,pinned_at,pinned_by_user_id,task_id,created_at," +
  "message_attachments(id,content_type,size_bytes)";

const listQuerySchema = z.object({
  status: z.enum(["new", "open", "waiting", "closed"]).optional(),
  assigned_user_id: z.uuid().optional(),
  tag_id: z.uuid().optional(),
  is_spam: z.enum(["true", "false"]).optional(),
  unread: z.enum(["true", "false"]).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  // #13 pinned-first: 'only' fetches just pinned threads (pinned_at desc, no
  // cursor); 'exclude' is the main keyset list minus pins; absent = all.
  pinned: z.enum(["only", "exclude"]).optional(),
});

const patchSchema = z
  .object({
    status: z.enum(["new", "open", "waiting", "closed"]).optional(),
    assigned_user_id: z.uuid().nullable().optional(),
    is_spam: z.boolean().optional(),
    // #3: pin/unpin a whole conversation to the top of the inbox.
    pinned: z.boolean().optional(),
    // #342: "yes, this is still spam". Answers the review prompt without
    // making the decision permanent again — only literal true has meaning.
    spam_reviewed: z.literal(true).optional(),
  })
  .refine(
    (body) =>
      body.status !== undefined ||
      "assigned_user_id" in body ||
      body.is_spam !== undefined ||
      body.pinned !== undefined ||
      body.spam_reviewed === true,
    { message: "Provide at least one field to update." },
  );

// An attachment-only note is valid: its files upload separately (POST
// /v1/attachments) against the returned note id, so the body may be empty at
// create time. The client enforces "text OR at least one staged file"; the
// server has no attachment context here, so there is no body-required refine.
const noteSchema = z.object({
  body: z.string().max(4096),
  // TASKS-V2 (D17 D-D): an optional link to a task in THIS conversation. A
  // note composed from the task drawer sets this so the note appears both
  // interwoven in the thread AND collected in the task's activity timeline.
  // Validated below to belong to the same conversation + company (422 else).
  task_id: z.uuid().optional(),
  // Teammates named in the body. Capped so one note cannot fan out past the
  // delivery ceiling and silently drop recipients; a crew note that needs more
  // than ten named people wanted the whole team, which assignment already does.
  mention_user_ids: z.array(z.uuid()).max(10).optional(),
});

// The composer's in-progress text, so the drafts can FINISH what the person
// started rather than talk past it. Optional: an empty composer asks for a
// reply from scratch. Generous ceiling; truncated to the model input cap.
const replySuggestionSchema = z
  .object({
    draft: z.string().max(4096).optional(),
  })
  .strict();

const attachTagSchema = z
  .object({
    tag_id: z.uuid().optional(),
    name: z.string().trim().min(1).max(80).optional(),
  })
  .refine((body) => (body.tag_id === undefined) !== (body.name === undefined), {
    message: "Provide exactly one of tag_id or name.",
  });

type Db = ReturnType<typeof getDb>;

/** Company-scoped conversation fetch — the tenant-isolation gate (§10). */
async function findConversation(
  db: Db,
  companyId: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const rows = unwrap<Record<string, unknown>[]>(
    await db
      .from("conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("company_id", companyId)
      .eq("id", id)
      .limit(1),
    "conversation lookup",
  );
  return rows[0] ?? null;
}

export const conversationsRoutes = new Hono<AppEnv>();

conversationsRoutes.get("/conversations", requireRole("member"), async (c) => {
  const query = parseWith(listQuerySchema, {
    status: c.req.query("status"),
    assigned_user_id: c.req.query("assigned_user_id"),
    tag_id: c.req.query("tag_id"),
    is_spam: c.req.query("is_spam"),
    unread: c.req.query("unread"),
    q: c.req.query("q"),
    pinned: c.req.query("pinned"),
  });
  const limit = parseLimit(c, 25, 100);
  const cursor = parseCursor(c);

  const db = getDb(getEnv(c.env));
  // #106: a restricted member's inbox only lists conversations on numbers they
  // can see (null = unrestricted, the common owner/admin/no-rules path).
  const access = await resolveNumberAccess(db, {
    companyId: c.get("companyId"),
    userId: c.get("userId"),
    role: c.get("role"),
  });
  const rows = unwrap<Record<string, unknown>[]>(
    await db.rpc("api_list_conversations", {
      p_company_id: c.get("companyId"),
      p_user_id: c.get("userId"),
      p_limit: limit + 1,
      p_status: query.status ?? null,
      p_assigned_user_id: query.assigned_user_id ?? null,
      p_tag_id: query.tag_id ?? null,
      p_is_spam: query.is_spam === "true",
      p_unread: query.unread === "true",
      p_q: query.q === undefined ? null : escapeLike(query.q),
      p_cursor_ts: cursor?.ts ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_pinned: query.pinned ?? null,
      p_hidden_number_ids: access.hiddenNumberIds,
    }),
    "conversations list",
  );
  return c.json(
    buildPage(
      rows as { id: string; last_message_at: string }[],
      limit,
      "last_message_at",
    ),
  );
});

/**
 * GET /v1/conversations/:id/pinned (#13 part 2) — the conversation's COMPLETE
 * set of pinned messages (pinned_at desc), independent of which thread pages
 * are loaded, so the in-thread "Pinned" banner shows every pin. Company-scoped
 * (§10): a conversation outside the caller's company simply reads as empty.
 */
conversationsRoutes.get(
  "/conversations/:id/pinned",
  requireRole("member"),
  async (c) => {
    const id = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));
    await requireConversationAccess(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      conversationId: id,
      need: "read",
    });

    // Same projection + serialization as the thread list (attachments embedded
    // via PostgREST). `select("*")` here previously dragged the body_tsv
    // tsvector over the wire AND — because messageJson spreads the whole row —
    // leaked the internal columns the thread list deliberately omits
    // (provider_cost COGS, company_id, idempotency_key). Naming the columns
    // fixes both and makes the pinned message shape identical to the thread's.
    const rows = unwrap<
      (Record<string, unknown> & { id: string; message_attachments: unknown[] })[]
    >(
      await db
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("company_id", companyId)
        .eq("conversation_id", id)
        .not("pinned_at", "is", null)
        .order("pinned_at", { ascending: false }),
      "pinned messages",
    );
    return c.json({
      data: rows.map(({ message_attachments, ...message }) => ({
        ...message,
        attachments: message_attachments,
      })),
    });
  },
);

conversationsRoutes.get(
  "/conversations/:id",
  requireRole("member"),
  async (c) => {
    const id = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    interface ConversationDetailRow {
      [key: string]: unknown;
      contacts: Record<string, unknown> | null;
      conversation_tags: { tags: Record<string, unknown> | null }[];
    }
    const rows = unwrap<ConversationDetailRow[]>(
      await db
        .from("conversations")
        .select(
          `${CONVERSATION_COLUMNS},` +
            "contacts(id,name,phone_e164,address,notes,consent_source,consent_at,deleted_at)," +
            "conversation_tags(tags(id,name,color))",
        )
        .eq("company_id", companyId)
        .eq("id", id)
        .limit(1),
      "conversation lookup",
    );
    const row = rows[0];
    if (!row) {
      return errorResponse(c, "not_found", "No such conversation.");
    }

    // #106: hidden numbers 404; the level rides the payload as `viewer_level`
    // so the composer can gate its SMS mode ('note' = notes-only member).
    const viewerLevel = await assertNumberLevel(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      phoneNumberId: row.phone_number_id as string | null,
      need: "read",
    });

    const messageLimit = 50;
    interface MessageRow {
      id: string;
      created_at: string;
      [key: string]: unknown;
      message_attachments: unknown[];
    }
    const messageRows = unwrap<MessageRow[]>(
      await db
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("company_id", companyId)
        .eq("conversation_id", id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(messageLimit + 1),
      "messages page",
    );
    const messagesPage = buildPage(messageRows, messageLimit, "created_at");
    // Both annotations derive from messagesPage.data and are independent of each
    // other — one parallel round-trip, not two serial. D17/T5.1: which messages
    // have a live task over them (the stone task indicator). TASKS-V2 D-D: the
    // linked task { id, title } for task-linked notes (the "on: <title>" chip).
    const [promoted, taskLinks] = await Promise.all([
      loadMessageTaskFlags(
        db,
        companyId,
        messagesPage.data.map((message) => message.id),
      ),
      loadNoteTaskLinks(
        db,
        companyId,
        messagesPage.data
          .map((message) => message.task_id)
          .filter((v): v is string => typeof v === "string"),
      ),
    ]);

    const { contacts, conversation_tags, ...conversation } = row;
    return c.json({
      ...conversation,
      viewer_level: viewerLevel,
      contact: contacts,
      tags: conversation_tags
        .map((entry) => entry.tags)
        .filter((tag) => tag !== null),
      messages: {
        data: messagesPage.data.map(
          ({ message_attachments, ...message }) => ({
            ...message,
            attachments: message_attachments,
            has_task: promoted.has(message.id),
            promoted_task: promoted.get(message.id) ?? null,
            task:
              typeof message.task_id === "string"
                ? taskLinks.get(message.task_id) ?? null
                : null,
          }),
        ),
        next_cursor: messagesPage.next_cursor,
      },
    });
  },
);

conversationsRoutes.patch(
  "/conversations/:id",
  requireRole("member"),
  async (c) => {
    const id = pathUuid(c, "id");
    const body = await parseJsonBody(c, patchSchema);
    const companyId = c.get("companyId");
    const userId = c.get("userId");
    const db = getDb(getEnv(c.env));

    const current = await findConversation(db, companyId, id);
    if (!current) {
      return errorResponse(c, "not_found", "No such conversation.");
    }

    await assertNumberLevel(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      phoneNumberId: current.phone_number_id as string | null,
      need: "note",
    });

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {};
    const events: ConversationEventRow[] = [];
    const event = (
      type: ConversationEventRow["type"],
      payload: Record<string, unknown>,
    ) =>
      events.push({
        company_id: companyId,
        conversation_id: id,
        actor_user_id: userId,
        type,
        payload,
      });

    if (body.status !== undefined && body.status !== current.status) {
      patch.status = body.status;
      patch.closed_at = body.status === "closed" ? now : null;
      event("status_changed", { from: current.status, to: body.status });
    }

    if (body.is_spam !== undefined && body.is_spam !== current.is_spam) {
      patch.is_spam = body.is_spam;
      if (body.is_spam) {
        // "Mark as spam" sets is_spam AND closes the thread (SPEC §6); the
        // forced close overrides any status in the same request. Un-spam only
        // clears the flag — the conversation stays closed.
        patch.status = "closed";
        patch.closed_at = (current.closed_at as string | null) ?? now;
        event("spam_marked", { forced_status: "closed" });
      } else {
        // #342: un-marking clears the review watermark too. The next mark
        // starts a fresh count rather than inheriting a confirmation that was
        // about different messages.
        patch.spam_reviewed_at = null;
        event("spam_unmarked", {});
      }
    }

    // #342: confirming a mark. Deliberately AFTER the is_spam branch, so a
    // request that does both ends with the confirmation — and deliberately
    // not an event: it is a "no change" answer, and a timeline row per
    // dismissal would be the noise this feature exists to avoid.
    if (body.spam_reviewed === true && current.is_spam) {
      patch.spam_reviewed_at = now;
    }

    if (
      "assigned_user_id" in body &&
      body.assigned_user_id !== current.assigned_user_id
    ) {
      if (body.assigned_user_id !== null) {
        const members = unwrap<{ id: string }[]>(
          await db
            .from("company_members")
            .select("id")
            .eq("company_id", companyId)
            .eq("user_id", body.assigned_user_id as string)
            .is("deactivated_at", null)
            .limit(1),
          "assignee lookup",
        );
        if (members.length === 0) {
          throw new ApiError(
            "validation_failed",
            "assigned_user_id: not an active member of this company.",
          );
        }
      }
      patch.assigned_user_id = body.assigned_user_id ?? null;
      event("assigned", {
        from: current.assigned_user_id,
        to: body.assigned_user_id ?? null,
      });
    }

    // #3: pin/unpin — a direct pinned_at/pinned_by update, NO audit event (a pin
    // is organizational, not an audited transition like status/spam/assign).
    // It writes to `patch` but not `events`, so the no-op guard below keys off
    // `patch` (which every real change touches), not `events`.
    if (body.pinned !== undefined && body.pinned !== (current.pinned_at !== null)) {
      patch.pinned_at = body.pinned ? now : null;
      patch.pinned_by_user_id = body.pinned ? userId : null;
    }

    if (Object.keys(patch).length === 0) {
      // Nothing actually changed — idempotent no-op, no timeline noise.
      return c.json(current);
    }

    const updatedRows = unwrap<Record<string, unknown>[]>(
      await db
        .from("conversations")
        .update(patch)
        .eq("company_id", companyId)
        .eq("id", id)
        .select(CONVERSATION_COLUMNS),
      "conversation update",
    );
    const updated = updatedRows[0];
    if (!updated) {
      return errorResponse(c, "not_found", "No such conversation.");
    }

    await insertConversationEvents(db, events);
    return c.json(updated);
  },
);

/**
 * Who this member may name on a note here.
 *
 * A separate route rather than filtering GET /v1/members in the client: the
 * client cannot see `number_access`, so a client-side filter would offer
 * teammates the server is going to reject, and the picker would quietly become
 * a way to find out who has access to which number.
 */
conversationsRoutes.get(
  "/conversations/:id/mentionable-members",
  requireRole("member"),
  async (c) => {
    const id = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const conversation = await findConversation(db, companyId, id);
    if (!conversation) {
      return errorResponse(c, "not_found", "No such conversation.");
    }
    // A number the CALLER cannot see is a 404, never a 403: a 403 would confirm
    // the conversation exists.
    await assertNumberLevel(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      phoneNumberId: conversation.phone_number_id as string | null,
      need: "note",
    });

    // The caller is not offered: naming yourself sends no alert (the notifier
    // drops self-mentions), so listing yourself would be an option that
    // silently does nothing.
    const viewers = (
      await listConversationViewers(db, {
        companyId,
        phoneNumberId: conversation.phone_number_id as string | null,
      })
    ).filter((viewer) => viewer.user_id !== c.get("userId"));

    const displayNames = new Map<string, string>();
    if (viewers.length > 0) {
      const profiles = unwrap<{ user_id: string; display_name: string }[]>(
        await db
          .from("profiles")
          .select("user_id,display_name")
          .in(
            "user_id",
            viewers.map((v) => v.user_id),
          ),
        "profiles lookup",
      );
      for (const profile of profiles) {
        displayNames.set(profile.user_id, profile.display_name);
      }
    }

    return c.json({
      data: viewers.map((viewer) => ({
        user_id: viewer.user_id,
        role: viewer.role,
        display_name: displayNames.get(viewer.user_id) ?? "",
      })),
      next_cursor: null,
    });
  },
);

conversationsRoutes.post(
  "/conversations/:id/notes",
  requireRole("member"),
  async (c) => {
    const id = pathUuid(c, "id");
    const body = await parseJsonBody(c, noteSchema);
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const conversation = await findConversation(db, companyId, id);
    if (!conversation) {
      return errorResponse(c, "not_found", "No such conversation.");
    }

    await assertNumberLevel(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      phoneNumberId: conversation.phone_number_id as string | null,
      need: "note",
    });

    // TASKS-V2 (D17 D-D): a task-linked note must point at a LIVE task in the
    // SAME conversation + company. Anything else (a task in another thread,
    // another company, or a soft-deleted/absent task) is 422 validation_failed
    // — the note-as-discussion invariant, enforced before the insert.
    let taskLink: { id: string; title: string } | null = null;
    if (body.task_id !== undefined) {
      const tasks = unwrap<{ id: string; title: string }[]>(
        await db
          .from("tasks")
          .select("id,title")
          .eq("company_id", companyId)
          .eq("id", body.task_id)
          .eq("conversation_id", id)
          .is("deleted_at", null)
          .limit(1),
        "note task link lookup",
      );
      if (tasks.length === 0) {
        throw new ApiError(
          "validation_failed",
          "task_id: no such live task in this conversation.",
        );
      }
      taskLink = { id: tasks[0].id, title: tasks[0].title };
    }

    // A mention notifies one named person, so the id must belong to a teammate
    // who can already open this thread. Checked BEFORE the insert, because a
    // note body quotes the customer and the alert carries a snippet of it.
    // ONE message for every rejection: a caller must not be able to tell "not
    // in this workspace" from "cannot see this number", which would turn the
    // endpoint into a probe for who has access to what.
    const mentionIds = [...new Set(body.mention_user_ids ?? [])];
    if (mentionIds.length > 0) {
      const viewers = await listConversationViewers(db, {
        companyId,
        phoneNumberId: conversation.phone_number_id as string | null,
      });
      const canSee = new Set(viewers.map((row) => row.user_id));
      if (mentionIds.some((userId) => !canSee.has(userId))) {
        throw new ApiError(
          "validation_failed",
          "mention_user_ids: not a teammate with access to this conversation.",
        );
      }
    }

    // SPEC §6/§7: a note IS a messages row — direction 'note', status NULL
    // (messages_note_status), authored by the caller. It threads, searches,
    // and paginates with the rest of the conversation for free, and the
    // messages broadcast trigger pushes it live (§8). A task_id (validated
    // above) links it to a task for the drawer's activity timeline (D-D).
    const inserted = unwrap<(Record<string, unknown> & { created_at: string })[]>(
      await db
        .from("messages")
        .insert({
          company_id: companyId,
          conversation_id: id,
          direction: "note",
          body: body.body,
          status: null,
          sent_by_user_id: c.get("userId"),
          task_id: body.task_id ?? null,
        })
        .select(
          "id,conversation_id,direction,body,status,segments,encoding," +
            "sent_by_user_id,error_code,error_detail,telnyx_message_id," +
            "done_at,done_by_user_id,pinned_at,pinned_by_user_id,task_id,created_at",
        ),
      "note insert",
    );
    const note = inserted[0];
    if (!note) throw new Error("note insert returned no row");

    // Mentions are a child table of the note, written after it because the
    // foreign key needs the message to exist. The route's tail is already
    // non-atomic (the activity bump below can fail with the note saved), and
    // this inherits that rather than adding a new failure mode: the worst case
    // is a saved note whose mentions did not land, never an alert for a note
    // that does not exist.
    if (mentionIds.length > 0) {
      expectOk(
        await db.from("message_mentions").insert(
          mentionIds.map((userId) => ({
            message_id: note.id as string,
            user_id: userId,
            company_id: companyId,
            conversation_id: id,
          })),
        ),
        "note mentions insert",
      );
    }

    // Notes are messages, so thread activity moves forward — but never
    // backwards (mirrors the greatest() bump in the §6 SQL functions).
    expectOk(
      await db
        .from("conversations")
        .update({ last_message_at: note.created_at })
        .eq("company_id", companyId)
        .eq("id", id)
        .lt("last_message_at", note.created_at),
      "conversation activity bump",
    );

    // Alerting the named teammates is best-effort and must never turn a saved
    // note into an error for its author: a dead push subscription is not the
    // author's problem.
    if (mentionIds.length > 0) {
      const notify = notifyNoteMention(getEnv(c.env), {
        companyId,
        conversationId: id,
        messageId: note.id as string,
        authorUserId: c.get("userId"),
        mentionedUserIds: mentionIds,
        body: body.body,
      }).catch((cause: unknown) => {
        console.error("note mention alert failed:", cause);
      });
      const ctx = executionCtxOf(c);
      if (ctx) ctx.waitUntil(notify);
      else await notify;
    }

    // Message objects carry `attachments` everywhere (§7); notes have none.
    // A task-linked note carries its `task` { id, title } so the thread renders
    // the "on: <task title>" chip immediately, without a refetch (D-D).
    //
    // The 201 is UNCHANGED by mentions: the note body still carries the literal
    // "@Name" text, so every client renders it exactly as before.
    return c.json({ ...note, attachments: [], task: taskLink }, 201);
  },
);

// --------------------------------------------------------------------------
// POST /v1/conversations/:id/reply-suggestions — AI-drafted replies.
//
// A pure SUGGESTION endpoint, exactly like POST /v1/tasks/enrich: it writes no
// message, queues nothing, and never touches the customer. It hands back up to
// three short drafts for the composer, where a person reads, edits, and sends.
// Everything degrades to an empty list — toggle off, no AI binding, nothing to
// reply to, rate-limited, over the monthly cap, model timeout, or output that
// fails validation. See src/messaging/reply-suggestions.ts for the safety rules
// applied to each draft.
//
// Sending requires the 'text' level on the number (#106): a notes-only member
// cannot text this customer, so drafting them a reply would be a dead end.
// --------------------------------------------------------------------------
conversationsRoutes.post(
  "/conversations/:id/reply-suggestions",
  requireRole("member"),
  async (c) => {
    const id = pathUuid(c, "id");
    const body = await parseJsonBody(c, replySuggestionSchema);
    const draft = body.draft?.slice(0, SUGGEST_REPLY_MAX_DRAFT_CHARS) ?? null;
    const companyId = c.get("companyId");
    const env = getEnv(c.env);
    const db = getDb(env);

    const conversation = await findConversation(db, companyId, id);
    if (!conversation) {
      return errorResponse(c, "not_found", "No such conversation.");
    }
    await assertNumberLevel(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      phoneNumberId: conversation.phone_number_id as string | null,
      need: "text",
    });

    const settings = await loadAiSettings(db, companyId);
    if (!settings.suggest_replies) {
      return c.json({
        suggestions: [],
        suggestions_disabled: true,
        reason: "disabled" as const,
      });
    }

    // Customer-visible history only, oldest-first. INTERNAL NOTES ARE EXCLUDED
    // BY THIS FILTER and that is load-bearing: a note is where a crew writes
    // things the customer must never read, so it never reaches the model.
    const history = unwrap<
      { direction: string; body: string | null; created_at: string }[]
    >(
      await db
        .from("messages")
        .select("direction,body,created_at")
        .eq("company_id", companyId)
        .eq("conversation_id", id)
        .in("direction", ["inbound", "outbound"])
        .order("created_at", { ascending: false })
        .limit(SUGGEST_REPLY_CONTEXT_MESSAGES),
      "reply suggestion history",
    );
    const messages: SuggestionMessage[] = history
      .slice()
      .reverse()
      .map((row) => ({
        direction: row.direction === "inbound" ? "inbound" : "outbound",
        body: row.body ?? "",
        // Timing decides how much of the thread is worth reading: the prompt
        // keeps the current exchange and drops history on the far side of a
        // long silence (selectRecentContext).
        created_at: row.created_at,
      }));

    // "Only when needed" (cost): with nothing typed and nothing unanswered,
    // there is nothing to draft. No model call, no unit spent.
    if (!shouldSuggest(messages, draft)) {
      return c.json({ suggestions: [], reason: "nothing_to_reply" as const });
    }
    // No binding (local dev/tests): offer nothing rather than pretend.
    if (!env.AI) return c.json({ suggestions: [], reason: "unavailable" as const });

    // Per-company burst limiter (absent in dev/tests → skipped).
    if (env.AI_REPLY_RATE_LIMITER) {
      const { success } = await env.AI_REPLY_RATE_LIMITER.limit({
        key: companyId,
      });
      if (!success) {
        return c.json({ suggestions: [], reason: "rate_limited" as const });
      }
    }
    // And per MEMBER. The monthly cap is a company ceiling, so without this one
    // member could spend the whole crew's month on their own: a runaway client,
    // a stuck retry, or a stolen token exhausts everyone else's drafts and the
    // cap alert is the first anyone hears of it.
    if (env.AI_MEMBER_RATE_LIMITER) {
      const { success } = await env.AI_MEMBER_RATE_LIMITER.limit({
        key: `${companyId}:${c.get("userId")}`,
      });
      if (!success) {
        return c.json({ suggestions: [], reason: "rate_limited" as const });
      }
    }

    // Both reads are best effort — a draft is worth offering with less
    // context — but NOT silent. A discarded error here degrades every draft
    // quietly, with nothing anywhere to say why.
    const firstRowOrNull = <T>(label: string) =>
      (r: { data: unknown[] | null; error: { message: string } | null }): T | null => {
        if (r.error) {
          console.error(`reply-suggestions ${label} lookup failed:`, r.error.message);
          return null;
        }
        return ((r.data?.[0] as T | undefined) ?? null);
      };

    const [company, contact] = await Promise.all([
      db
        .from("companies")
        .select("name,timezone,business_hours")
        .eq("id", companyId)
        .limit(1)
        .then(
          firstRowOrNull<{
            name: string | null;
            timezone: string | null;
            business_hours: BusinessHours | null;
          }>("company"),
        ),
      db
        // `name`, singular. The contacts table has one name column;
        // first_name / last_name exist only as merge-field TOKENS in the
        // composer. Greeting the customer by name is the strongest signal a
        // draft has, so getting this column wrong costs every draft.
        .from("contacts")
        .select("name")
        .eq("company_id", companyId)
        .eq("id", conversation.contact_id as string)
        .limit(1)
        .then(firstRowOrNull<{ name: string | null }>("contact")),
    ]);
    const contactName = contact?.name?.trim() || null;

    const prompt = buildSuggestionMessages({
      companyName: company?.name ?? "",
      contactName,
      messages,
      timezone: company?.timezone ?? "America/Toronto",
      now: new Date(),
      // Only a company that has actually set hours gets them in the prompt; the
      // default is an empty jsonb map, which reads as unset.
      businessHours: company?.business_hours ?? null,
      businessDescription: settings.business_description,
      draft,
    });

    // One door onto the model (ai/run.ts): it owns the opt-in, the monthly cap,
    // the alert before the cap, and the timeout.
    const run = await runAiFeature(env, db, {
      companyId,
      spec: SUGGEST_REPLY_FEATURE_SPEC,
      model: SUGGEST_REPLY_MODEL,
      input: { messages: prompt, max_tokens: SUGGEST_REPLY_MAX_OUTPUT_TOKENS },
      settings,
    });
    if (!run.ok) {
      // A model that is unreachable, renamed, or slow looks exactly like "no
      // ideas" to the person waiting, which is the least useful thing we could
      // tell them. The gate's reason maps straight onto what the composer says.
      return c.json({ suggestions: [], reason: run.reason });
    }

    // Drafting without a description is drafting blind: the prompt forbids
    // saying anything about the trade, so a workspace that never filled it in
    // gets thinner drafts forever with nothing anywhere to say why. Reported
    // alongside the drafts so it can be offered where it is felt.
    const businessUnknown = !settings.business_description?.trim();
    const parsed = parseSuggestionOutput(run.raw);
    const report = sanitizeWithReport(parsed, {
      threadText: threadTextOf(messages),
      draft,
      // Only a company that really set hours may have them stated back.
      hoursKnown: hasBusinessHours(company?.business_hours ?? null),
      descriptionKnown: !businessUnknown,
    });
    const suggestions = report.kept;
    if (suggestions.length === 0) {
      // The model answered but nothing survived parsing or the safety rules
      // (every draft carried an invented link, price, or phone number). Worth
      // distinguishing: it means the model IS reachable and the prompt or the
      // filters are what need work.
      console.error(
        `reply suggestions unusable: ${parsed.length} candidate(s), 0 passed ` +
          `(${JSON.stringify(report.dropped)})`,
      );
      // The counts ride along so a workspace hitting this can say WHICH rule
      // fired. They carry no message text — only how many drafts each rule
      // removed — and they are what turns "nothing to suggest" from a shrug
      // into something anyone can act on.
      return c.json({
        suggestions: [],
        reason: "unusable_output" as const,
        dropped: { candidates: parsed.length, ...report.dropped },
        // The envelope's KEY NAMES only (never its contents). Zero candidates
        // with nothing dropped means we did not recognise the shape at all,
        // and this is what names it.
        envelope: envelopeShape(run.raw),
      });
    }
    // The tally rides along whenever anything was discarded, not only when
    // everything was: a set that came back thinner than it should have is the
    // same question ("which rule fired?") asked more quietly.
    const discarded = Object.values(report.dropped).reduce((a, b) => a + b, 0);
    return discarded > 0
      ? c.json({
          suggestions,
          business_unknown: businessUnknown,
          dropped: { candidates: parsed.length, ...report.dropped },
        })
      : c.json({ suggestions, business_unknown: businessUnknown });
  },
);

conversationsRoutes.post(
  "/conversations/:id/read",
  requireRole("member"),
  async (c) => {
    const id = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const conversation = await findConversation(db, companyId, id);
    if (!conversation) {
      return errorResponse(c, "not_found", "No such conversation.");
    }

    await assertNumberLevel(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      phoneNumberId: conversation.phone_number_id as string | null,
      need: "read",
    });

    const read = {
      conversation_id: id,
      user_id: c.get("userId"),
      last_read_at: new Date().toISOString(),
    };
    expectOk(
      await db
        .from("conversation_reads")
        .upsert(read, { onConflict: "conversation_id,user_id" }),
      "conversation_reads upsert",
    );
    return c.json(read);
  },
);

conversationsRoutes.delete(
  "/conversations/:id/read",
  requireRole("member"),
  async (c) => {
    const id = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const conversation = await findConversation(db, companyId, id);
    if (!conversation) {
      return errorResponse(c, "not_found", "No such conversation.");
    }

    await assertNumberLevel(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      phoneNumberId: conversation.phone_number_id as string | null,
      need: "read",
    });

    // Unread is derived: no watermark row means the last message is newer
    // than anything the caller has read. Deleting is idempotent by nature.
    expectOk(
      await db
        .from("conversation_reads")
        .delete()
        .eq("conversation_id", id)
        .eq("user_id", c.get("userId")),
      "conversation_reads delete",
    );
    return c.body(null, 204);
  },
);

conversationsRoutes.get(
  "/conversations/:id/events",
  requireRole("member"),
  async (c) => {
    const id = pathUuid(c, "id");
    const limit = parseLimit(c, 50, 100);
    const cursor = parseCursor(c);
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const conversation = await findConversation(db, companyId, id);
    if (!conversation) {
      return errorResponse(c, "not_found", "No such conversation.");
    }

    await assertNumberLevel(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      phoneNumberId: conversation.phone_number_id as string | null,
      need: "read",
    });

    let query = db
      .from("conversation_events")
      .select("id,conversation_id,actor_user_id,type,payload,created_at")
      .eq("company_id", companyId)
      .eq("conversation_id", id);
    if (cursor) {
      query = query.or(keysetFilter("created_at", cursor));
    }
    const rows = unwrap<{ id: string; created_at: string }[]>(
      await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1),
      "conversation events page",
    );
    return c.json(buildPage(rows, limit, "created_at"));
  },
);

conversationsRoutes.post(
  "/conversations/:id/tags",
  requireRole("member"),
  async (c) => {
    const id = pathUuid(c, "id");
    const body = await parseJsonBody(c, attachTagSchema);
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const conversation = await findConversation(db, companyId, id);
    if (!conversation) {
      return errorResponse(c, "not_found", "No such conversation.");
    }

    await assertNumberLevel(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      phoneNumberId: conversation.phone_number_id as string | null,
      need: "note",
    });

    interface TagRow {
      id: string;
      name: string;
      color: string | null;
    }
    let tag: TagRow;

    if (body.tag_id !== undefined) {
      const rows = unwrap<TagRow[]>(
        await db
          .from("tags")
          .select("id,name,color")
          .eq("company_id", companyId)
          .eq("id", body.tag_id)
          .limit(1),
        "tag lookup",
      );
      if (!rows[0]) {
        return errorResponse(c, "not_found", "No such tag.");
      }
      tag = rows[0];
    } else {
      // Create-on-attach (SPEC §7): reuse the company's tag with this name
      // (case-insensitive — tags_name_uq is on lower(name)), else create it, in
      // ONE atomic RPC. The old ilike-by-name lookup used escapeLike, which
      // STRIPS '*' (PostgREST maps '*'->'%' unescapably), so a name with a '*'
      // matched the wrong tag or 500'd on the second attach — and it raced the
      // concurrent create/select. The RPC keys on (company_id, lower(name)).
      const name = body.name as string;
      const rows = unwrap<TagRow[]>(
        await db.rpc("api_find_or_create_tag", {
          p_company_id: companyId,
          p_name: name,
        }),
        "tag find-or-create",
      );
      if (!rows[0]) {
        throw new Error("tag find-or-create: no row returned");
      }
      tag = rows[0];
    }

    // ignoreDuplicates: attaching an already-attached tag is a no-op (200,
    // no duplicate timeline event); a fresh attach returns the inserted row.
    const attached = unwrap<unknown[]>(
      await db
        .from("conversation_tags")
        .upsert(
          { conversation_id: id, tag_id: tag.id },
          { onConflict: "conversation_id,tag_id", ignoreDuplicates: true },
        )
        .select("conversation_id,tag_id"),
      "tag attach",
    );

    if (attached.length > 0) {
      await insertConversationEvents(db, [
        {
          company_id: companyId,
          conversation_id: id,
          actor_user_id: c.get("userId"),
          type: "tag_added",
          payload: { tag_id: tag.id, name: tag.name },
        },
      ]);
      return c.json(tag, 201);
    }
    return c.json(tag);
  },
);

conversationsRoutes.delete(
  "/conversations/:id/tags/:tag_id",
  requireRole("member"),
  async (c) => {
    const id = pathUuid(c, "id");
    const tagId = pathUuid(c, "tag_id");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const conversation = await findConversation(db, companyId, id);
    if (!conversation) {
      return errorResponse(c, "not_found", "No such conversation.");
    }

    await assertNumberLevel(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      phoneNumberId: conversation.phone_number_id as string | null,
      need: "note",
    });

    const deleted = unwrap<unknown[]>(
      await db
        .from("conversation_tags")
        .delete()
        .eq("conversation_id", id)
        .eq("tag_id", tagId)
        .select("tag_id"),
      "tag detach",
    );
    if (deleted.length === 0) {
      return errorResponse(c, "not_found", "Tag is not attached.");
    }

    await insertConversationEvents(db, [
      {
        company_id: companyId,
        conversation_id: id,
        actor_user_id: c.get("userId"),
        type: "tag_removed",
        payload: { tag_id: tagId },
      },
    ]);
    return c.body(null, 204);
  },
);

// ---------------------------------------------------------------------------
// Attachments gallery (D21 / APP-FEATURES-V2 §4.2 / TASKS.md T7.2)
// ---------------------------------------------------------------------------

/** Canonical gallery source enum (T7.3). */
type GallerySource = "mms" | "note" | "task";

/** One merged gallery item, pre-signing. */
interface GalleryRow {
  id: string;
  source: GallerySource;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
  /** Storage bucket + object key so the API mints the signed URL (never leaked). */
  bucket: string;
  objectPath: string;
}

/** `kind` drives the Images | Files client-side tabs (T7.3). */
function attachmentKind(contentType: string | null): "image" | "file" {
  return contentType?.toLowerCase().startsWith("image/") ? "image" : "file";
}

/**
 * Descending `(created_at, id)` comparison — the gallery's merge/sort order
 * (APP-FEATURES-V2 §4.2: "merges/sorts (created_at, id) DESC in the API layer").
 */
function galleryDesc(a: GalleryRow, b: GalleryRow): number {
  if (a.created_at !== b.created_at) {
    return a.created_at < b.created_at ? 1 : -1;
  }
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Keyset predicate for one arm: rows strictly before the cursor `(ts, id)`. */
function beforeCursor(row: { created_at: string; id: string }, cursor: Cursor): boolean {
  if (row.created_at !== cursor.ts) return row.created_at < cursor.ts;
  return row.id < cursor.id;
}

/**
 * GET /v1/conversations/:id/attachments — the two-arm union gallery (D21).
 * Arm 1 (MMS): message_attachments JOINed through messages for the
 * conversation scope (message_attachments has no conversation_id column).
 * Arm 2 (generic): the D19 attachments table, which denormalizes
 * conversation_id (so note AND task attachments arrive with no join). The two
 * arms have DIFFERENT join shapes, so they are fetched separately, tagged with
 * a `source`, merged, and sorted (created_at, id) DESC in the API layer — never
 * a single SQL view. Cursor-paginated; each returned item carries a
 * freshly-minted short-lived signed URL (the endpoint is the single authorize +
 * sign point — the browser never holds a Storage grant).
 */
conversationsRoutes.get(
  "/conversations/:id/attachments",
  requireRole("member"),
  async (c) => {
    const id = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const limit = parseLimit(c, 25, 100);
    const cursor = parseCursor(c);
    const env = getEnv(c.env);
    const db = getDb(env);

    // #261: bound the mint RATE before doing any work for it. This route signs
    // up to 100 objects per call, so it is the cheaper of the two side doors.
    await assertMintRateWithinLimit(env, companyId, c.get("userId"));

    const conversation = await findConversation(db, companyId, id);
    if (!conversation) {
      return errorResponse(c, "not_found", "No such conversation.");
    }

    await assertNumberLevel(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      phoneNumberId: conversation.phone_number_id as string | null,
      need: "read",
    });

    // Over-fetch limit+1 per arm so the merged, sliced result is correct
    // regardless of how the page boundary falls across the two arms.
    const fetchCount = limit + 1;

    // Arm 1 — MMS: message_attachments JOINed through messages (SPEC §6: the
    // conversation scope lives on messages, not message_attachments). The
    // embedded `messages!inner(...)` filters to this conversation + company.
    interface MmsArmRow {
      id: string;
      storage_path: string;
      content_type: string | null;
      size_bytes: number | null;
      created_at: string;
    }
    let mmsQuery = db
      .from("message_attachments")
      .select(
        "id,storage_path,content_type,size_bytes,created_at," +
          "messages!inner(conversation_id,company_id)",
      )
      .eq("company_id", companyId)
      .eq("messages.conversation_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(fetchCount);
    if (cursor) mmsQuery = mmsQuery.or(keysetFilter("created_at", cursor));
    const mmsRows = unwrap<MmsArmRow[]>(await mmsQuery, "gallery mms arm");

    // Arm 2 — generic: the D19 table denormalizes conversation_id (no join).
    // Supplies both note and task attachments (task attachments for free, T7.2).
    interface GenericArmRow {
      id: string;
      owner_type: "note" | "task";
      storage_path: string;
      file_name: string | null;
      content_type: string | null;
      size_bytes: number | null;
      created_at: string;
    }
    let genericQuery = db
      .from("attachments")
      .select(
        "id,owner_type,storage_path,file_name,content_type,size_bytes,created_at",
      )
      .eq("company_id", companyId)
      .eq("conversation_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(fetchCount);
    if (cursor) genericQuery = genericQuery.or(keysetFilter("created_at", cursor));
    const genericRows = unwrap<GenericArmRow[]>(
      await genericQuery,
      "gallery generic arm",
    );

    // Tag + normalize each arm into the merged shape. MMS storage_path may
    // carry the legacy `mms-media/` bucket prefix (SPEC §6) — strip for signing.
    const merged: GalleryRow[] = [
      ...mmsRows.map((row) => ({
        id: row.id,
        source: "mms" as const,
        file_name: null,
        content_type: row.content_type,
        size_bytes: row.size_bytes,
        created_at: row.created_at,
        bucket: MMS_BUCKET,
        objectPath: row.storage_path.replace(/^mms-media\//, ""),
      })),
      ...genericRows.map((row) => ({
        id: row.id,
        source: row.owner_type,
        file_name: row.file_name,
        content_type: row.content_type,
        size_bytes: row.size_bytes,
        created_at: row.created_at,
        bucket: ATTACHMENTS_BUCKET,
        objectPath: row.storage_path,
      })),
    ];

    // Defensive: if a cursor round-trip ever admits a boundary row, drop any
    // item not strictly before the cursor before sorting.
    const scoped = cursor
      ? merged.filter((row) => beforeCursor(row, cursor))
      : merged;
    scoped.sort(galleryDesc);

    const hasMore = scoped.length > limit;
    const pageRows = hasMore ? scoped.slice(0, limit) : scoped;
    const nextCursor =
      hasMore && pageRows.length > 0
        ? encodeCursor({
            ts: pageRows[pageRows.length - 1].created_at,
            id: pageRows[pageRows.length - 1].id,
          })
        : null;

    // #16: claim the page's egress (per-bucket subtotals, one shared pool)
    // BEFORE any signing — over the allowance the page 402s usage_cap_reached
    // and nothing is signed; a claim error signs nothing (fail closed). NULL
    // sizes claim 0, matching the /v1/attachments/:id/url route's posture.
    await assertEgressWithinAllowance(
      db,
      companyId,
      pageRows.map((row) => ({
        bucket: row.bucket,
        path: row.objectPath,
        sizeBytes: row.size_bytes,
      })),
      MMS_SIGNED_URL_TTL_SECONDS,
    );

    // Sign each item's object (short-lived) — the single authorize+sign point.
    const data = await Promise.all(
      pageRows.map(async (row) => {
        const ttl =
          row.bucket === MMS_BUCKET
            ? MMS_SIGNED_URL_TTL_SECONDS
            : ATTACHMENT_SIGNED_URL_TTL_SECONDS;
        const { data: signed, error } = await db.storage
          .from(row.bucket)
          .createSignedUrl(row.objectPath, ttl);
        if (error || !signed?.signedUrl) {
          throw new Error(
            `gallery signed URL failed (${row.bucket}/${row.objectPath}): ${error?.message ?? "no URL"}`,
          );
        }
        return {
          id: row.id,
          source: row.source,
          kind: attachmentKind(row.content_type),
          file_name: row.file_name,
          content_type: row.content_type,
          size_bytes: row.size_bytes,
          created_at: row.created_at,
          url: signed.signedUrl,
        };
      }),
    );

    return c.json({ data, next_cursor: nextCursor });
  },
);
