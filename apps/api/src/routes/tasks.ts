/**
 * Task routes (D17 / TASKS.md T4, §7 conventions) — any active member (M)
 * unless noted. Mounted at /v1. A task is archetype-B *metadata* (assignee,
 * due, notes, attachments) promoted over a real message; it never owns a
 * completion flag. Completion is DERIVED from the joined `messages.done_at`
 * (T2): `status='open'` when NULL, `'done'` otherwise. There is no task-side
 * done column, no mirror, no sync — checking a task's box is the EXISTING
 * `PATCH /v1/messages/:id {done}` (routes/messages.ts), never a task route.
 *
 *   POST   /v1/tasks                 M  — promote a message. Body
 *          { message_id (required), title?, description?, assigned_user_id?,
 *          due_at? }. Resolves conversation_id server-side from the message;
 *          title defaults to the message-body snippet (editable). A second
 *          live promotion of the same message → 409 `conflict` (partial-unique
 *          tasks_message_uq). Writes a `task_created` event. The DB trigger
 *          fires the ID-only `task.changed {conversation_id}` broadcast (T1.3).
 *   GET    /v1/tasks                 M  — flat filtered list, cursor
 *          { data, next_cursor }. Params: status(open|done, applied on the
 *          joined messages.done_at), assigned_user_id(or `me`)|unassigned,
 *          conversation_id, due_before/due_after, overdue, has_location, q
 *          (title trgm). DEFAULT (no params): status=open, assignee=me — the
 *          "what needs me now" view. Keyset (due_at NULLS LAST, id) for
 *          due-sorted views, else (created_at, id) DESC. Live rows only.
 *   GET    /v1/conversations/:id/tasks  M — the conversation checklist (T5.2):
 *          all live tasks for the thread, (created_at) order, { data } (no
 *          cursor). Each carries the derived `done` boolean + attachment_count.
 *   GET    /v1/tasks/:id             M  — detail: row + resolved assignee +
 *          created_by + the joined source message (live body + done_at for the
 *          derived status) + attachments (generic D19 table).
 *   PATCH  /v1/tasks/:id             M  — metadata only { title?, description?,
 *          assigned_user_id?, due_at? }. NO `done` field (completion is the
 *          message route). An assignee change writes `task_assigned`; a due_at
 *          change writes `task_due_set`.
 *   DELETE /v1/tasks/:id             M* — soft-delete (creator or owner/admin):
 *          sets deleted_at, writes `task_deleted`. Does NOT touch
 *          messages.done_at (removing the promotion leaves D14 archetype A).
 *
 * Task attachments are rows in the generic `attachments` table (D19,
 * owner_type='task') served by the generic /v1/attachments routes — there is
 * no task-specific attachment route here (storage-contacts track owns those).
 */
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { decodeCursor, encodeCursor } from "../http/pagination";
import {
  escapeLike,
  keysetFilter,
  parseJsonBody,
  parseLimit,
  pathUuid,
  unwrap,
} from "./core/http";

type Db = ReturnType<typeof getDb>;

// --------------------------------------------------------------------------
// Due-sorted keyset (T6.1: `(due_at NULLS LAST, id)`)
//
// The shared (ts, id) cursor cannot express a NULLS-LAST keyset over the
// nullable `due_at` — a null-due row has no timestamp to seek on, and the
// null rows sort AFTER every dated row. So due-sorted pages carry their own
// opaque token that encodes `due_at` as a nullable field (`d`) alongside `id`,
// and advance with a filter that reproduces the exact `(due_at ASC NULLS LAST,
// id ASC)` order. Created-sorted views keep using the shared (ts, id) cursor.
// --------------------------------------------------------------------------

const dueCursorSchema = z.object({
  /** Last row's due_at (ISO), or null when the last row had no due date. */
  d: z.iso.datetime({ offset: true }).nullable(),
  id: z.uuid(),
});

type DueCursor = z.infer<typeof dueCursorSchema>;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string {
  const base64 = encoded
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  return new TextDecoder().decode(
    Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0)),
  );
}

/** Encode a `(due_at | null, id)` seek key into an opaque due-cursor token. */
function encodeDueCursor(cursor: DueCursor): string {
  return toBase64Url(JSON.stringify(dueCursorSchema.parse(cursor)));
}

/**
 * The `?cursor=` param decoded as a due-cursor. Garbage / a cursor minted for a
 * different (created-sorted) view is 422 `validation_failed` (SPEC §7).
 */
