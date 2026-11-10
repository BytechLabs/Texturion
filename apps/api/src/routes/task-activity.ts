/**
 * A task's own history and comments (#689 E). Mounted at /v1.
 *
 *   GET    /v1/tasks/:id/activity            R: what changed on the task, what
 *          the crew said about it, and (for a task promoted from a thread note)
 *          that note. Oldest first within a page; the page is the newest
 *          `limit` entries and `next_cursor` fetches the entries before it.
 *          { data, next_cursor }. Each item is one of
 *            { kind: "event",   id, event, from, to, from_user, to_user, actor, created_at }
 *            { kind: "comment", id, body, author, edited_at, attachments, created_at }
 *            { kind: "note",    id, body, author, created_at }
 *          `event` is a task_events.kind. `from` and `to` are the stored
 *          values (a string, an ISO time, a boolean, an address object or null);
 *          for an `assignee` event they are user ids and `from_user` / `to_user`
 *          carry the names.
 *   POST   /v1/tasks/:id/comments            N: { body } -> 201 the comment.
 *   PATCH  /v1/tasks/:id/comments/:commentId N: { body }; the author only.
 *   DELETE /v1/tasks/:id/comments/:commentId N: soft delete; the author, or an
 *          owner/admin (the same rule as deleting a task). Its files go with it.
 *
 * Files on a comment are `attachments` rows with owner_type "task_comment",
 * uploaded through POST /v1/attachments and served through
 * GET /v1/attachments/:id/url like every other file.
 *
 * ACCESS is the task's own (D148): a task with a conversation is gated like that
 * conversation, a task without one is visible to every active member. A task
 * the caller cannot see is a 404, never a 403. Writing a comment is a note-level
 * act, so a member who may only read the conversation cannot comment on its task.
 */
import { Hono } from "hono";
import { z } from "zod";

import { requireCapability } from "../auth/company";
import {
  requireConversationAccess,
  resolveNumberAccess,
} from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { buildPage, decodeCursor } from "../http/pagination";
import { parseJsonBody, parseLimit, pathUuid, unwrap } from "./core/http";

type Db = ReturnType<typeof getDb>;

const COMMENT_BODY_MAX = 4000;

const commentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "body: write something.")
    .max(COMMENT_BODY_MAX, `body: at most ${COMMENT_BODY_MAX} characters.`),
});

interface Person {
  user_id: string;
  display_name: string | null;
}

interface FileRef {
  id: string;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

interface ActivityRow {
  kind: "event" | "comment" | "note";
  id: string;
  at: string;
  user_id: string | null;
  detail: Record<string, unknown>;
}

const activityOutcomeSchema = z.object({
  outcome: z.enum(["ok", "not_found"]),
  items: z
    .array(
      z.object({
        kind: z.enum(["event", "comment", "note"]),
        id: z.string(),
        at: z.string(),
        user_id: z.string().nullable(),
        detail: z.record(z.string(), z.unknown()),
      }),
    )
    .optional(),
});

async function loadPeople(db: Db, ids: string[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids)];
  const people = new Map<string, Person>();
  if (unique.length === 0) return people;
  const rows = unwrap<Person[]>(
    await db.from("profiles").select("user_id,display_name").in("user_id", unique),
    "task activity profiles",
  );
  for (const row of rows) people.set(row.user_id, row);
  return people;
}

const personOf = (people: Map<string, Person>, id: string | null): Person | null => {
  if (!id) return null;
  return people.get(id) ?? { user_id: id, display_name: null };
};

