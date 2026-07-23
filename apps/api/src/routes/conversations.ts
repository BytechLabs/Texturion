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
import { Hono } from "hono";
import { z } from "zod";

import { assertEgressWithinAllowance } from "../attachments/egress";
import { requireRole } from "../auth/company";
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
  isUniqueViolation,
  keysetFilter,
  parseCursor,
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
import { loadAttachments, messageJson } from "./messages";
import type { MessageRow as MsgRow } from "../messaging/types";

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
  })
  .refine(
    (body) =>
      body.status !== undefined ||
      "assigned_user_id" in body ||
      body.is_spam !== undefined ||
      body.pinned !== undefined,
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
});

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

    const rows = unwrap<MsgRow[]>(
      await db
        .from("messages")
        .select("*")
        .eq("company_id", companyId)
        .eq("conversation_id", id)
        .not("pinned_at", "is", null)
        .order("pinned_at", { ascending: false }),
      "pinned messages",
    );
    const attachments = await loadAttachments(
      db,
      companyId,
      rows.map((row) => row.id),
    );
    return c.json({
      data: rows.map((row) => messageJson(row, attachments.get(row.id) ?? [])),
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
    // D17/T5.1: annotate each embedded message with whether a live task rows
    // over it, so the thread shows the stone task indicator (one batch query).
    const promoted = await loadMessageTaskFlags(
      db,
      companyId,
      messagesPage.data.map((message) => message.id),
    );
    // TASKS-V2 D-D: resolve the linked task { id, title } for task-linked notes
    // so the thread renders the "on: <task title>" chip (one batch query).
    const taskLinks = await loadNoteTaskLinks(
      db,
      companyId,
      messagesPage.data
        .map((message) => message.task_id)
        .filter((v): v is string => typeof v === "string"),
    );

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
        event("spam_unmarked", {});
      }
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

    // Message objects carry `attachments` everywhere (§7); notes have none.
    // A task-linked note carries its `task` { id, title } so the thread renders
    // the "on: <task title>" chip immediately, without a refetch (D-D).
    return c.json({ ...note, attachments: [], task: taskLink }, 201);
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
      // (case-insensitive — tags_name_uq is on lower(name)), else create it.
      // The insert races against concurrent attaches; on unique violation the
      // winner's row is re-selected.
      const name = body.name as string;
      const escaped = escapeLike(name);
      const findByName = async (): Promise<TagRow | null> => {
        const rows = unwrap<TagRow[]>(
          await db
            .from("tags")
            .select("id,name,color")
            .eq("company_id", companyId)
            .ilike("name", escaped)
            .limit(1),
          "tag lookup by name",
        );
        return rows[0] ?? null;
      };
      const existing = await findByName();
      if (existing) {
        tag = existing;
      } else {
        const inserted = await db
          .from("tags")
          .insert({ company_id: companyId, name })
          .select("id,name,color");
        if (inserted.error && isUniqueViolation(inserted.error)) {
          const winner = await findByName();
          if (!winner) {
            throw new Error("tag create-on-attach: conflict but no row found");
          }
          tag = winner;
        } else {
          tag = unwrap<TagRow[]>(inserted, "tag create")[0];
        }
      }
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
      pageRows.map((row) => ({ bucket: row.bucket, sizeBytes: row.size_bytes })),
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