function parseDueCursor(rawCursor: string | undefined): DueCursor | null {
  if (rawCursor === undefined) return null;
  let candidate: unknown;
  try {
    candidate = JSON.parse(fromBase64Url(rawCursor));
  } catch {
    throw new ApiError("validation_failed", "Invalid cursor.");
  }
  const result = dueCursorSchema.safeParse(candidate);
  if (!result.success) {
    throw new ApiError("validation_failed", "Invalid cursor.");
  }
  return result.data;
}

/**
 * PostgREST `or=` filter for the strict-successor of `cursor` under
 * `(due_at ASC NULLS LAST, id ASC)`. The correct seek predicate is:
 *
 *   cursor.d IS NOT NULL (a dated row):
 *     due_at > d                                    -- later dates
 *     OR (due_at = d AND id > cursor.id)            -- same date, later id
 *     OR due_at IS NULL                             -- the whole NULLS-LAST tail
 *
 *   cursor.d IS NULL (already in the null tail):
 *     due_at IS NULL AND id > cursor.id             -- later id among null rows
 *
 * `id` is a UUID (no reserved PostgREST chars) so it needs no escaping here.
 */
function dueKeysetFilter(cursor: DueCursor): string {
  if (cursor.d === null) {
    return `and(due_at.is.null,id.gt.${cursor.id})`;
  }
  return (
    `due_at.gt.${cursor.d},` +
    `and(due_at.eq.${cursor.d},id.gt.${cursor.id}),` +
    `due_at.is.null`
  );
}

/** Columns of the tasks row the API returns (T1.1). No status/done column. */
const TASK_COLUMNS =
  "id,company_id,message_id,conversation_id,title,description," +
  "assigned_user_id,due_at,created_by_user_id,created_at,updated_at";

/**
 * Title column bound (T1.1). The default title (message-body snippet, ≤500,
 * whitespace-collapsed) is seeded inside the `create_task` RPC (T3) — the SQL
 * is the single source of that logic, so the Worker passes `null` for an absent
 * title and never computes the snippet itself.
 */
const TITLE_MAX = 500;

const createSchema = z.object({
  // message_id REQUIRED — every task promotes a real message (T0.1: standalone
  // tasks are cut from MVP; completion always derives from messages.done_at).
  message_id: z.uuid(),
  title: z.string().trim().min(1).max(TITLE_MAX).optional(),
  description: z.string().max(5000).optional(),
  assigned_user_id: z.uuid().nullable().optional(),
  due_at: z.iso.datetime({ offset: true }).nullable().optional(),
});

const patchSchema = z
  .object({
    // Metadata only — there is NO `done` field (completion is the message
    // route, T4). `done` in the body is rejected below so a mis-wired client
    // never silently no-ops.
    title: z.string().trim().min(1).max(TITLE_MAX).optional(),
    description: z.string().max(5000).optional(),
    assigned_user_id: z.uuid().nullable().optional(),
    due_at: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.title !== undefined ||
      body.description !== undefined ||
      "assigned_user_id" in body ||
      "due_at" in body,
    { message: "Provide at least one field to update." },
  );

const STATUS_VALUES = ["open", "done"] as const;

/**
 * Shape of the jsonb the task-mutation RPCs (create_task/assign_task/
 * update_task/delete_task, T3) return: an `outcome` discriminator plus the row
 * (present on created/updated/unchanged). The route maps `outcome` to the §7
 * error/HTTP surface. `task` is left untyped (it is `to_jsonb(tasks)` — the
 * TASK_COLUMNS shape) and returned to the client as-is.
 */
const taskOutcomeSchema = z.object({
  outcome: z.enum([
    "created",
    "updated",
    "unchanged",
    "deleted",
    "not_found",
    "no_message",
    "not_member",
    "conflict",
  ]),
  task: z.record(z.string(), z.unknown()).nullable().optional(),
});

/** Validate a task-RPC jsonb result (garbage → 500 via the thrown error). */
function parseTaskOutcome(data: unknown): z.infer<typeof taskOutcomeSchema> {
  const result = taskOutcomeSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`task RPC returned an unexpected shape: ${result.error}`);
  }
  return result.data;
}

/** Company-scoped live-task fetch (§10 tenant isolation). Null → 404. */
async function findTask(
  db: Db,
  companyId: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const rows = unwrap<Record<string, unknown>[]>(
    await db
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("company_id", companyId)
      .eq("id", id)
      .is("deleted_at", null)
      .limit(1),
    "task lookup",
  );
  return rows[0] ?? null;
}