async function loadCommentFiles(
  db: Db,
  companyId: string,
  commentIds: string[],
): Promise<Map<string, FileRef[]>> {
  const files = new Map<string, FileRef[]>();
  if (commentIds.length === 0) return files;
  const rows = unwrap<(FileRef & { owner_id: string })[]>(
    await db
      .from("attachments")
      .select("id,owner_id,file_name,content_type,size_bytes,created_at")
      .eq("company_id", companyId)
      .eq("owner_type", "task_comment")
      .in("owner_id", commentIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    "task comment files",
  );
  for (const row of rows) {
    const { owner_id, ...file } = row;
    files.set(owner_id, [...(files.get(owner_id) ?? []), file]);
  }
  return files;
}

function shapeItems(
  rows: ActivityRow[],
  people: Map<string, Person>,
  files: Map<string, FileRef[]>,
): Record<string, unknown>[] {
  return rows.map((row) => {
    if (row.kind === "event") {
      const event = row.detail.event;
      const from = row.detail.from ?? null;
      const to = row.detail.to ?? null;
      const named = event === "assignee";
      return {
        kind: "event",
        id: row.id,
        event,
        from,
        to,
        from_user: named && typeof from === "string" ? personOf(people, from) : null,
        to_user: named && typeof to === "string" ? personOf(people, to) : null,
        actor: personOf(people, row.user_id),
        created_at: row.at,
      };
    }
    if (row.kind === "comment") {
      return {
        kind: "comment",
        id: row.id,
        body: row.detail.body,
        author: personOf(people, row.user_id),
        edited_at: row.detail.edited_at ?? null,
        attachments: files.get(row.id) ?? [],
        created_at: row.at,
      };
    }
    return {
      kind: "note",
      id: row.id,
      body: row.detail.body,
      author: personOf(people, row.user_id),
      created_at: row.at,
    };
  });
}

interface TaskGate {
  id: string;
  conversation_id: string | null;
}

/**
 * The live task, or a 404 for one that is missing, deleted, another company's or
 * on a number the caller is denied. `need` is the level a conversation-linked
 * task requires: "read" to look, "note" to write.
 */
async function requireTask(
  c: import("hono").Context<AppEnv>,
  db: Db,
  taskId: string,
  need: "read" | "note",
): Promise<TaskGate | Response> {
  const companyId = c.get("companyId");
  const rows = unwrap<TaskGate[]>(
    await db
      .from("tasks")
      .select("id,conversation_id")
      .eq("company_id", companyId)
      .eq("id", taskId)
      .is("deleted_at", null)
      .limit(1),
    "task gate lookup",
  );
  const task = rows[0];
  if (!task) return errorResponse(c, "not_found", "No such task.");
  if (task.conversation_id) {
    try {
      await requireConversationAccess(db, {
        companyId,
        userId: c.get("userId"),
        role: c.get("role"),
        conversationId: task.conversation_id,
        need,
      });
    } catch {
      return errorResponse(c, "not_found", "No such task.");
    }
  }
  return task;
}

async function loadComment(
  db: Db,
  companyId: string,
  taskId: string,
  commentId: string,
): Promise<{ id: string; author_user_id: string } | null> {
  const rows = unwrap<{ id: string; author_user_id: string }[]>(
    await db
      .from("task_comments")
      .select("id,author_user_id")
      .eq("company_id", companyId)
      .eq("task_id", taskId)
      .eq("id", commentId)
      .is("deleted_at", null)
      .limit(1),
    "task comment lookup",
  );
  return rows[0] ?? null;
}

async function commentItem(
  db: Db,
  companyId: string,
  row: {
    id: string;
    author_user_id: string;
    body: string;
    created_at: string;
    edited_at: string | null;
  },
): Promise<Record<string, unknown>> {
  const [people, files] = await Promise.all([
    loadPeople(db, [row.author_user_id]),
    loadCommentFiles(db, companyId, [row.id]),
  ]);
  return shapeItems(
    [
      {
        kind: "comment",
        id: row.id,
        at: row.created_at,
        user_id: row.author_user_id,
        detail: { body: row.body, edited_at: row.edited_at },
      },
    ],
    people,
    files,
  )[0];
}

const COMMENT_COLUMNS = "id,author_user_id,body,created_at,edited_at";

export const taskActivityRoutes = new Hono<AppEnv>();

taskActivityRoutes.get(
  "/tasks/:id/activity",
  requireCapability("conversations.read"),
  async (c) => {
    const taskId = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const limit = parseLimit(c, 50, 100);
    const rawCursor = c.req.query("cursor");
    const cursor = rawCursor === undefined ? null : decodeCursor(rawCursor);
    const db = getDb(getEnv(c.env));

    const access = await resolveNumberAccess(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
    });
    const { data, error } = await db.rpc("api_task_activity", {
      p_company_id: companyId,
      p_task_id: taskId,
      p_hidden_number_ids: access.hiddenNumberIds,
      // One more than the page, which only signals that an older page exists.
      p_limit: limit + 1,
      p_before_ts: cursor?.ts ?? null,
      p_before_id: cursor?.id ?? null,
    });
    if (error) throw new Error(`api_task_activity failed: ${error.message}`);
    const parsed = activityOutcomeSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`api_task_activity returned an unexpected shape: ${parsed.error}`);
    }
    if (parsed.data.outcome === "not_found") {
      return errorResponse(c, "not_found", "No such task.");
    }

    const rows = (parsed.data.items ?? []).map((item) => ({
      ...item,
      created_at: item.at,
    }));
    const page = buildPage(rows, limit, "created_at");
    const pageRows = [...page.data].reverse() as ActivityRow[];

    const userIds: string[] = [];
    for (const row of pageRows) {
      if (row.user_id) userIds.push(row.user_id);
      if (row.kind === "event" && row.detail.event === "assignee") {
        for (const v of [row.detail.from, row.detail.to]) {
          if (typeof v === "string") userIds.push(v);
        }
      }
    }
    const [people, files] = await Promise.all([
      loadPeople(db, userIds),
      loadCommentFiles(
        db,
        companyId,
        pageRows.filter((row) => row.kind === "comment").map((row) => row.id),
      ),
    ]);

    return c.json({
      data: shapeItems(pageRows, people, files),
      next_cursor: page.next_cursor,
    });
  },
);

