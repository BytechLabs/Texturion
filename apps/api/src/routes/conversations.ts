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
 *   GET    /v1/conversations/:id/events      audit timeline, cursor list.
 *   POST   /v1/conversations/:id/tags        { tag_id } | { name }
 *          (create-on-attach).
 *   DELETE /v1/conversations/:id/tags/:tag_id detach.
 */
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { buildPage } from "../http/pagination";
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

const CONVERSATION_COLUMNS =
  "id,company_id,contact_id,phone_number_id,status,is_spam,assigned_user_id," +
  "last_message_at,closed_at,created_at,updated_at";

const MESSAGE_COLUMNS =
  "id,conversation_id,direction,body,status,segments,encoding," +
  "sent_by_user_id,error_code,error_detail,telnyx_message_id," +
  "done_at,done_by_user_id,created_at," +
  "message_attachments(id,content_type,size_bytes)";

const listQuerySchema = z.object({
  status: z.enum(["new", "open", "waiting", "closed"]).optional(),
  assigned_user_id: z.uuid().optional(),
  tag_id: z.uuid().optional(),
  is_spam: z.enum(["true", "false"]).optional(),
  unread: z.enum(["true", "false"]).optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

const patchSchema = z
  .object({
    status: z.enum(["new", "open", "waiting", "closed"]).optional(),
    assigned_user_id: z.uuid().nullable().optional(),
    is_spam: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.status !== undefined ||
      "assigned_user_id" in body ||
      body.is_spam !== undefined,
    { message: "Provide at least one field to update." },
  );

const noteSchema = z
  .object({
    body: z.string().max(4096),
  })
  .refine((value) => value.body.trim().length > 0, {
    message: "body: a note needs text.",
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
  });
  const limit = parseLimit(c, 25, 100);
  const cursor = parseCursor(c);

  const db = getDb(getEnv(c.env));
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

    const { contacts, conversation_tags, ...conversation } = row;
    return c.json({
      ...conversation,
      contact: contacts,
      tags: conversation_tags
        .map((entry) => entry.tags)
        .filter((tag) => tag !== null),
      messages: {
        data: messagesPage.data.map(
          ({ message_attachments, ...message }) => ({
            ...message,
            attachments: message_attachments,
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

    if (events.length === 0) {
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

    // SPEC §6/§7: a note IS a messages row — direction 'note', status NULL
    // (messages_note_status), authored by the caller. It threads, searches,
    // and paginates with the rest of the conversation for free, and the
    // messages broadcast trigger pushes it live (§8).
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
        })
        .select(
          "id,conversation_id,direction,body,status,segments,encoding," +
            "sent_by_user_id,error_code,error_detail,telnyx_message_id," +
            "done_at,done_by_user_id,created_at",
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
    return c.json({ ...note, attachments: [] }, 201);
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