export const tasksRoutes = new Hono<AppEnv>();

/**
 * POST /v1/tasks — promote a message to a task (T4). This is the route the
 * thread overflow "Make a task" affordance calls (T5.1).
 */
tasksRoutes.post("/tasks", requireRole("member"), async (c) => {
  const body = await parseJsonBody(c, createSchema);
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const db = getDb(getEnv(c.env));

  // T3: the mutation is the `create_task` security-definer RPC — ONE atomic
  // transaction that resolves conversation_id from the source message
  // (company-scoped, §10), validates the assignee, inserts the tasks row (the
  // partial-unique tasks_message_uq is the race-safe conflict arbiter) AND
  // writes the `task_created` audit event together. The route only maps the
  // outcome to the §7 error/HTTP surface; the DB tasks_broadcast trigger fires
  // the ID-only `task.changed` for free (T1.3), so the route publishes no
  // realtime (SPEC §8 broadcast-from-DB).
  const { data, error } = await db.rpc("create_task", {
    p_company_id: companyId,
    p_message_id: body.message_id,
    // undefined title → the RPC seeds the message-body snippet; an empty string
    // can never arrive (createSchema requires min-length 1).
    p_title: body.title ?? null,
    p_description: body.description ?? null,
    p_assigned_user_id: body.assigned_user_id ?? null,
    p_due_at: body.due_at ?? null,
    p_actor_user_id: userId,
  });
  if (error) throw new Error(`create_task failed: ${error.message}`);
  const result = parseTaskOutcome(data);

  if (result.outcome === "no_message") {
    throw new ApiError(
      "validation_failed",
      "message_id: no such message in this company.",
    );
  }
  if (result.outcome === "not_member") {
    throw new ApiError(
      "validation_failed",
      "assigned_user_id: not an active member of this company.",
    );
  }
  if (result.outcome === "conflict") {
    throw new ApiError("conflict", "This message is already a task.");
  }
  if (!result.task) throw new Error("create_task returned no row");
  return c.json(result.task, 201);
});

/**
 * GET /v1/tasks — flat filtered list (T6.1). The derived status filter runs on
 * the joined messages.done_at via an inner-embedded messages resource.
 */