taskActivityRoutes.post(
  "/tasks/:id/comments",
  requireCapability("conversations.note"),
  async (c) => {
    const taskId = pathUuid(c, "id");
    const body = await parseJsonBody(c, commentSchema);
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const gate = await requireTask(c, db, taskId, "note");
    if (gate instanceof Response) return gate;

    const rows = unwrap<
      {
        id: string;
        author_user_id: string;
        body: string;
        created_at: string;
        edited_at: string | null;
      }[]
    >(
      await db
        .from("task_comments")
        .insert({
          company_id: companyId,
          task_id: taskId,
          author_user_id: c.get("userId"),
          body: body.body,
        })
        .select(COMMENT_COLUMNS),
      "task comment insert",
    );
    return c.json(await commentItem(db, companyId, rows[0]), 201);
  },
);

taskActivityRoutes.patch(
  "/tasks/:id/comments/:commentId",
  requireCapability("conversations.note"),
  async (c) => {
    const taskId = pathUuid(c, "id");
    const commentId = pathUuid(c, "commentId");
    const body = await parseJsonBody(c, commentSchema);
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const gate = await requireTask(c, db, taskId, "note");
    if (gate instanceof Response) return gate;
    const existing = await loadComment(db, companyId, taskId, commentId);
    if (!existing) return errorResponse(c, "not_found", "No such comment.");
    if (existing.author_user_id !== c.get("userId")) {
      return errorResponse(c, "forbidden", "Only the author can edit a comment.");
    }

    const rows = unwrap<
      {
        id: string;
        author_user_id: string;
        body: string;
        created_at: string;
        edited_at: string | null;
      }[]
    >(
      await db
        .from("task_comments")
        .update({ body: body.body, edited_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("task_id", taskId)
        .eq("id", commentId)
        .is("deleted_at", null)
        .select(COMMENT_COLUMNS),
      "task comment update",
    );
    if (!rows[0]) return errorResponse(c, "not_found", "No such comment.");
    return c.json(await commentItem(db, companyId, rows[0]));
  },
);

taskActivityRoutes.delete(
  "/tasks/:id/comments/:commentId",
  requireCapability("conversations.note"),
  async (c) => {
    const taskId = pathUuid(c, "id");
    const commentId = pathUuid(c, "commentId");
    const companyId = c.get("companyId");
    const role = c.get("role");
    const db = getDb(getEnv(c.env));

    const gate = await requireTask(c, db, taskId, "note");
    if (gate instanceof Response) return gate;
    const existing = await loadComment(db, companyId, taskId, commentId);
    if (!existing) return errorResponse(c, "not_found", "No such comment.");
    const privileged = role === "owner" || role === "admin";
    if (!privileged && existing.author_user_id !== c.get("userId")) {
      return errorResponse(
        c,
        "forbidden",
        "Only the author, or an owner or admin, can delete a comment.",
      );
    }

    const now = new Date().toISOString();
    const gone = unwrap<{ id: string }[]>(
      await db
        .from("task_comments")
        .update({ deleted_at: now })
        .eq("company_id", companyId)
        .eq("task_id", taskId)
        .eq("id", commentId)
        .is("deleted_at", null)
        .select("id"),
      "task comment delete",
    );
    if (!gone[0]) return errorResponse(c, "not_found", "No such comment.");
    // Its files go with it; the storage sweep removes the objects later.
    unwrap<{ id: string }[]>(
      await db
        .from("attachments")
        .update({ deleted_at: now })
        .eq("company_id", companyId)
        .eq("owner_type", "task_comment")
        .eq("owner_id", commentId)
        .is("deleted_at", null)
        .select("id"),
      "task comment files delete",
    );
    return c.body(null, 204);
  },
);