tasksRoutes.get("/tasks", requireRole("member"), async (c) => {
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const limit = parseLimit(c, 25, 100);
  const rawCursor = c.req.query("cursor");
  const db = getDb(getEnv(c.env));

  const status = c.req.query("status");
  if (status !== undefined && !STATUS_VALUES.includes(status as never)) {
    throw new ApiError("validation_failed", "status must be open or done.");
  }
  const overdue = c.req.query("overdue") === "true";
  const hasLocation = c.req.query("has_location") === "true";
  const dueBefore = c.req.query("due_before");
  const dueAfter = c.req.query("due_after");
  const conversationId = c.req.query("conversation_id");
  const rawAssignee = c.req.query("assigned_user_id");
  const unassigned = c.req.query("unassigned") === "true";
  const rawQ = c.req.query("q")?.trim();

  // Any explicit filter opts out of the "what needs me now" default. Only when
  // NO filter param at all is present does the default (status=open,
  // assignee=me) apply (T6.1 "one obvious view").
  const anyFilter =
    status !== undefined ||
    overdue ||
    hasLocation ||
    dueBefore !== undefined ||
    dueAfter !== undefined ||
    conversationId !== undefined ||
    rawAssignee !== undefined ||
    unassigned ||
    (rawQ !== undefined && rawQ !== "");
  const effectiveStatus = status ?? (anyFilter ? undefined : "open");
  const assignee =
    rawAssignee === "me"
      ? userId
      : rawAssignee ?? (anyFilter || unassigned ? undefined : userId);

  // Due-sorted views (overdue / due filters / explicit due sort) key on
  // (due_at NULLS LAST, id); otherwise newest-first (created_at, id) DESC. Each
  // ordering has its OWN cursor shape, so decode the token against the shape
  // this request will use (a token minted for the other view → 422).
  const dueSorted =
    overdue || dueBefore !== undefined || dueAfter !== undefined;
  const dueCursor = dueSorted ? parseDueCursor(rawCursor) : null;
  const createdCursor =
    dueSorted || rawCursor === undefined ? null : decodeCursor(rawCursor);

  // messages!inner embeds the source row so status can filter on done_at and
  // the response carries the derived `done`. has_location joins contacts via
  // the source conversation only when requested (keeps the common path lean).
  const select =
    `${TASK_COLUMNS},messages!inner(id,done_at)` +
    (hasLocation
      ? ",conversations!inner(id,contacts!inner(id,lat,lng))"
      : "");

  let query = db
    .from("tasks")
    .select(select)
    .eq("company_id", companyId)
    .is("deleted_at", null);

  if (effectiveStatus === "open") {
    query = query.is("messages.done_at", null);
  } else if (effectiveStatus === "done") {
    query = query.not("messages.done_at", "is", null);
  }
  if (assignee !== undefined) {
    query = query.eq("assigned_user_id", assignee);
  } else if (unassigned) {
    query = query.is("assigned_user_id", null);
  }
  if (conversationId !== undefined) {
    query = query.eq("conversation_id", conversationId);
  }
  if (dueBefore !== undefined) query = query.lte("due_at", dueBefore);
  if (dueAfter !== undefined) query = query.gte("due_at", dueAfter);
  if (overdue) {
    // Overdue = past due AND not yet done (a done task is never "overdue").
    query = query
      .lt("due_at", new Date().toISOString())
      .is("messages.done_at", null);
  }
  if (hasLocation) {
    query = query.not("conversations.contacts.lat", "is", null);
  }
  if (rawQ !== undefined && rawQ !== "") {
    if (rawQ.length > 200) {
      throw new ApiError("validation_failed", "q: too long (max 200).");
    }
    query = query.ilike("title", `%${escapeLike(rawQ)}%`);
  }

  if (dueSorted) {
    query = query
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
    // Seek to the strict successor of the last row under (due_at NULLS LAST,
    // id) — NOT a bare `id > cursor.id`, which drops/misorders rows whose id is
    // unrelated to the due_at primary key (T6.1).
    if (dueCursor) query = query.or(dueKeysetFilter(dueCursor));
  } else {
    query = query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (createdCursor) query = query.or(keysetFilter("created_at", createdCursor));
  }

  interface TaskListRow {
    id: string;
    created_at: string;
    due_at: string | null;
    messages: { done_at: string | null } | null;
    [key: string]: unknown;
  }
  const rows = unwrap<TaskListRow[]>(
    await query.limit(limit + 1),
    "tasks list",
  );

  const hasNext = rows.length > limit;
  const pageRows = hasNext ? rows.slice(0, limit) : rows;
  const data = pageRows.map((row) => {
    // `messages` (the join used to derive done) and `conversations` (only
    // present for has_location) are read-only join artifacts — strip both from
    // the row shape returned to the client.
    const rest = { ...row } as Record<string, unknown>;
    delete rest.messages;
    delete rest.conversations;
    const done = (row.messages?.done_at ?? null) !== null;
    return { ...rest, done, status: done ? "done" : "open" };
  });

  // next_cursor matches the view's ordering: due-sorted pages advance on the
  // (due_at NULLS LAST, id) key via the due-cursor; created-sorted pages on the
  // standard (created_at, id) keyset. Mixing them would break page 2+ (the bug
  // this fixes), so each view mints only its own token shape.
  let nextCursor: string | null = null;
  if (hasNext) {
    const last = pageRows[pageRows.length - 1];
    nextCursor = dueSorted
      ? encodeDueCursor({ d: last.due_at, id: last.id })
      : encodeCursor({ ts: last.created_at, id: last.id });
  }

  return c.json({ data, next_cursor: nextCursor });
});

/**
 * GET /v1/conversations/:id/tasks — the conversation checklist (T5.2). All
 * live tasks for the thread, (created_at) order, no cursor (a thread's task
 * count is small). Each row carries the derived `done` + attachment_count.
 */
tasksRoutes.get(
  "/conversations/:id/tasks",
  requireRole("member"),
  async (c) => {
    const conversationId = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

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
      return errorResponse(c, "not_found", "No such conversation.");
    }

    interface ChecklistRow {
      id: string;
      messages: { done_at: string | null } | null;
      [key: string]: unknown;
    }
    const rows = unwrap<ChecklistRow[]>(
      await db
        .from("tasks")
        .select(`${TASK_COLUMNS},messages!inner(id,done_at)`)
        .eq("company_id", companyId)
        .eq("conversation_id", conversationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      "conversation tasks",
    );

    // attachment_count: live generic attachments (D19) for these task ids.
    const counts = await attachmentCounts(
      db,
      companyId,
      rows.map((row) => row.id),
    );

    const data = rows.map((row) => {
      const { messages, ...rest } = row;
      const done = (messages?.done_at ?? null) !== null;
      return {
        ...rest,
        done,
        status: done ? "done" : "open",
        attachment_count: counts.get(row.id) ?? 0,
      };
    });
    return c.json({ data });
  },
);

/** Live generic-attachment counts (D19) per task id, one batched lookup. */
async function attachmentCounts(
  db: Db,
  companyId: string,
  taskIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (taskIds.length === 0) return counts;
  const rows = unwrap<{ owner_id: string }[]>(
    await db
      .from("attachments")
      .select("owner_id")
      .eq("company_id", companyId)
      .eq("owner_type", "task")
      .is("deleted_at", null)
      .in("owner_id", taskIds),
    "attachment count lookup",
  );
  for (const row of rows) {
    counts.set(row.owner_id, (counts.get(row.owner_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * GET /v1/tasks/:id — task detail (T6.2). Full row + resolved profiles + the
 * joined source message (live body + done_at for the derived status) + the
 * generic attachments (D19).
 */
tasksRoutes.get("/tasks/:id", requireRole("member"), async (c) => {
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const db = getDb(getEnv(c.env));

  interface DetailRow {
    id: string;
    message_id: string;
    assigned_user_id: string | null;
    created_by_user_id: string;
    messages: { id: string; body: string; done_at: string | null } | null;
    [key: string]: unknown;
  }
  const rows = unwrap<DetailRow[]>(
    await db
      .from("tasks")
      .select(
        `${TASK_COLUMNS},` +
          "messages!inner(id,body,done_at,done_by_user_id,created_at,direction)",
      )
      .eq("company_id", companyId)
      .eq("id", id)
      .is("deleted_at", null)
      .limit(1),
    "task detail",
  );
  const row = rows[0];
  if (!row) {
    return errorResponse(c, "not_found", "No such task.");
  }

  // Resolve assignee + creator display names from profiles (best-effort — a
  // profile may lag; null is fine for rendering).
  const userIds = [row.assigned_user_id, row.created_by_user_id].filter(
    (v): v is string => v !== null,
  );
  const profiles = new Map<string, Record<string, unknown>>();
  if (userIds.length > 0) {
    const found = unwrap<{ user_id: string; display_name: string | null }[]>(
      await db
        .from("profiles")
        .select("user_id,display_name")
        .in("user_id", [...new Set(userIds)]),
      "profiles lookup",
    );
    for (const p of found) profiles.set(p.user_id, p);
  }

  const attachments = unwrap<Record<string, unknown>[]>(
    await db
      .from("attachments")
      .select("id,file_name,content_type,size_bytes,created_at")
      .eq("company_id", companyId)
      .eq("owner_type", "task")
      .eq("owner_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    "task attachments",
  );

  const { messages, ...task } = row;
  const done = (messages?.done_at ?? null) !== null;
  return c.json({
    ...task,
    done,
    status: done ? "done" : "open",
    assignee: row.assigned_user_id
      ? profiles.get(row.assigned_user_id) ?? null
      : null,
    created_by: profiles.get(row.created_by_user_id) ?? null,
    source_message: messages,
    attachments,
  });
});

/**
 * PATCH /v1/tasks/:id — metadata only (T4). No `done` field. An assignee
 * change writes `task_assigned`; a due_at change writes `task_due_set`.
 */
tasksRoutes.patch("/tasks/:id", requireRole("member"), async (c) => {
  const id = pathUuid(c, "id");
  const body = await parseJsonBody(c, patchSchema);
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const db = getDb(getEnv(c.env));

  // T3 splits task metadata across two security-definer RPCs: `update_task`
  // (title/description/due_at — a due_at change writes `task_due_set`) and
  // `assign_task` (assignee — writes `task_assigned`). Each is ONE atomic
  // transaction (the field update AND its audit event together — the gap the
  // old inline-write-then-separate-event path left open). A PATCH touching both
  // metadata and assignee runs both RPCs; the latest returned row (which
  // reflects every applied change) is returned. Each RPC returns `unchanged`
  // for a no-op field (no write, no event, no `task.changed` churn) — the
  // combined no-op still yields the current row via the 404/`unchanged` reads.
  const touchesMeta =
    body.title !== undefined ||
    body.description !== undefined ||
    "due_at" in body;
  const touchesAssignee = "assigned_user_id" in body;

  // Track the freshest task row an RPC returned, and whether the task exists.
  let latest: Record<string, unknown> | null = null;
  let found = false;

  if (touchesMeta) {
    const clearDue = "due_at" in body && (body.due_at ?? null) === null;
    const { data, error } = await db.rpc("update_task", {
      p_company_id: companyId,
      p_task_id: id,
      p_title: body.title ?? null,
      p_description: body.description ?? null,
      // A due_at CLEAR is expressed via p_clear_due (so a null param and a null
      // target value are distinguishable); a concrete value goes in p_due_at.
      p_due_at: clearDue ? null : body.due_at ?? null,
      p_clear_due: clearDue,
      p_actor_user_id: userId,
    });
    if (error) throw new Error(`update_task failed: ${error.message}`);
    const result = parseTaskOutcome(data);
    if (result.outcome === "not_found") {
      return errorResponse(c, "not_found", "No such task.");
    }
    found = true;
    if (result.task) latest = result.task;
  }

  if (touchesAssignee) {
    const { data, error } = await db.rpc("assign_task", {
      p_company_id: companyId,
      p_task_id: id,
      p_assigned_user_id: body.assigned_user_id ?? null,
      p_actor_user_id: userId,
    });
    if (error) throw new Error(`assign_task failed: ${error.message}`);
    const result = parseTaskOutcome(data);
    if (result.outcome === "not_found") {
      return errorResponse(c, "not_found", "No such task.");
    }
    if (result.outcome === "not_member") {
      throw new ApiError(
        "validation_failed",
        "assigned_user_id: not an active member of this company.",
      );
    }
    found = true;
    if (result.task) latest = result.task;
  }

  // Every RPC that ran returned the row (created/updated/unchanged/not_found);
  // `latest` is the freshest. If an assignee no-op preceded nothing else, or a
  // combined no-op, fall back to the current row so the response is always the
  // task's present state.
  if (latest) return c.json(latest);
  if (found) {
    const current = await findTask(db, companyId, id);
    if (!current) return errorResponse(c, "not_found", "No such task.");
    return c.json(current);
  }
  // Neither branch ran (impossible under patchSchema's refine, but typed-safe).
  return errorResponse(c, "not_found", "No such task.");
});

/**
 * DELETE /v1/tasks/:id — soft-delete (T4, M*). Creator OR owner/admin only.
 * Sets deleted_at, writes `task_deleted`. Does NOT touch messages.done_at
 * (removing the promotion leaves D14 archetype A intact). Best-effort object
 * cleanup of the task's generic attachments is a D19 sweep owned by the
 * storage track's cron — the row soft-delete here marks them for that sweep.
 */
tasksRoutes.delete("/tasks/:id", requireRole("member"), async (c) => {
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const role = c.get("role");
  const db = getDb(getEnv(c.env));

  const current = await findTask(db, companyId, id);
  if (!current) {
    return errorResponse(c, "not_found", "No such task.");
  }

  // M*: the creator, or an owner/admin, may delete (T4 role narrowing).
  const isPrivileged = role === "owner" || role === "admin";
  if (!isPrivileged && current.created_by_user_id !== userId) {
    return errorResponse(
      c,
      "forbidden",
      "Only the task's creator or an owner/admin can delete it.",
    );
  }

  // T3: `delete_task` soft-deletes the task, soft-deletes its generic
  // attachment rows (D19), AND writes the `task_deleted` event in ONE atomic
  // transaction. This is the T3 atomicity guarantee: a partial failure can
  // never leave live attachment rows whose owning task is gone leaking into the
  // D21/T7.2 conversation gallery (the generic arm filters
  // attachments.deleted_at IS NULL). The DB tasks_broadcast trigger fires
  // `task.changed` for free (T1.3). It never touches messages.done_at.
  const { data, error } = await db.rpc("delete_task", {
    p_company_id: companyId,
    p_task_id: id,
    p_actor_user_id: userId,
  });
  if (error) throw new Error(`delete_task failed: ${error.message}`);
  const result = parseTaskOutcome(data);
  if (result.outcome === "not_found") {
    // Lost a race with a concurrent delete — already gone.
    return errorResponse(c, "not_found", "No such task.");
  }
  return c.body(null, 204);
});
