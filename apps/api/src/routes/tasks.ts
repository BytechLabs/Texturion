/**
 * Task routes (D17 / TASKS.md T4, §7 conventions) — any active member (M)
 * unless noted. Mounted at /v1. A task is archetype-B *metadata* (assignee,
 * due, notes, attachments) promoted over a SOURCE: a real message or, since
 * D64, an answered call. Exactly one row owns its done state (D17 as amended):
 * the source message's `messages.done_at` when there is one (T2), else the
 * task's own `done_at`. `status='open'` when NULL, `'done'` otherwise. A
 * message task is checked off with the EXISTING `PATCH /v1/messages/:id
 * {done}` (routes/messages.ts); a call or standalone task with
 * `PATCH /v1/tasks/:id {done}`.
 * Every task row carries `source: {kind: 'message'|'call', id} | null`; null is
 * a standalone task (D64 amended, #689).
 *
 *   POST   /v1/tasks                 M  — promote a message, promote an answered
 *          call, or create a standalone task.
 *          Body { message_id | source_call_id | neither, title?, description?,
 *          assignee_ids? (up to 10) | assigned_user_id? (one person), due_at?,
 *          address?, contact_id?, conversation_id? }.
 *          `title` is required when there is no source; `contact_id` and
 *          `conversation_id` link a standalone task only. A standalone task's
 *          assignee defaults to the creator (an explicit null leaves it
 *          unassigned). A source resolves conversation_id server-side (a call's
 *          own conversation); title defaults to the message-body snippet /
 *          "Call from <caller>" (editable). A second live promotion of the same
 *          source → 409 `conflict` (partial-unique tasks_message_uq /
 *          tasks_source_call_uq). Writes a `task_created` event when the task
 *          has a conversation. The DB trigger fires the ID-only
 *          `task.changed {conversation_id}` broadcast (T1.3).
 *   GET    /v1/tasks                 M  — flat filtered list, cursor
 *          { data, next_cursor }. Params: status(open|done, applied on the
 *          task's effective done state), assigned_user_id(or `me`; matches any
 *          assignee)|unassigned,
 *          conversation_id, due_before/due_after, overdue, has_location, q
 *          (title trgm). DEFAULT (no params): status=open, assignee=me — the
 *          "what needs me now" view. Keyset (due_at NULLS LAST, id) for
 *          due-sorted views, else (created_at, id) DESC. Live rows only.
 *   GET    /v1/conversations/:id/tasks  M — the conversation checklist (T5.2):
 *          all live tasks for the thread, (created_at) order, { data } (no
 *          cursor). Each carries the derived `done` boolean + attachment_count
 *          (the size of the SAME D28 union the detail returns).
 *   GET    /v1/tasks/:id             M  — detail: row + resolved assignee +
 *          created_by + the joined source message (live body) or source call
 *          + attachments (the D28 DERIVED union — see below).
 *   PATCH  /v1/tasks/:id             M  — { title?, description?,
 *          assignee_ids? | assigned_user_id? (exactly that one person), due_at?,
 *          done? }. `done` is accepted only for a
 *          task with no message (the task owns its done state); for a message
 *          task it is 422 and the client uses the message route. An assignee
 *          change writes `task_assigned`; a due_at change writes `task_due_set`.
 *   DELETE /v1/tasks/:id             M* — soft-delete (creator or owner/admin):
 *          sets deleted_at, writes `task_deleted`. Does NOT touch
 *          messages.done_at (removing the promotion leaves D14 archetype A).
 *
 * Task attachments are DERIVED, never owned (D28 — the same derive-over-own
 * model as completion): a task's `attachments` array unions (a) the source
 * message's MMS media (message_attachments), (b) the generic attachments of
 * notes linked to the task (messages.task_id + direction='note') — which, when
 * a NOTE was promoted, INCLUDES the source note itself (create_task links the
 * promoted note back via messages.task_id so its own files surface here) — and
 * (c) any legacy owner_type='task' rows (pre-D28; upload of new ones is closed). Each
 * item is gallery-shaped ({id, source, kind, file_name, content_type,
 * size_bytes, created_at}) WITHOUT a pre-signed url — the web mints one per
 * item via the existing GET /v1/attachments/:id/url (which serves all three
 * sources). There is no task-specific attachment route here.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { runAiFeature } from "../ai/run";
import { z } from "zod";

import {
  loadAiSettings,
} from "../ai/settings";
import { requireCapability } from "../auth/company";
import { alarmOnBulkContactAccess } from "../audit/bulk-contact-alarm";
import { recordAuditFromRequest } from "../audit/log";
import { readTaskEntries, taskCsvRows } from "../workspace/tasks-export";
import { csvResponse } from "./core/csv";
import {
  assertNumberLevel,
  requireConversationAccess,
  resolveConversationLevel,
  resolveNumberAccess,
} from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { companySettingDefault, roleHasCapability } from "@loonext/shared";
import { doneToggleAction, taskAllowedActions } from "./task-actions";
import { ApiError, errorResponse } from "../http/errors";
import { reportHandledFailure, workerEnv } from "../observability/capture";
import { captureUnusableModelOutput } from "../ai/output";
import { syncTaskReminders } from "../messaging/appointment-reminders";
import { mayHoldReference, syncReferences } from "../tasks/references";
import { assigneeIdsSchema, MAX_ASSIGNEES, requestedAssignees } from "../tasks/assignees";
import { afterTaskCreated, afterTasksCompleted, notifyAssignedTask, syncRemindersAfterWrite } from "../tasks/follow-ups";
import type { TaskCompletion } from "../tasks/follow-ups";
import { notifyTaskChangeSafely } from '../tasks/notify';
import type { TaskChange } from '../tasks/notify';
import { PRIORITY_RANK, prioritySchema, repeatSchema, scopeSchema, withLabelsAndRepeat, withLabelsAndRepeatOne } from '../tasks/repeat';
import type { TaskPriority } from '../tasks/repeat';
import { decodeCursor, encodeCursor } from "../http/pagination";
import {
  buildEnrichmentMessages,
  buildEnrichmentResult,
  detectEnrichmentSignals,
  ENRICHMENT_FEATURE_SPEC,
  ENRICHMENT_MAX_INPUT_CHARS,
  ENRICHMENT_MAX_OUTPUT_TOKENS,
  ENRICHMENT_MODEL,
  parseEnrichmentOutput,
} from "../tasks/enrichment";
import {
  escapeLike,
  executionCtxOf,
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
    .replace(/[=]+$/, "");
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
/**
 * #478: the task list's filters, in ONE place.
 *
 * They used to live inline in the GET handler, which was fine while the list
 * was the only reader. The bulk route is the second: "mark everything matching
 * this filter done" has to mean exactly what the list showed, and the only way
 * to guarantee that is for both to run the same code rather than two
 * implementations that agree today.
 *
 * The alternative considered and rejected was re-expressing these predicates in
 * SQL inside the bulk RPC. That would have made "what the list shows" and "what
 * the bulk action touches" two separate definitions, and they would have drifted
 * the first time somebody added a filter to one — silently, and in the direction
 * where a bulk action reaches rows the user never saw.
 *
 * The ordering and cursor belong to pagination, outside the selection.
 */
interface TaskFilters {
  /** The workspace, so the assignee embed is read through its company-led index. */
  companyId: string;
  /** "task_done_at" (computed column) on the list path, "done_at" on the flat map view. */
  doneAtCol: string;
  effectiveStatus: string | undefined;
  /** On the task. The caller adds the `task_assignees!inner` embed. */
  assignee: string | undefined;
  unassigned: boolean;
  conversationId: string | undefined;
  dueBefore: string | undefined;
  dueAfter: string | undefined;
  dueOnBefore?: string;
  dueOnAfter?: string;
  overdue: boolean;
  confirmed?: boolean;
  search?: string;
  /** #693: any of these priorities. */
  priorities?: string[];
  /** #693: carries this tag. The caller adds the `task_tags!inner` embed. */
  tagId?: string;
  /** #690: a PostgREST `or` that matches the contact directly or through its conversations. */
  contactOr?: string;
  /** #690: made by this member. */
  createdBy?: string;
  /** #690: promoted from a text, from a call, or neither. */
  source?: "text" | "call" | "none";
  /** #690: carries a file by the D28 union. */
  hasAttachments?: boolean;
  /**
   * #690: referenced from somewhere the caller may see. The caller adds the
   * `record_references!target_task_id!inner` embed; this is the hidden-number
   * rule for it (an empty list when nothing is hidden).
   */
  referencedHidden?: string[];
}

function applyTaskFilters<T>(query: T, filters: TaskFilters): T {
  // The PostgREST builder is fluent and untyped across these calls; the cast
  // keeps the caller's concrete type without restating the builder's generics.
  let q = query as never as {
    is(col: string, value: null): typeof q;
    not(col: string, op: string, value: null): typeof q;
    eq(col: string, value: string): typeof q;
    lte(col: string, value: string): typeof q;
    gte(col: string, value: string): typeof q;
    lt(col: string, value: string): typeof q;
    in(col: string, values: string[]): typeof q;
    ilike(col: string, value: string): typeof q;
    or(filters: string, options?: { referencedTable: string }): typeof q;
  };
  const { doneAtCol } = filters;

  if (filters.effectiveStatus === "open") {
    q = q.is(doneAtCol, null);
  } else if (filters.effectiveStatus === "done") {
    q = q.not(doneAtCol, "is", null);
  }
  if (filters.assignee !== undefined) {
    // #689 C: "mine" means I am ONE of them, not the first.
    q = q
      .eq("task_assignees.company_id", filters.companyId)
      .eq("task_assignees.user_id", filters.assignee);
  } else if (filters.unassigned) {
    q = q.is("assigned_user_id", null);
  }
  if (filters.conversationId !== undefined) {
    q = q.eq("conversation_id", filters.conversationId);
  }
  if (filters.dueBefore !== undefined) {
    q = filters.dueOnBefore
      ? q.or(`due_at.lte.${filters.dueBefore},due_on.lte.${filters.dueOnBefore}`)
      : q.lte("due_at", filters.dueBefore);
  }
  if (filters.dueAfter !== undefined) {
    q = filters.dueOnAfter
      ? q.or(`due_at.gte.${filters.dueAfter},due_on.gte.${filters.dueOnAfter}`)
      : q.gte("due_at", filters.dueAfter);
  }
  if (filters.overdue) {
    // Overdue = past due AND not yet done (a done task is never "overdue").
    q = q.lt("due_at", new Date().toISOString()).is(doneAtCol, null);
  }
  if (filters.confirmed === true) q = q.not("confirmed_at", "is", null);
  if (filters.confirmed === false) q = q.is("confirmed_at", null);
  if (filters.priorities && filters.priorities.length > 0) {
    q = q.in("priority", filters.priorities);
  }
  if (filters.tagId !== undefined) q = q.eq("task_tags.tag_id", filters.tagId);
  if (filters.contactOr !== undefined) q = q.or(filters.contactOr);
  if (filters.createdBy !== undefined) q = q.eq("created_by_user_id", filters.createdBy);
  if (filters.source === "text") q = q.not("message_id", "is", null);
  if (filters.source === "call") q = q.not("source_call_id", "is", null);
  if (filters.source === "none") q = q.is("message_id", null).is("source_call_id", null);
  if (filters.hasAttachments) q = q.eq("task_has_attachments", "true");
  if (filters.search) {
    const number = /^#?t?-?(\d{1,9})$/i.exec(filters.search)?.[1];
    q = number === undefined
      ? q.ilike("title", `%${escapeLike(filters.search)}%`)
      : q.or(`title.ilike.%${number}%,number.eq.${Number(number)}`);
  }
  if (filters.referencedHidden !== undefined && filters.referencedHidden.length > 0) {
    // A reference written on a denied number does not count for this member.
    q = q.or(
      `source_number_id.is.null,source_number_id.not.in.(${filters.referencedHidden.join(",")})`,
      { referencedTable: "record_references" },
    );
  }
  return q as never;
}

const CALENDAR_HOLD_EMBED =
  "calendar_hold:task_calendar_links!task_calendar_links_company_id_task_id_fkey(link_state)";
const CALENDAR_HOLD_STATES = ["event_removed", "refused"];

function filterCalendarHoldLinks<T>(query: T, companyId: string): T {
  const q = query as never as {
    eq(col: string, value: string): typeof q;
    in(col: string, values: string[]): typeof q;
  };
  return q
    .eq("calendar_hold.company_id", companyId)
    .in("calendar_hold.link_state", CALENDAR_HOLD_STATES) as never;
}

function excludeCalendarAttentionHolds<T>(query: T, companyId: string): T {
  const q = filterCalendarHoldLinks(query, companyId) as never as {
    is(col: string, value: null): typeof q;
  };
  return q.is("calendar_hold", null) as never;
}

/** The #690 filters as a list request or a bulk filter spells them. */
interface ExtraTaskFilterInput {
  contact_id?: string;
  created_by?: string;
  source?: TaskFilters["source"];
  has_attachments?: boolean;
  has_references?: boolean;
}

type ExtraTaskFilters = Pick<
  TaskFilters,
  "contactOr" | "createdBy" | "source" | "hasAttachments" | "referencedHidden"
>;

const TASK_SOURCES = ["text", "call", "none"] as const;
const CONTACT_CONVERSATION_CEILING = 200;
const REFERENCE_EMBED = ",record_references!target_task_id!inner(id)";

/**
 * Turn the #690 filters into what `applyTaskFilters` takes. The contact filter
 * needs its conversations first (a task promoted from a text belongs to a
 * contact through its thread), so this is async and shared by the list and the
 * bulk route.
 */
async function resolveExtraTaskFilters(
  c: Context<AppEnv>,
  db: Db,
  input: ExtraTaskFilterInput,
): Promise<ExtraTaskFilters> {
  const out: ExtraTaskFilters = {};
  const companyId = c.get("companyId");
  if (input.contact_id !== undefined) {
    const rows = unwrap<{ id: string }[]>(
      await db
        .from("conversations")
        .select("id")
        .eq("company_id", companyId)
        .eq("contact_id", input.contact_id)
        .is("deleted_at", null)
        .limit(CONTACT_CONVERSATION_CEILING),
      "task contact filter conversations",
    );
    out.contactOr =
      rows.length === 0
        ? `contact_id.eq.${input.contact_id}`
        : `contact_id.eq.${input.contact_id},conversation_id.in.(${rows.map((r) => r.id).join(",")})`;
  }
  if (input.created_by !== undefined) {
    out.createdBy = input.created_by === "me" ? c.get("userId") : input.created_by;
  }
  if (input.source !== undefined) out.source = input.source;
  if (input.has_attachments === true) out.hasAttachments = true;
  if (input.has_references === true) {
    const access = await resolveNumberAccess(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
    });
    out.referencedHidden = access.hiddenNumberIds ?? [];
  }
  return out;
}

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

/**
 * #693: the priority-sorted view orders by (priority_rank DESC, created_at DESC,
 * id DESC), so its cursor carries all three.
 */
const priorityCursorSchema = z.object({
  r: z.number().int().min(0).max(4),
  ts: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

type PriorityCursor = z.infer<typeof priorityCursorSchema>;

function encodePriorityCursor(cursor: PriorityCursor): string {
  return toBase64Url(JSON.stringify(priorityCursorSchema.parse(cursor)));
}

function parsePriorityCursor(rawCursor: string | undefined): PriorityCursor | null {
  if (rawCursor === undefined) return null;
  let candidate: unknown;
  try {
    candidate = JSON.parse(fromBase64Url(rawCursor));
  } catch {
    throw new ApiError("validation_failed", "Invalid cursor.");
  }
  const result = priorityCursorSchema.safeParse(candidate);
  if (!result.success) throw new ApiError("validation_failed", "Invalid cursor.");
  return result.data;
}

/** The strict successor of `cursor` under (rank DESC, created_at DESC, id DESC). */
function priorityKeysetFilter(cursor: PriorityCursor): string {
  return (
    `priority_rank.lt.${cursor.r},` +
    `and(priority_rank.eq.${cursor.r},created_at.lt.${cursor.ts}),` +
    `and(priority_rank.eq.${cursor.r},created_at.eq.${cursor.ts},id.lt.${cursor.id})`
  );
}

/**
 * Columns of the tasks row the API returns (T1.1). No status column: `done` is
 * derived (see TASK_DONE_AT) and added to each row by `withSource`/the callers.
 */
export const TASK_COLUMNS =
  "id,company_id,number,message_id,source_call_id,conversation_id,contact_id,title,description," +
  "assigned_user_id,due_at,due_on,due_time_set,created_by_user_id,created_at,updated_at," +
  // #214 structured job address + provenance (null when the task has no address).
  "addr_street,addr_unit,addr_city,addr_state,addr_postal_code," +
  "addr_country,addr_provenance," +
  // Task's OWN geocode (task_geocode migration): the Map view PREFERS this over
  // the contact's cached geocode, so a task pins at ITS address, not the
  // contact's. Null until the geocode cron resolves the address.
  "lat,lng," +
  // #237: whether this job texts its customer before it happens, and whether
  // they said they would be there. `confirmed_by` matters as much as
  // `confirmed_at`: a crew confirmation is a note to ourselves, a customer one
  // is a promise, and a screen that showed them the same way would let a
  // dispatcher trust the weaker of the two.
  "reminders_off,confirmed_at,confirmed_by," +
  // #693: priority, and which repeat (if any) this task is an occurrence of.
  "priority,series_id,occurrence_no";

/**
 * The task's effective done time as a PostgREST computed column
 * (`task_done_at(tasks)`): the source message's done_at, or the task's own when
 * it has no message. An inner embed of messages cannot carry this: it would
 * drop every call-anchored task, and PostgREST cannot OR a root column against
 * an embedded one, so the list selects and filters on this instead.
 */
const TASK_DONE_AT = "task_done_at";
const TASK_DONE_SELECT = `done_state:${TASK_DONE_AT}`;

/**
 * The call a task promotes, as the list and detail show it. `call` is null for
 * a message task. The recording path never leaves the server (see routes/calls).
 */
const SOURCE_CALL_COLUMNS =
  "id,call_session_id,caller_e164,caller_name,outcome,forward_seconds," +
  "started_at,ended_at,contact_id,voicemail_path";
const SOURCE_CALL_EMBED = `source_call:calls!source_call_id(${SOURCE_CALL_COLUMNS})`;

/**
 * The contact a standalone task was linked to (#689). `!contact_id` names the
 * one foreign key so the embed can never become ambiguous.
 */
const LINKED_CONTACT_EMBED =
  "linked_contact:contacts!contact_id(id,name,deleted_at)";

/**
 * #690: the contact of the task's conversation, so a task promoted from a text
 * shows who it is for. A standalone task's own contact link wins over it.
 */
const THREAD_CONTACT_EMBED =
  "thread:conversations!conversation_id(contact:contacts!contact_id(id,name,deleted_at))";

/**
 * The linked-contact embed in the `contact` shape the map rows already use. A
 * contact that was deleted is no contact: its page is gone.
 */
function linkedContact(
  contact:
    | { id: string; name: string | null; deleted_at?: string | null }
    | null
    | undefined,
): { id: string; name: string | null; lat: null; lng: null } | null {
  if (!contact || (contact.deleted_at ?? null) !== null) return null;
  return { id: contact.id, name: contact.name, lat: null, lng: null };
}

interface SourceCallRow {
  id: string;
  call_session_id: string;
  caller_e164: string | null;
  caller_name: string | null;
  outcome: string | null;
  forward_seconds: number;
  started_at: string;
  ended_at: string | null;
  contact_id: string | null;
  voicemail_path: string | null;
}

/** The call as clients see it: the storage path becomes `has_voicemail`. */
function publicSourceCall(
  call: SourceCallRow | null | undefined,
): Omit<SourceCallRow, "voicemail_path"> & { has_voicemail: boolean } | null {
  if (!call) return null;
  const { voicemail_path, ...rest } = call;
  return { ...rest, has_voicemail: voicemail_path !== null };
}

/** `source` on a task row: which kind of thing it promotes, and its id. */
export function taskSource(row: {
  message_id?: unknown;
  source_call_id?: unknown;
}): { kind: "message" | "call"; id: string } | null {
  if (typeof row.message_id === "string") {
    return { kind: "message", id: row.message_id };
  }
  if (typeof row.source_call_id === "string") {
    return { kind: "call", id: row.source_call_id };
  }
  return null;
}

/**
 * #718: a message source carries the message's direction, so a list row can
 * say "Mentioned in a note" rather than "From a text". One query per page.
 */
async function withSourceDirections<
  T extends { source: { kind: "message" | "call"; id: string } | null },
>(db: ReturnType<typeof getDb>, companyId: string, rows: T[]): Promise<T[]> {
  const ids = rows.flatMap((row) => (row.source?.kind === "message" ? [row.source.id] : []));
  if (ids.length === 0) return rows;
  const found = unwrap<{ id: string; direction: string }[]>(
    await db.from("messages").select("id,direction").eq("company_id", companyId).in("id", ids),
    "task source directions",
  );
  const direction = new Map(found.map((row) => [row.id, row.direction]));
  return rows.map((row) =>
    row.source?.kind === "message"
      ? { ...row, source: { ...row.source, direction: direction.get(row.source.id) ?? null } }
      : row,
  );
}

/** A task row (RPC or PostgREST) with its `source` attached. */
export function withSource<T extends Record<string, unknown>>(
  row: T,
): T & { source: ReturnType<typeof taskSource> } {
  return { ...row, source: taskSource(row) };
}

/**
 * Title column bound (T1.1). The default title (message-body snippet, ≤500,
 * whitespace-collapsed) is seeded inside the `create_task` RPC (T3) — the SQL
 * is the single source of that logic, so the Worker passes `null` for an absent
 * title and never computes the snippet itself.
 */
const TITLE_MAX = 500;

/**
 * #214: a structured task address in a create/update body. Every field
 * optional/nullable — a partial address is legitimate (city-only inference,
 * street-only quick entry). `provenance` records where it came from for the UI
 * badge: the client sends the enrichment's own provenance ('message'/'contact'/
 * 'company') for a confirmed suggestion, or 'manual' for a hand-typed/edited
 * address. The RPC forces provenance to null when every field is empty.
 */
const addressSchema = z.object({
  street: z.string().trim().max(200).nullable().optional(),
  unit: z.string().trim().max(60).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  state: z.string().trim().max(120).nullable().optional(),
  postal_code: z.string().trim().max(20).nullable().optional(),
  country: z.string().trim().max(80).nullable().optional(),
  provenance: z
    .enum(["message", "contact", "company", "manual"])
    .nullable()
    .optional(),
});

/** Address body → the create_task/update_task RPC address params. */
function addressParams(a: z.infer<typeof addressSchema> | null | undefined) {
  return {
    p_addr_street: a?.street ?? null,
    p_addr_unit: a?.unit ?? null,
    p_addr_city: a?.city ?? null,
    p_addr_state: a?.state ?? null,
    p_addr_postal_code: a?.postal_code ?? null,
    p_addr_country: a?.country ?? null,
    p_addr_provenance: a?.provenance ?? null,
  };
}

const createSchema = z
  .object({
  // At most one source (D64): a message, or an answered call. With neither the
  // task is standalone (#689) and needs a title.
  message_id: z.uuid().optional(),
  source_call_id: z.uuid().optional(),
  title: z.string().trim().min(1).max(TITLE_MAX).optional(),
  // A standalone task may link to a contact and/or a conversation.
  contact_id: z.uuid().optional(),
  conversation_id: z.uuid().optional(),
  description: z.string().max(5000).optional(),
  // #689 C: the whole crew (up to ten), or one person as the shorthand. The crew
  // wins when both are sent.
  assignee_ids: assigneeIdsSchema.optional(),
  assigned_user_id: z.uuid().nullable().optional(),
  due_at: z.iso.datetime({ offset: true }).nullable().optional(),
  due_on: z.iso.date().optional(),
  // #214: the confirmed enriched (or hand-entered) job address.
  address: addressSchema.nullable().optional(),
  // #693: priority (default normal), workspace tags, and a repeat.
  priority: prioritySchema.optional(),
  label_ids: z.array(z.uuid()).max(20).optional(),
  repeat: repeatSchema.optional(),
})
  .refine((body) => body.message_id === undefined || body.source_call_id === undefined, {
    message: "Provide at most one of message_id or source_call_id.",
  })
  .refine(
    (body) =>
      body.message_id !== undefined ||
      body.source_call_id !== undefined ||
      body.title !== undefined,
    { message: "title is required when the task has no source.", path: ["title"] },
  )
  .refine(
    (body) =>
      (body.message_id === undefined && body.source_call_id === undefined) ||
      (body.contact_id === undefined && body.conversation_id === undefined),
    {
      message: "contact_id and conversation_id link a task that has no source.",
      path: ["contact_id"],
    },
  );

const patchSchema = z
  .object({
    // `done` is accepted only for a task with no message (D64); for a message
    // task the PATCH rejects it below so a mis-wired client never silently
    // no-ops (completion is the message route, T4).
    done: z.boolean().optional(),
    title: z.string().trim().min(1).max(TITLE_MAX).optional(),
    description: z.string().max(5000).optional(),
    // #689 C: the crew, replaced as a whole. `assigned_user_id` is the
    // one-person shorthand: exactly that person, or nobody for null.
    assignee_ids: assigneeIdsSchema.optional(),
    assigned_user_id: z.uuid().nullable().optional(),
    due_at: z.iso.datetime({ offset: true }).nullable().optional(),
    due_on: z.iso.date().nullable().optional(),
    contact_id: z.uuid().nullable().optional(),
    conversation_id: z.uuid().nullable().optional(),
    // #214: replace the whole address block (null clears it).
    address: addressSchema.nullable().optional(),
    priority: prioritySchema.optional(),
    // #693: set, change or (null) clear the repeat. Always "this and future".
    repeat: repeatSchema.nullable().optional(),
    // #693: on an occurrence of a repeat, whether the field edits also apply to
    // the later occurrences nobody has finished. Default this one.
    scope: scopeSchema.optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.title !== undefined ||
      body.description !== undefined ||
      body.done !== undefined ||
      body.priority !== undefined ||
      "repeat" in body ||
      "assigned_user_id" in body ||
      body.assignee_ids !== undefined ||
      "contact_id" in body ||
      "conversation_id" in body ||
      "due_at" in body ||
      "due_on" in body ||
      "address" in body,
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
const taskCorrectionSchema = z.object({
  id: z.uuid(),
  body: z.string(),
  recipient: z.string().nullable(),
});

const taskOutcomeSchema = z.object({
  outcome: z.enum([
    "created",
    "updated",
    "unchanged",
    "deleted",
    "not_found",
    "no_message",
    "no_source",
    "no_call",
    "call_not_answered",
    "call_no_conversation",
    "title_required",
    "no_conversation",
    "no_contact",
    "contact_mismatch",
    "bad_link",
    "not_member",
    "too_many",
    "conflict",
    "bad_priority",
    "anchored",
    "unscheduled",
    "bad_due_precision",
  ]),
  correction: taskCorrectionSchema.nullish(),
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
  withDoneState = false,
): Promise<Record<string, unknown> | null> {
  const rows = unwrap<unknown>(
    await db
      .from("tasks")
      .select(withDoneState ? `${TASK_COLUMNS},${TASK_DONE_SELECT}` : TASK_COLUMNS)
      .eq("company_id", companyId)
      .eq("id", id)
      .is("deleted_at", null)
      .limit(1),
    "task lookup",
  ) as Record<string, unknown>[];
  return rows[0] ? withSource(rows[0]) : null;
}

export const tasksRoutes = new Hono<AppEnv>();

/**
 * POST /v1/tasks: promote a message or an answered call to a task (T4), or
 * create a standalone one (#689). This is the route the thread overflow "Make a
 * task" affordance and every "New task" control call (T5.1).
 */
tasksRoutes.post("/tasks", requireCapability("conversations.note"), async (c) => {
  const body = await parseJsonBody(c, createSchema);
  if (body.due_on && body.due_at) {
    return errorResponse(c, "validation_failed", "Provide a time or a date for this job.", {
      key: "apiRefusals.bookingDuePrecision",
    });
  }
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const db = getDb(getEnv(c.env));

  // #693: a schedule repeats from a date. Said before anything is written.
  if (body.repeat?.kind === "schedule" && !body.due_at && !body.due_on) {
    throw new ApiError("validation_failed", "repeat: a schedule needs a due date to start from.");
  }

  // #106/#107: a member with no access to the source's number can't promote it
  // to a task (that number's content is hidden from them). Creating a task is
  // internal coordination, so 'note' access is enough — a notes-only member may
  // organize work they can read. An unknown message or call falls through to
  // the RPC's own 422. Owners/admins and no-rules companies short-circuit
  // without touching messages/conversations. A call is gated by its
  // conversation, the same door its message-anchored twin would use.
  const role = c.get("role");
  const isStandalone =
    body.message_id === undefined && body.source_call_id === undefined;
  if (role !== "owner" && role !== "admin") {
    const access = await resolveNumberAccess(db, { companyId, userId, role });
    if (isStandalone) {
      // A standalone task linked to a conversation is gated like that
      // conversation. One with no conversation has no number to be denied by
      // (#689): every active member may create and see it.
      if (body.conversation_id !== undefined && access.hiddenNumberIds !== null) {
        await requireConversationAccess(db, {
          companyId,
          userId,
          role,
          conversationId: body.conversation_id,
          need: "note",
        });
      }
    } else if (access.hiddenNumberIds !== null) {
      const sourceRows =
        body.message_id === undefined
          ? unwrap<{ conversation_id: string | null }[]>(
              await db
                .from("calls")
                .select("conversation_id")
                .eq("company_id", companyId)
                .eq("id", body.source_call_id)
                .limit(1),
              "task call source lookup",
            )
          : unwrap<{ conversation_id: string | null }[]>(
              await db
                .from("messages")
                .select("conversation_id")
                .eq("company_id", companyId)
                .eq("id", body.message_id)
                .limit(1),
              "task source lookup",
            );
      if (sourceRows[0]?.conversation_id) {
        await requireConversationAccess(db, {
          companyId,
          userId,
          role,
          conversationId: sourceRows[0].conversation_id,
          need: "note",
        });
      }
    }
  }

  // A standalone task is the creator's own to-do unless they say otherwise; an
  // explicit null leaves it unassigned. A promotion keeps "nobody until
  // assigned" (the source already belongs to a thread).
  const requested = requestedAssignees(body);
  const assigneeIds = requested ?? (isStandalone ? [userId] : []);

  // T3: the mutation is the `create_task` security-definer RPC — ONE atomic
  // transaction that resolves conversation_id from the source message or call
  // (company-scoped, §10), validates the assignee, inserts the tasks row (the
  // partial-unique tasks_message_uq is the race-safe conflict arbiter), links
  // the source note back (messages.task_id, when the source is a note — so its
  // own files reach the derived attachments union, arm (b)) AND writes the
  // `task_created` audit event together. The route only maps the outcome to the
  // §7 error/HTTP surface; the DB tasks_broadcast trigger fires the ID-only
  // `task.changed` for free (T1.3), so the route publishes no realtime
  // (SPEC §8 broadcast-from-DB).
  const parameters = {
    p_company_id: companyId,
    p_message_id: body.message_id ?? null,
    p_call_id: body.source_call_id ?? null,
    // undefined title → the RPC seeds the message-body snippet; an empty string
    // can never arrive (createSchema requires min-length 1).
    p_title: body.title ?? null,
    p_description: body.description ?? null,
    p_assigned_user_id: null,
    p_assignee_ids: assigneeIds,
    p_due_at: body.due_at ?? null,
    p_actor_user_id: userId,
    // #214: the confirmed job address (all-null when the task has none).
    ...addressParams(body.address),
    // #689: the optional links of a standalone task.
    p_contact_id: body.contact_id ?? null,
    p_conversation_id: body.conversation_id ?? null,
    p_priority: body.priority ?? "normal",
  };
  const { data, error } = body.due_on === undefined
    ? await db.rpc("create_task", parameters)
    : await db.rpc("create_task_with_date", { ...parameters, p_due_on: body.due_on });
  if (error) throw new Error(`create_task failed: ${error.message}`);
  const result = parseTaskOutcome(data);

  if (result.outcome === "no_message") {
    throw new ApiError(
      "validation_failed",
      "message_id: no such message in this company.",
    );
  }
  if (result.outcome === "no_call") {
    throw new ApiError(
      "validation_failed",
      "This call is unavailable.",
      { key: "thread.callTaskSourceUnavailable" },
    );
  }
  if (result.outcome === "call_not_answered") {
    throw new ApiError(
      "validation_failed",
      "Only an answered call or a saved voicemail can become a task.",
      { key: "thread.callTaskSourceUnavailable" },
    );
  }
  if (result.outcome === "call_no_conversation") {
    throw new ApiError(
      "validation_failed",
      "source_call_id: this call has no conversation to attach a task to.",
    );
  }
  if (result.outcome === "no_source") {
    throw new ApiError(
      "validation_failed",
      "Provide at most one of message_id or source_call_id.",
    );
  }
  if (result.outcome === "title_required") {
    throw new ApiError("validation_failed", "title: required for a task with no source.");
  }
  if (result.outcome === "no_conversation") {
    throw new ApiError(
      "validation_failed",
      "conversation_id: no such conversation in this company.",
    );
  }
  if (result.outcome === "no_contact") {
    throw new ApiError(
      "validation_failed",
      "contact_id: no such contact in this company.",
    );
  }
  if (result.outcome === "contact_mismatch") {
    throw new ApiError(
      "validation_failed",
      "contact_id: not the contact of that conversation.",
    );
  }
  if (result.outcome === "bad_link") {
    throw new ApiError(
      "validation_failed",
      "contact_id and conversation_id link a task that has no source.",
    );
  }
  if (result.outcome === "not_member") {
    throw new ApiError(
      "validation_failed",
      "assignee_ids: not an active member of this company.",
    );
  }
  if (result.outcome === "too_many") {
    throw new ApiError(
      "validation_failed",
      `assignee_ids: a task holds at most ${MAX_ASSIGNEES} people.`,
    );
  }
  if (result.outcome === "conflict") {
    throw new ApiError(
      "conflict",
      body.message_id === undefined
        ? "This call is already a task."
        : "This message is already a task.",
    );
  }
  if (!result.task) throw new Error("create_task returned no row");
  let created: Record<string, unknown> = result.task;

  // #690: a description that points at a task, a contact or a conversation.
  if (mayHoldReference(body.description)) {
    await syncReferences(c, db, {
      sourceKind: "task_description",
      sourceId: created.id as string,
      text: body.description ?? null,
    });
  }

  // #693: the labels and the repeat the form carried. After the task exists, so
  // each is the same RPC a later edit uses.
  if (body.label_ids && body.label_ids.length > 0) {
    await setTaskTags(db, {
      companyId,
      taskId: created.id as string,
      userId,
      add: body.label_ids,
    });
  }
  if (body.repeat) {
    created = await setTaskRepeat(db, {
      companyId,
      taskId: created.id as string,
      userId,
      repeat: body.repeat,
    });
  }

  await afterTaskCreated(c, { companyId, userId, task: result.task, assigneeIds });

  return c.json(await withLabelsAndRepeatOne(db, companyId, withSource(created)), 201);
});

/** The `api_set_task_tags` RPC, with its outcomes as API errors. Returns the labels. */
export async function setTaskTags(
  db: Db,
  input: {
    companyId: string;
    taskId: string;
    userId: string;
    add?: string[];
    remove?: string[];
  },
): Promise<unknown[]> {
  const { data, error } = await db.rpc("api_set_task_tags", {
    p_company_id: input.companyId,
    p_task_id: input.taskId,
    p_actor_user_id: input.userId,
    p_add: input.add ?? null,
    p_remove: input.remove ?? null,
  });
  if (error) throw new Error(`api_set_task_tags failed: ${error.message}`);
  const result = data as { outcome: string; labels?: unknown[] };
  if (result.outcome === "not_found") throw new ApiError("not_found", "No such task.");
  if (result.outcome === "tag_not_found") {
    throw new ApiError("validation_failed", "label: no such tag in this company.");
  }
  return result.labels ?? [];
}

/**
 * The `api_set_task_repeat` RPC, with its outcomes as API errors. `null` clears
 * the repeat. Returns the task row.
 */
export async function setTaskRepeat(
  db: Db,
  input: {
    companyId: string;
    taskId: string;
    userId: string;
    repeat: z.infer<typeof repeatSchema> | null;
  },
): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc("api_set_task_repeat", {
    p_company_id: input.companyId,
    p_task_id: input.taskId,
    p_actor_user_id: input.userId,
    p_repeat: input.repeat,
  });
  if (error) throw new Error(`api_set_task_repeat failed: ${error.message}`);
  const result = data as { outcome: string; reason?: string; task?: Record<string, unknown> };
  if (result.outcome === "not_found") throw new ApiError("not_found", "No such task.");
  if (result.outcome === "needs_due") {
    throw new ApiError("validation_failed", "repeat: a schedule needs a due date to start from.");
  }
  if (result.outcome === "invalid") {
    throw new ApiError("validation_failed", `repeat: ${result.reason ?? "not a valid rule"}.`);
  }
  if (!result.task) throw new Error("api_set_task_repeat returned no row");
  return result.task;
}

/**
 * Fire a #689 D subscriber alert without letting it touch the response.
 *
 * The same contract as `notifyAssignedTask`: `waitUntil` where the runtime
 * offers one, awaited otherwise so a test never sees it land in a later one.
 */
function alertTaskSubscribers(c: Context<AppEnv>, change: TaskChange): Promise<void> {
  const work = notifyTaskChangeSafely(getEnv(c.env), change);
  const ctx = executionCtxOf(c);
  if (ctx) {
    ctx.waitUntil(work);
    return Promise.resolve();
  }
  return work;
}

/** The task as it was before a write, for the alerts that need the old value. Null when unreadable. */
async function readTaskBefore(
  db: Db,
  companyId: string,
  id: string,
): Promise<{ assigned_user_id: string | null; due_at: string | null } | null> {
  try {
    const row = await findTask(db, companyId, id);
    if (!row) return null;
    return {
      assigned_user_id: (row.assigned_user_id as string | null) ?? null,
      due_at: (row.due_at as string | null) ?? null,
    };
  } catch (error) {
    void reportHandledFailure(workerEnv(), "task-pre-read", error);
    return null;
  }
}

const sameInstant = (a: unknown, b: unknown): boolean => {
  if (a == null || b == null) return a == null && b == null;
  return new Date(a as string).getTime() === new Date(b as string).getTime();
};

// --------------------------------------------------------------------------
// #214 — task enrichment (Cloudflare Workers AI). A pure SUGGESTION endpoint:
// it never writes a task and never blocks task creation. The client posts the
// task text, pre-fills the create form with what comes back, and the user
// reviews + saves. Everything degrades to the empty result — toggles off, no AI
// binding, rate-limited, over the monthly cap, AI timeout/error, or malformed
// output. The model output is DATA (parsed + schema-validated), never an
// instruction; no tool use, no side effect. See src/tasks/enrichment.ts.
// --------------------------------------------------------------------------
const enrichSchema = z.union([
  z.strictObject({ source_call_id: z.uuid() }),
  z.object({
    text: z.string().trim().min(1).max(20_000),
    message_id: z.uuid().optional(),
    conversation_id: z.uuid().optional(),
  }),
]);

const EMPTY_ENRICHMENT = {
  address: null,
  address_provenance: null,
  due_at: null,
} as const;

/**
 * Company + linked-contact context for the prompt, tenant-scoped. The contact
 * address (resolved via conversation → contact) is the address fallback source.
 * Best-effort: a missing company/contact just narrows the prompt.
 */
async function loadEnrichmentContext(
  db: Db,
  companyId: string,
  opts: { conversationId?: string; messageId?: string },
): Promise<{
  timezone: string;
  contactAddress: string | null;
}> {
  const companyRows = unwrap<{ timezone: string | null }[]>(
    await db
      .from("companies")
      .select("timezone")
      .eq("id", companyId)
      .limit(1),
    "enrichment company lookup",
  );
  const [company] = companyRows;

  let conversationId = opts.conversationId ?? null;
  if (!conversationId && opts.messageId) {
    const msgRows = unwrap<{ conversation_id: string }[]>(
      await db
        .from("messages")
        .select("conversation_id")
        .eq("company_id", companyId)
        .eq("id", opts.messageId)
        .limit(1),
      "enrichment message lookup",
    );
    conversationId = msgRows[0]?.conversation_id ?? null;
  }

  let contactAddress: string | null = null;
  if (conversationId) {
    const convRows = unwrap<{ contact_id: string }[]>(
      await db
        .from("conversations")
        .select("contact_id")
        .eq("company_id", companyId)
        .eq("id", conversationId)
        .limit(1),
      "enrichment conversation lookup",
    );
    const contactId = convRows[0]?.contact_id ?? null;
    if (contactId) {
      const contactRows = unwrap<{ address: string | null }[]>(
        await db
          .from("contacts")
          .select("address")
          .eq("company_id", companyId)
          .eq("id", contactId)
          .limit(1),
        "enrichment contact lookup",
      );
      contactAddress = contactRows[0]?.address ?? null;
    }
  }

  return {
    timezone: company?.timezone ?? companySettingDefault("timezone"),
    contactAddress,
  };
}

tasksRoutes.post("/tasks/enrich", requireCapability("conversations.note"), async (c) => {
  const body = await parseJsonBody(c, enrichSchema);
  const companyId = c.get("companyId");
  const env = getEnv(c.env);
  const db = getDb(env);

  const fromVoicemail = "source_call_id" in body;
  const settings = await loadAiSettings(db, companyId);
  const enableDue = !fromVoicemail && settings.enrich_task_due;
  if (!settings.enrich_task_address && !enableDue) {
    return c.json({ ...EMPTY_ENRICHMENT, enrichment_disabled: true });
  }

  let source: { text: string; conversationId?: string; messageId?: string };
  if (fromVoicemail) {
    const [call] = unwrap<{
      conversation_id: string;
      phone_number_id: string | null;
      voicemail_intake: { address?: string | null } | null;
      voicemail_transcript: string | null;
    }[]>(await db.from("calls")
      .select("conversation_id,phone_number_id,voicemail_intake,voicemail_transcript")
      .eq("company_id", companyId)
      .eq("id", body.source_call_id)
      .eq("outcome", "voicemail")
      .is("deleted_at", null)
      .is("purged_at", null)
      .is("voicemail_deleted_at", null)
      .not("voicemail_path", "is", null)
      .not("conversation_id", "is", null)
      .limit(1), "voicemail task source");
    if (!call) return c.json(EMPTY_ENRICHMENT);
    await assertNumberLevel(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      phoneNumberId: call.phone_number_id,
      need: "note",
    });
    source = {
      conversationId: call.conversation_id,
      text: [call.voicemail_intake?.address, call.voicemail_transcript].filter(Boolean).join("\n"),
    };
  } else {
    source = {
      text: body.text,
      conversationId: body.conversation_id,
      messageId: body.message_id,
    };
  }
  const text = source.text.slice(0, ENRICHMENT_MAX_INPUT_CHARS);
  const ctx = await loadEnrichmentContext(db, companyId, source);
  const contactAddress = ctx.contactAddress?.trim() || null;

  // "Only when needed" (cost): call the model ONLY when the text plausibly holds
  // the enrichment we're permitted to make. A no-signal task ("call back", "send
  // the quote") never spends an AI call or a cap unit.
  const signals = detectEnrichmentSignals(text);
  const wantAddress = settings.enrich_task_address && signals.address;
  const wantDue = enableDue && signals.due;

  // The contact's address on file — offered as a FREE (no-model) fallback for a
  // task whose text names no address of its own.
  const resultOptions = {
    enableAddress: settings.enrich_task_address,
    enableDue: wantDue,
    timezone: ctx.timezone,
    contactAddress,
  };
  const contactFallback = () => c.json(buildEnrichmentResult({}, resultOptions));

  // Nothing worth a model call — the single biggest cost saver.
  if (!wantAddress && !wantDue) return contactFallback();
  // No binding (local dev/tests): degrade to the free fallback, never the model.
  if (!env.AI) return contactFallback();

  // Per-company burst limiter (absent in dev/tests → skipped).
  if (env.AI_ENRICH_RATE_LIMITER) {
    const { success } = await env.AI_ENRICH_RATE_LIMITER.limit({
      key: companyId,
    });
    if (!success) return contactFallback();
  }
  // And per MEMBER, so one member cannot spend the whole crew's month alone.
  if (env.AI_MEMBER_RATE_LIMITER) {
    const { success } = await env.AI_MEMBER_RATE_LIMITER.limit({
      key: `${companyId}:${c.get("userId")}`,
    });
    if (!success) return contactFallback();
  }

  const messages = buildEnrichmentMessages({
    text,
    now: new Date(),
    timezone: ctx.timezone,
    contactAddress: ctx.contactAddress,
  });

  // One door onto the model (ai/run.ts): it owns the opt-in, the monthly cap
  // and the timeout.
  const enriched = await runAiFeature(env, db, {
    companyId,
    spec: ENRICHMENT_FEATURE_SPEC,
    model: ENRICHMENT_MODEL,
    input: { messages, max_tokens: ENRICHMENT_MAX_OUTPUT_TOKENS },
    settings,
  });
  if (!enriched.ok) return contactFallback();

  const output = parseEnrichmentOutput(enriched.raw);
  if (!output) {
    const diagnostics = captureUnusableModelOutput(env, companyId, ENRICHMENT_FEATURE_SPEC.key, enriched.raw, {
      candidates: 0,
    });
    executionCtxOf(c)?.waitUntil(diagnostics);
    return contactFallback();
  }

  return c.json(buildEnrichmentResult(output, resultOptions));
});

const taskMemberFilter = z.union([z.literal("me"), z.uuid()]);
const taskDueFilter = z.iso.datetime({ offset: true });

const taskSelectionSchema = z.strictObject({
  status: z.enum(STATUS_VALUES).optional(),
  assigned_user_id: taskMemberFilter.optional(),
  unassigned: z.boolean().optional(),
  conversation_id: z.uuid().optional(),
  due_before: taskDueFilter.optional(),
  due_after: taskDueFilter.optional(),
  due_on_before: z.iso.date().optional(),
  due_on_after: z.iso.date().optional(),
  overdue: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  has_location: z.boolean().optional(),
  q: z.string().trim().max(200).optional(),
  priority: z.array(prioritySchema).min(1).optional(),
  tag_id: z.uuid().optional(),
  contact_id: z.uuid().optional(),
  created_by: taskMemberFilter.optional(),
  source: z.enum(TASK_SOURCES).optional(),
  has_attachments: z.boolean().optional(),
  has_references: z.boolean().optional(),
}).refine(
  (filters) => !filters.has_location || (!filters.has_attachments && !filters.has_references),
  { message: "The map cannot be narrowed by files or references." },
);

function parseTaskListQuery(c: Context<AppEnv>, userId: string) {
  const query = c.req.query();
  const inputs = {
    status: query.status,
    assigned_user_id: query.assigned_user_id,
    unassigned: query.unassigned === "true" || undefined,
    conversation_id: query.conversation_id,
    due_before: query.due_before,
    due_after: query.due_after,
    due_on_before: query.due_on_before,
    due_on_after: query.due_on_after,
    overdue: query.overdue === "true" || undefined,
    confirmed: query.confirmed === "true" ? true : (query.confirmed === "false" ? false : query.confirmed),
    has_location: query.has_location === "true" || undefined,
    q: query.q,
    priority: query.priority
      ? [...new Set(query.priority.split(",").map((value) => value.trim()))]
      : undefined,
    tag_id: query.tag_id,
    contact_id: query.contact_id,
    created_by: query.created_by,
    source: query.source,
    has_attachments: query.has_attachments === "true" || undefined,
    has_references: query.has_references === "true" || undefined,
  } satisfies Record<keyof z.input<typeof taskSelectionSchema>, unknown>;
  const parsed = taskSelectionSchema.safeParse(inputs);
  if (!parsed.success) {
    throw new ApiError("validation_failed", parsed.error.issues[0]?.message ?? "Check the task filters.");
  }
  const filters = parsed.data;
  if (query.sort !== undefined && !["created", "due", "priority", "updated"].includes(query.sort)) {
    throw new ApiError("validation_failed", "sort must be created, due, priority or updated.");
  }

  const anyFilter = Object.values(filters).some((value) => value !== undefined);
  const assignee = filters.assigned_user_id === "me"
    ? userId
    : filters.assigned_user_id ?? (anyFilter ? undefined : userId);
  return {
    overdue: filters.overdue === true,
    hasLocation: filters.has_location === true,
    dueBefore: filters.due_before,
    dueAfter: filters.due_after,
    conversationId: filters.conversation_id,
    unassigned: filters.unassigned === true,
    search: filters.q,
    priorities: filters.priority,
    tagId: filters.tag_id,
    sort: query.sort,
    extraInput: filters,
    effectiveStatus: filters.status ?? (anyFilter ? undefined : "open"),
    assignee,
  };
}

/**
 * GET /v1/tasks — flat filtered list (T6.1). The derived status filter runs on
 * the joined messages.done_at via an inner-embedded messages resource.
 */
tasksRoutes.get("/tasks", requireCapability("conversations.read"), async (c) => {
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const limit = parseLimit(c, 25, 100);
  const rawCursor = c.req.query("cursor");
  const db = getDb(getEnv(c.env));

  const {
    overdue,
    hasLocation,
    dueBefore,
    dueAfter,
    conversationId,
    unassigned,
    search,
    priorities,
    tagId,
    sort,
    extraInput,
    effectiveStatus,
    assignee,
  } = parseTaskListQuery(c, userId);
  // Due-sorted views (overdue / due filters / explicit due sort) key on
  // (due_at NULLS LAST, id); otherwise newest-first (created_at, id) DESC. Each
  // ordering has its OWN cursor shape, so decode the token against the shape
  // this request will use (a token minted for the other view → 422).
  const prioritySorted = sort === "priority";
  const updatedSorted = sort === "updated";
  const dueSorted =
    !prioritySorted &&
    !updatedSorted &&
    (sort === "due" ||
      (sort === undefined &&
        (overdue || dueBefore !== undefined || dueAfter !== undefined)));
  const dueCursor = dueSorted ? parseDueCursor(rawCursor) : null;
  const priorityCursor = prioritySorted ? parsePriorityCursor(rawCursor) : null;
  const createdCursor =
    dueSorted || prioritySorted || rawCursor === undefined
      ? null
      : decodeCursor(rawCursor);
  // The inner embed that makes `task_tags.tag_id` a row filter.
  const tagEmbed = tagId === undefined ? "" : ",task_tags!inner(tag_id)";
  // #689 C: the same for an assignee filter, which matches any assignee.
  const assigneeEmbed =
    assignee === undefined ? "" : ",task_assignees!inner(user_id)";
  const extra = await resolveExtraTaskFilters(c, db, extraInput);
  const referenceEmbed = extra.referencedHidden === undefined ? "" : REFERENCE_EMBED;

  // The common (non-map) path reads `tasks` and selects the computed column
  // `task_done_at` (the source message's done_at, or the task's own when it has
  // no message, D64) so status filters and the response's derived `done` read
  // whichever row owns done. It cannot be an inner embed of messages: that
  // would drop every call-anchored task. The call a task promotes rides along
  // as a left embed.
  //
  // The has_location (Map) path instead reads the FLAT `task_map_rows` view
  // (#221): it pre-joins the source message (done_at), conversation
  // (phone_number_id, for the #106 access filter) and contact (name + geocode),
  // and exposes `map_lat = coalesce(task.lat, contact.lat)`. That coalesce is
  // the fix — a task with its OWN geocode but a non-geocoded contact now
  // appears. PostgREST cannot OR a root column against an embedded one, so the
  // predicate has to live on a flat view column. `done_at` is therefore a plain
  // column on this path, so status/overdue filters reference it directly.
  const doneAtCol = hasLocation ? "done_at" : TASK_DONE_AT;
  let query = hasLocation
    ? db
        .from("task_map_rows")
        .select(
          `${TASK_COLUMNS},done_at,contact_id,contact_name,contact_lat,contact_lng,${CALENDAR_HOLD_EMBED}${tagEmbed}${assigneeEmbed}`,
        )
        .eq("company_id", companyId)
        .is("deleted_at", null)
        // The map location = the task's own geocode OR the contact's (#221).
        .not("map_lat", "is", null)
    : db
        .from("tasks")
        .select(
          `${TASK_COLUMNS},${TASK_DONE_SELECT},${SOURCE_CALL_EMBED},${LINKED_CONTACT_EMBED},${THREAD_CONTACT_EMBED},${CALENDAR_HOLD_EMBED}${tagEmbed}${assigneeEmbed}${referenceEmbed}`,
        )
        .eq("company_id", companyId)
        .is("deleted_at", null);

  query = filterCalendarHoldLinks(query, companyId);
  query = applyTaskFilters(query, {
    companyId,
    doneAtCol,
    effectiveStatus,
    assignee,
    unassigned,
    conversationId,
    dueBefore,
    dueAfter,
    overdue,
    confirmed: extraInput.confirmed,
    dueOnBefore: extraInput.due_on_before,
    dueOnAfter: extraInput.due_on_after,
    search,
    priorities,
    tagId,
    ...extra,
  });
  if (hasLocation) {
    // #106/#107: the map exposes the source contact's NAME + geocode — that's
    // conversation content, not the globally-visible task title. Exclude tasks
    // whose number is hidden from the caller so the map can never plot a hidden
    // customer. phone_number_id is a flat view column, so this filter drops the
    // row directly (no embed post-filter → the keyset window stays correct).
    // Owners/admins and no-rules companies resolve unrestricted and skip it.
    const access = await resolveNumberAccess(db, {
      companyId,
      userId,
      role: c.get("role"),
    });
    if (access.hiddenNumberIds && access.hiddenNumberIds.length > 0) {
      // A standalone task with no conversation has no number (#689), and
      // `not in` alone would drop it as NULL; it is not hidden by a number.
      query = query.or(
        `phone_number_id.is.null,phone_number_id.not.in.(${access.hiddenNumberIds.join(",")})`,
      );
    }
  }
  if (dueSorted) {
    query = query
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
    // Seek to the strict successor of the last row under (due_at NULLS LAST,
    // id) — NOT a bare `id > cursor.id`, which drops/misorders rows whose id is
    // unrelated to the due_at primary key (T6.1).
    if (dueCursor) query = query.or(dueKeysetFilter(dueCursor));
  } else if (updatedSorted) {
    query = query
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false });
    if (createdCursor) query = query.or(keysetFilter("updated_at", createdCursor));
  } else if (prioritySorted) {
    query = query
      .order("priority_rank", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (priorityCursor) query = query.or(priorityKeysetFilter(priorityCursor));
  } else {
    query = query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (createdCursor) query = query.or(keysetFilter("created_at", createdCursor));
  }

  interface TaskListRow {
    id: string;
    created_at: string;
    updated_at: string;
    priority: string;
    due_at: string | null;
    calendar_hold?: { link_state: string }[];
    // Non-map path: `done` derives from the task_done_at computed column.
    done_state?: string | null;
    source_call?: SourceCallRow | null;
    linked_contact?: { id: string; name: string | null } | null;
    thread?: { contact: { id: string; name: string | null; deleted_at?: string | null } | null } | null;
    // has_location (task_map_rows view) path: flat columns — `done` derives from
    // done_at and the source contact's geocode rides on contact_* .
    done_at?: string | null;
    contact_id?: string | null;
    contact_name?: string | null;
    contact_lat?: number | null;
    contact_lng?: number | null;
    [key: string]: unknown;
  }
  const rows = unwrap<unknown>(
    await query.limit(limit + 1),
    "tasks list",
  ) as TaskListRow[];

  const hasNext = rows.length > limit;
  const pageRows = hasNext ? rows.slice(0, limit) : rows;
  const shaped = pageRows.map((row) => {
    const rest = {
      ...row,
      calendar_hold: (row.calendar_hold?.length ?? 0) > 0,
    } as Record<string, unknown>;
    // Empty embeds are filtering artifacts, never part of the task contract.
    delete rest.task_tags;
    delete rest.task_assignees;
    delete rest.record_references;
    if (hasLocation) {
      // Map view (task_map_rows view): `done` + the source contact's geocode
      // arrive as FLAT columns. Derive done, fold the geocode into `contact`
      // (the TaskContactLocation shape the client's taskCoords reads — without
      // it no pin could render), and strip the view-only columns from the row.
      const done = (row.done_at ?? null) !== null;
      const contact =
        row.contact_id == null
          ? null
          : {
              id: row.contact_id,
              name: row.contact_name ?? null,
              lat: row.contact_lat ?? null,
              lng: row.contact_lng ?? null,
            };
      delete rest.done_at;
      delete rest.contact_id;
      delete rest.contact_name;
      delete rest.contact_lat;
      delete rest.contact_lng;
      return withSource({
        ...rest,
        done,
        status: done ? "done" : "open",
        allowed_actions: taskAllowedActions(done, c.get("role")),
        contact,
      });
    }
    // Non-map path: `done_state`/`source_call` are read artifacts folded into
    // `done`/`call`, and there is no `contact`.
    delete rest.done_state;
    delete rest.source_call;
    delete rest.linked_contact;
    delete rest.thread;
    const done = (row.done_state ?? null) !== null;
    return withSource({
      ...rest,
      done,
      status: done ? "done" : "open",
      allowed_actions: taskAllowedActions(done, c.get("role")),
      call: publicSourceCall(row.source_call),
      contact: linkedContact(row.linked_contact) ?? linkedContact(row.thread?.contact),
    });
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
      : (prioritySorted
        ? encodePriorityCursor({
            r: PRIORITY_RANK[last.priority as TaskPriority],
            ts: last.created_at,
            id: last.id,
          })
        : encodeCursor({ ts: updatedSorted ? last.updated_at : last.created_at, id: last.id }));
  }
  const [directed, decorated] = await Promise.all([
    withSourceDirections(db, companyId, shaped),
    withLabelsAndRepeat(db, companyId, shaped),
  ]);
  // Both keep the page's order, so row i of one is row i of the other.
  const data = decorated.map((row, index) => ({ ...row, source: directed[index].source }));

  return c.json({ data, next_cursor: nextCursor });
});

/**
 * GET /v1/tasks/export.csv (#745) — the tasks in the current view, as a download.
 *
 * Takes the list's own query string and answers with the CSV at once. There is
 * no queue, no `data_exports` row and nothing in Settings: the regulatory
 * workspace export is a separate, scheduled thing for the whole workspace, and
 * a person who wants today's open jobs should not be handed a job to wait on.
 *
 * GATED ON `contacts.bulk`, as the queued export was: every task names a
 * customer. #106 number access is applied while reading, and what was withheld
 * or capped is stated in headers, because a file silently missing a job is one
 * somebody puts in front of a customer believing it is whole.
 *
 * Registered BEFORE `/tasks/:id` so "export.csv" is never read as an id.
 */
tasksRoutes.get("/tasks/export.csv", requireCapability("contacts.bulk"), async (c) => {
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const db = getDb(getEnv(c.env));
  const q = parseTaskListQuery(c, userId);
  const extra = await resolveExtraTaskFilters(c, db, q.extraInput);
  const embeds = [
    q.tagId === undefined ? "" : ",task_tags!inner(tag_id)",
    q.assignee === undefined ? "" : ",task_assignees!inner(user_id)",
    extra.referencedHidden === undefined ? "" : REFERENCE_EMBED,
    `,${CALENDAR_HOLD_EMBED}`,
  ].join("");

  const { entries, withheld, capped } = await readTaskEntries(db, {
    companyId,
    requestedBy: userId,
    filters: {},
    embeds,
    refine: (query) =>
      applyTaskFilters(excludeCalendarAttentionHolds(query, companyId), {
        companyId,
        doneAtCol: TASK_DONE_AT,
        effectiveStatus: q.effectiveStatus,
        assignee: q.assignee,
        unassigned: q.unassigned,
        conversationId: q.conversationId,
        dueBefore: q.dueBefore,
        dueAfter: q.dueAfter,
        overdue: q.overdue,
        confirmed: q.extraInput.confirmed,
        dueOnBefore: q.extraInput.due_on_before,
        dueOnAfter: q.extraInput.due_on_after,
        search: q.search,
        priorities: q.priorities,
        tagId: q.tagId,
        ...extra,
      }),
  });

  await recordAuditFromRequest(db, c, {
    companyId,
    action: "contacts.exported",
    targetType: "task",
    after: { scope: "tasks", count: entries.length, withheld, capped },
  });
  alarmOnBulkContactAccess(c, getEnv(c.env), db, {
    companyId,
    actorUserId: userId,
    event: "history_exported",
    count: entries.length,
  });

  const response = csvResponse(taskCsvRows(entries), "tasks.csv");
  response.headers.set("X-Export-Withheld", String(withheld));
  response.headers.set("X-Export-Capped", capped ? "true" : "false");
  response.headers.set("Cache-Control", "no-store");
  return response;
});

/**
 * GET /v1/conversations/:id/tasks — the conversation checklist (T5.2). All
 * live tasks for the thread, (created_at) order, no cursor (a thread's task
 * count is small). Each row carries the derived `done` + attachment_count.
 */
/**
 * GET /v1/tasks/geocode-progress (#440) returns cached contact geocoding counts.
 * Addresses stay pending while lookups are paused.
 */
/**
 * POST /v1/tasks/bulk (#478) — one action, every task matching either a list of
 * ids or the CURRENT FILTER.
 *
 * # Why this resolves ids here rather than passing filters to SQL
 *
 * `api_bulk_conversations` takes the list filters and re-expresses them in SQL.
 * That works because the conversation list IS a SQL function. The task list is
 * not: its filters are built in TypeScript against a view, so re-expressing them
 * would create a second definition of "what the list shows" that has to agree
 * with the first forever. It would not — the two would drift the first time
 * somebody added a filter to one, silently, in the direction where a bulk action
 * touches rows the user never saw.
 *
 * So the filter runs through `applyTaskFilters`, the same function the list
 * uses, and the resolved ids go to the RPC. "Select all matching the filter" is
 * then true by construction.
 *
 * # What the RPC owns, and why
 *
 * The access intersection, the cap, the per-row results and the prior values
 * for undo — all identical across four actions, and a route that reimplemented
 * any of them per action is how the fifth gets one wrong. Most of all: bulk
 * completion writes N done flips (`messages.done_at` or, for a call task,
 * `tasks.done_at`) and N audit events in ONE transaction (D14/D22/D64). A bulk done that half-records is worse than none.
 *
 * THERE IS NO BULK SEND, and the zod enum below is the second of two gates (the
 * SQL enum is the first) — the rule #275 established, which any new bulk
 * surface inherits.
 *
 * Member-level, like the conversations twin: ticking off your own task list in
 * bulk is ordinary daily work. The per-number deny list limits reach, not a role.
 */
interface TaskBulkResult {
  action?: string;
  matched?: number;
  applied?: { id: string; previous: Record<string, unknown> }[];
  failed?: { id: string; reason: string }[];
  capped?: boolean;
  error?: string;
  completed_tasks?: TaskCompletion[];
}

const taskBulkSchema = z
  .object({
    action: z.enum([
      "mark_done",
      "mark_undone",
      "assign",
      "delete",
      "set_priority",
      "add_label",
      "remove_label",
    ]),
    /** Explicit selection. Omit to act on everything matching `filter`. */
    ids: z.array(z.uuid()).min(1).max(1000).optional(),
    /** Select-all-matching. Same field names as GET /v1/tasks. */
    filter: taskSelectionSchema.optional(),
    target_user_id: z.uuid().nullable().optional(),
    /**
     * #689 C: `assign` ADDS these people to every selected task and removes
     * nobody. No target and no list clears every assignee.
     */
    assignee_ids: assigneeIdsSchema.optional(),
    /** `set_priority`'s value. */
    priority: prioritySchema.optional(),
    /** `add_label` / `remove_label`'s tag. */
    tag_id: z.uuid().optional(),
  })
  .refine((body) => body.action !== "set_priority" || body.priority !== undefined, {
    message: "priority: needed to set a priority.",
  })
  .refine(
    (body) =>
      (body.action !== "add_label" && body.action !== "remove_label") ||
      body.tag_id !== undefined,
    { message: "tag_id: needed to add or remove a label." },
  )
  .refine((body) => body.ids !== undefined || body.filter !== undefined, {
    // Neither means "every task in the company", which no UI should be able to
    // ask for by omitting a field.
    message: "Provide ids or filter.",
  })
  .refine(
    (body) =>
      body.action !== "assign" ||
      body.target_user_id !== undefined ||
      (body.assignee_ids !== undefined && body.assignee_ids.length > 0) ||
      body.ids !== undefined,
    {
      // An assign with no target means UNASSIGN, which is legitimate — but
      // unassigning everything matching a filter is not something a UI should
      // be able to fire by omitting a field. Say it with explicit ids.
      message: "assign with no target requires explicit ids.",
    },
  );

tasksRoutes.post(
  "/tasks/bulk",
  requireCapability("conversations.note"),
  async (c) => {
    const body = await parseJsonBody(c, taskBulkSchema);
    // #691: the other actions are ordinary daily work; delete needs the capability.
    if (body.action === "delete" && !roleHasCapability(c.get("role"), "records.delete")) {
      return errorResponse(c, "forbidden", "Insufficient role for this action.");
    }
    const db = getDb(getEnv(c.env));
    const companyId = c.get("companyId");
    const userId = c.get("userId");
    const accessScope = { companyId, userId, role: c.get("role") };
    let access: Awaited<ReturnType<typeof resolveNumberAccess>> | undefined;
    let { ids } = body;
    if (ids === undefined) {
      // Filter mode. The SAME builder the list uses, so what gets acted on is
      // what was on screen.
      const filter = body.filter ?? {};
      const extra = await resolveExtraTaskFilters(c, db, filter);
      const assignee = filter.assigned_user_id === "me" ? userId : filter.assigned_user_id;
      let taskQuery = db
        .from(filter.has_location ? "task_map_rows" : "tasks")
        .select(
          `id${filter.tag_id ? ",task_tags!inner(tag_id)" : ""}${
            assignee ? ",task_assignees!inner(user_id)" : ""
          }${extra.referencedHidden === undefined ? "" : REFERENCE_EMBED}`,
        )
        .eq("company_id", companyId)
        .is("deleted_at", null);
      if (filter.has_location) {
        access = await resolveNumberAccess(db, accessScope);
        taskQuery = taskQuery.not("map_lat", "is", null);
        if (access.hiddenNumberIds?.length) {
          taskQuery = taskQuery.or(
            `phone_number_id.is.null,phone_number_id.not.in.(${access.hiddenNumberIds.join(",")})`,
          );
        }
      }
      const query = applyTaskFilters(
        taskQuery,
        {
          companyId,
          doneAtCol: filter.has_location ? "done_at" : TASK_DONE_AT,
          effectiveStatus: filter.status,
          assignee,
          unassigned: filter.unassigned === true,
          conversationId: filter.conversation_id,
          dueBefore: filter.due_before,
          dueAfter: filter.due_after,
          overdue: filter.overdue === true,
          confirmed: filter.confirmed,
          dueOnBefore: filter.due_on_before,
          dueOnAfter: filter.due_on_after,
          search: filter.q,
          priorities: filter.priority,
          tagId: filter.tag_id,
          ...extra,
        },
      );
      // The RPC applies at most 500 tasks and reports whether more matched.
      const rows = unwrap<unknown>(
        await query.limit(1000),
        "tasks bulk filter",
      ) as { id: string }[];
      ids = rows.map((row) => row.id);
      if (ids.length === 0) {
        // Nothing matched. Answered here rather than by the RPC, which requires
        // a non-empty id list — an empty selection is a legitimate outcome, not
        // a malformed request.
        return c.json({
          action: body.action,
          matched: 0,
          applied: [],
          failed: [],
          capped: false,
        });
      }
    }

    access ??= await resolveNumberAccess(db, accessScope);
    const result = unwrap<TaskBulkResult>(
      await db.rpc("api_bulk_tasks", {
        p_company_id: companyId,
        p_user_id: userId,
        p_action: body.action,
        p_ids: ids,
        p_target_user_id: body.target_user_id ?? null,
        p_hidden_number_ids: access.hiddenNumberIds ?? null,
        p_priority: body.priority ?? null,
        p_tag_id: body.tag_id ?? null,
        p_target_user_ids: body.assignee_ids ?? null,
      }),
      "api_bulk_tasks",
    );

    if (result.error === "validation_failed") {
      throw new ApiError("validation_failed", "That bulk request is not valid.");
    }
    if (result.error === "not_member") {
      throw new ApiError(
        "validation_failed",
        "That person is not an active member of this workspace.",
      );
    }
    if (result.error === "tag_not_found") {
      throw new ApiError("validation_failed", "tag_id: no such tag in this company.");
    }
    const { completed_tasks: completed, ...response } = result;
    if (completed?.length) {
      await afterTasksCompleted(c, { companyId, userId, tasks: completed });
    }
    return c.json(response);
  },
);

tasksRoutes.get("/tasks/geocode-progress", requireCapability("conversations.read"), async (c) => {
  const db = getDb(getEnv(c.env));
  const progress = unwrap<Record<string, number>>(
    await db.rpc("api_geocode_progress", {
      p_company_id: c.get("companyId"),
    }),
    "geocode progress",
  );
  return c.json(progress);
});

tasksRoutes.get(
  "/conversations/:id/tasks",
  requireCapability("conversations.read"),
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
    // #106: the checklist is a per-conversation view — a member with no access
    // to this number gets the same 404 as a missing thread (its tasks would
    // expose the hidden conversation's work).
    await requireConversationAccess(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      conversationId,
      need: "read",
    });

    interface ChecklistRow {
      id: string;
      message_id: string | null;
      done_state: string | null;
      source_call: SourceCallRow | null;
      [key: string]: unknown;
    }
    const rows = unwrap<unknown>(
      await db
        .from("tasks")
        .select(`${TASK_COLUMNS},${TASK_DONE_SELECT},${SOURCE_CALL_EMBED}`)
        .eq("company_id", companyId)
        .eq("conversation_id", conversationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      "conversation tasks",
    ) as ChecklistRow[];

    // attachment_count: the size of the D28 derived union (source-message MMS
    // + linked-note files + legacy task rows) — the SAME loader the detail's
    // `attachments` array uses, so the badge and the drawer always agree.
    const attachmentUnions = await loadTaskAttachments(
      db,
      companyId,
      rows.map((row) => ({ id: row.id, message_id: row.message_id })),
    );

    const data = await withLabelsAndRepeat(
      db,
      companyId,
      rows.map((row) => {
        const { done_state, source_call, ...rest } = row;
        const done = (done_state ?? null) !== null;
        return withSource({
          ...rest,
          done,
          status: done ? "done" : "open",
          call: publicSourceCall(source_call),
          attachment_count: attachmentUnions.get(row.id)?.length ?? 0,
        });
      }),
    );
    return c.json({ data });
  },
);

// --------------------------------------------------------------------------
// Task attachments — the D28 DERIVED union. One loader feeds BOTH the detail's
// `attachments` array and the checklist's `attachment_count`, so the two can
// never disagree.
// --------------------------------------------------------------------------

/**
 * One item of a task's derived attachments union — the gallery item shape
 * (D21/T7.3) WITHOUT a pre-signed url; the web uses GET /v1/attachments/:id/url
 * per item (that route serves generic AND MMS ids).
 */
interface TaskAttachmentItem {
  id: string;
  source: "mms" | "note" | "task";
  kind: "image" | "file";
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
  /**
   * #294 — the three fields that turn a flat list into a job record.
   *
   * The note a file arrived on is its group, that note's phase is the group's
   * label, and that note's author is who took the photos. All three come from the
   * note rather than from the file, which is what keeps D28's two doors intact:
   * none of this is a property somebody uploaded.
   *
   * All null for the customer's own texted media, and honestly so — it did not
   * arrive in visits, is not a before, and was not added by anyone on the crew.
   */
  note_id: string | null;
  work_phase: "before" | "after" | null;
  added_by_user_id: string | null;
}

/** `kind` mirrors the gallery's Images | Files split (T7.3). */
function attachmentKind(contentType: string | null): "image" | "file" {
  return contentType?.toLowerCase().startsWith("image/") ? "image" : "file";
}

/**
 * Load the D28 union for a batch of tasks, three arms, all company-scoped:
 *   (a) `mms`  — the source message's message_attachments;
 *   (b) `note` — LIVE generic attachments of notes linked to the task
 *                (messages.task_id = task, direction='note'). When a NOTE was
 *                promoted, create_task links the source note back, so its own
 *                files are picked up by this same arm — no special-casing here.
 *   (c) `task` — LIVE legacy owner_type='task' rows (pre-D28; the upload door
 *                is closed but existing rows keep reading — no data migration).
 * Items are sorted (created_at, id) ASC per task (oldest-first, like the
 * checklist and the old attachments list). Every input task gets an entry
 * (possibly empty), so `.get(id)` is always safe for counts.
 */
async function loadTaskAttachments(
  db: Db,
  companyId: string,
  tasks: { id: string; message_id: string | null }[],
): Promise<Map<string, TaskAttachmentItem[]>> {
  const byTask = new Map<string, TaskAttachmentItem[]>();
  if (tasks.length === 0) return byTask;
  for (const task of tasks) byTask.set(task.id, []);
  const taskIds = tasks.map((task) => task.id);

  // Arm (a) — MMS media of the source messages, one batched lookup.
  // A call-anchored task has no source message, so no MMS arm (D64).
  const taskByMessage = new Map(
    tasks.flatMap((task): [string, string][] =>
      task.message_id === null ? [] : [[task.message_id, task.id]],
    ),
  );
  // Arms (b) + (c) share the generic table; each is a separate live-rows read
  // because their owner scoping differs (note ids vs task ids).
  const genericSelect = "id,owner_id,file_name,content_type,size_bytes,created_at";
  interface GenericRow {
    id: string;
    owner_id: string;
    file_name: string | null;
    content_type: string | null;
    size_bytes: number | null;
    created_at: string;
  }
  interface NoteRow {
    id: string;
    task_id: string;
    work_phase: "before" | "after" | null;
    sent_by_user_id: string | null;
  }
  interface MmsRow {
    id: string;
    message_id: string;
    content_type: string | null;
    size_bytes: number | null;
    created_at: string;
  }

  // Arm (b) is two steps: the linked notes, then their files.
  const [mmsRows, { noteRows, noteFiles }, legacyRows] = await Promise.all([
    taskByMessage.size === 0
      ? ([] as MmsRow[])
      : db
          .from("message_attachments")
          .select("id,message_id,content_type,size_bytes,created_at")
          .eq("company_id", companyId)
          .in("message_id", [...taskByMessage.keys()])
          .then((res) => unwrap<MmsRow[]>(res, "task mms attachments")),
    (async () => {
      const notes = unwrap<NoteRow[]>(
        await db
          .from("messages")
          .select("id,task_id,work_phase,sent_by_user_id")
          .eq("company_id", companyId)
          .eq("direction", "note")
          .in("task_id", taskIds),
        "task note links",
      );
      if (notes.length === 0) return { noteRows: notes, noteFiles: [] as GenericRow[] };
      const files = unwrap<GenericRow[]>(
        await db
          .from("attachments")
          .select(genericSelect)
          .eq("company_id", companyId)
          .eq("owner_type", "note")
          .in("owner_id", notes.map((note) => note.id))
          .is("deleted_at", null),
        "task note attachments",
      );
      return { noteRows: notes, noteFiles: files };
    })(),
    db
      .from("attachments")
      .select(genericSelect)
      .eq("company_id", companyId)
      .eq("owner_type", "task")
      .in("owner_id", taskIds)
      .is("deleted_at", null)
      .then((res) => unwrap<GenericRow[]>(res, "task legacy attachments")),
  ]);

  for (const row of mmsRows) {
    const taskId = taskByMessage.get(row.message_id);
    if (taskId === undefined) continue;
    byTask.get(taskId)?.push({
      id: row.id,
      source: "mms",
      kind: attachmentKind(row.content_type),
      file_name: null, // carrier media has no filename (D29: correct, not a gap)
      content_type: row.content_type,
      size_bytes: row.size_bytes,
      created_at: row.created_at,
      // #294: the customer's own photo. Not a visit, not a before, not ours.
      note_id: null,
      work_phase: null,
      added_by_user_id: null,
    });
  }

  // Arm (b) — notes linked to the tasks, then their live generic attachments.
  const taskByNote = new Map(noteRows.map((note) => [note.id, note.task_id]));
  // #294: the note's own label and author, carried down to each of its files.
  const noteById = new Map(noteRows.map((note) => [note.id, note]));

  const pushGeneric = (
    row: GenericRow,
    source: "note" | "task",
    taskId: string | undefined,
  ): void => {
    if (taskId === undefined) return;
    // #294: a note's files inherit its group, label and author. A legacy
    // task-owned row (arm c) has no note and gets none of them — it predates the
    // model rather than being unlabelled within it.
    const note = source === "note" ? noteById.get(row.owner_id) : undefined;
    byTask.get(taskId)?.push({
      id: row.id,
      source,
      kind: attachmentKind(row.content_type),
      file_name: row.file_name,
      content_type: row.content_type,
      size_bytes: row.size_bytes,
      created_at: row.created_at,
      note_id: note?.id ?? null,
      work_phase: note?.work_phase ?? null,
      added_by_user_id: note?.sent_by_user_id ?? null,
    });
  };

  for (const row of noteFiles) pushGeneric(row, "note", taskByNote.get(row.owner_id));
  for (const row of legacyRows) pushGeneric(row, "task", row.owner_id);

  for (const items of byTask.values()) {
    items.sort((a, b) => {
      if (a.created_at !== b.created_at) {
        return a.created_at < b.created_at ? -1 : 1;
      }
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
  }
  return byTask;
}

/**
 * GET /v1/tasks/:id — task detail (T6.2). Full row + resolved profiles + the
 * joined source message (live body + done_at for the derived status) + the
 * D28 derived attachments union.
 */
tasksRoutes.get("/tasks/:id", requireCapability("conversations.read"), async (c) => {
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const db = getDb(getEnv(c.env));

  interface DetailRow {
    id: string;
    message_id: string | null;
    // Null only for a standalone task with no conversation (#689).
    conversation_id: string | null;
    assigned_user_id: string | null;
    created_by_user_id: string;
    done_state: string | null;
    done_by: string | null;
    reminders?: { state: string; next_send_at?: string };
    source_call: SourceCallRow | null;
    linked_contact: { id: string; name: string | null } | null;
    calendar_hold?: { link_state: string }[];
    // Null for a call-anchored task (D64).
    messages: { id: string; body: string; done_at: string | null } | null;
    [key: string]: unknown;
  }
  const query = db
    .from("tasks")
    .select(
      `${TASK_COLUMNS},${TASK_DONE_SELECT},done_by:task_done_by,reminders:task_reminder_state,${SOURCE_CALL_EMBED},${LINKED_CONTACT_EMBED},` +
        `${CALENDAR_HOLD_EMBED},messages!message_id(id,body,done_at,done_by_user_id,created_at,direction)`,
    )
    .eq("company_id", companyId)
    .eq("id", id)
    .is("deleted_at", null);
  const rows = unwrap<unknown>(
    await filterCalendarHoldLinks(query, companyId).limit(1),
    "task detail",
  ) as DetailRow[];
  const [row] = rows;
  if (!row) {
    return errorResponse(c, "not_found", "No such task.");
  }

  // Resolve assignee + creator display names from profiles (best-effort — a
  // profile may lag; null is fine for rendering).
  const userIds = [row.assigned_user_id, row.created_by_user_id].filter(
    (v): v is string => v !== null,
  );
  const profilesRead = loadProfiles(db, userIds, "profiles lookup");

  const { messages, done_state, done_by, source_call, linked_contact, reminders, calendar_hold, ...task } = row;
  // Conversation-derived reads run beside the access check and are dropped at 'none'.
  const [profiles, subscriptionRes, labelled, viewerLevel, attachmentUnions, activity] =
    await Promise.all([
      profilesRead,
      // #689 D: whether THIS member follows the task. A remembered unfollow is a
      // row with unsubscribed_at set, which reads as not following.
      db
        .from("task_subscribers")
        .select("unsubscribed_at")
        .eq("company_id", companyId)
        .eq("task_id", id)
        .eq("user_id", c.get("userId"))
        .limit(1),
      withLabelsAndRepeatOne(db, companyId, withSource(task)),
      // #107: tasks are GLOBAL (assignable to anyone, visible on /tasks +
      // /for-you), but the source conversation obeys #106. A member with no
      // access to the task's number still sees the task's identity, but every
      // field derived from the hidden conversation (the source message, its
      // attachments, the note discussion) is withheld. `viewer_level` lets the
      // web hide the text/reply affordance at 'note' and show a no-access notice
      // at 'none'. A task with no conversation (#689) has no number to be denied by.
      row.conversation_id
        ? resolveConversationLevel(db, {
            companyId,
            userId: c.get("userId"),
            role: c.get("role"),
            conversationId: row.conversation_id,
          })
        : ("text" as const),
      // D28: the derived attachments union (source-message MMS + linked-note
      // files + legacy task-owned rows), gallery-shaped, no pre-signed urls: the
      // web calls GET /v1/attachments/:id/url per item.
      loadTaskAttachments(db, companyId, [{ id, message_id: row.message_id }]),
      // TASKS-V2 D-C + D-D: the merged activity-and-discussion timeline, from
      // existing data with no new table. Sorted (created_at, id) ASC so the
      // drawer reads oldest-first, like the thread.
      loadTaskActivity(db, companyId, row, profilesRead),
    ]);
  const subscription = unwrap<{ unsubscribed_at: string | null }[]>(
    subscriptionRes,
    "task subscription lookup",
  );

  const done = (done_state ?? null) !== null;
  const identity = {
    ...labelled,
    calendar_hold: (calendar_hold?.length ?? 0) > 0,
    subscribed: subscription[0] ? subscription[0].unsubscribed_at === null : false,
    contact: linkedContact(linked_contact),
    done,
    done_at: done_state ?? null,
    done_by_user_id: done ? done_by ?? null : null,
    status: done ? "done" : "open",
    // #722: what this member may do to it now, from the shared machine.
    allowed_actions: taskAllowedActions(done, c.get("role"), viewerLevel),
    assignee: row.assigned_user_id
      ? profiles.get(row.assigned_user_id) ?? null
      : null,
    created_by: profiles.get(row.created_by_user_id) ?? null,
  };

  if (viewerLevel === "none") {
    return c.json({
      ...identity,
      viewer_level: viewerLevel,
      source_message: null,
      source_call: null,
      attachments: [],
      activity: [],
    });
  }

  return c.json({
    ...identity,
    viewer_level: viewerLevel,
    reminders,
    source_message: messages,
    source_call: publicSourceCall(source_call),
    attachments: attachmentUnions.get(id) ?? [],
    activity,
  });
});

/** Display names by user id, in one read; none to look up costs nothing. */
async function loadProfiles(
  db: Db,
  userIds: string[],
  label: string,
): Promise<Map<string, Record<string, unknown>>> {
  const profiles = new Map<string, Record<string, unknown>>();
  if (userIds.length === 0) return profiles;
  const found = unwrap<{ user_id: string; display_name: string | null }[]>(
    await db
      .from("profiles")
      .select("user_id,display_name")
      .in("user_id", [...new Set(userIds)]),
    label,
  );
  for (const p of found) profiles.set(p.user_id, p);
  return profiles;
}

// --------------------------------------------------------------------------
// Task activity feed (TASKS-V2 D-C + D-D) — reuse existing rows, no new table.
// --------------------------------------------------------------------------

/** One merged activity item: a task_* audit event OR a task-linked note. */
type TaskActivityItem =
  | {
      kind: "event";
      id: string;
      type: string;
      payload: Record<string, unknown>;
      actor_user_id: string | null;
      actor: { user_id: string; display_name: string | null } | null;
      created_at: string;
    }
  | {
      kind: "note";
      id: string;
      body: string;
      author_user_id: string | null;
      author: { user_id: string; display_name: string | null } | null;
      created_at: string;
    };

/**
 * Assemble the task's merged activity+discussion timeline (D-C/D-D). Two
 * company-scoped arms, read together: the `task_*` conversation_events for this
 * task id (the audit payload carries `task_id`) and the internal notes linked to
 * the task (`messages.task_id = taskId`). `assigneeProfiles` is the
 * assignee/creator name read; note/event actor names not in it are resolved in
 * one extra batch. Result is sorted (created_at, id) ASC (oldest-first).
 */
async function loadTaskActivity(
  db: Db,
  companyId: string,
  task: { id: string; conversation_id: string | null },
  assigneeProfiles: Promise<Map<string, Record<string, unknown>>>,
): Promise<TaskActivityItem[]> {
  const taskId = task.id;
  interface EventRow {
    id: string;
    type: string;
    payload: Record<string, unknown> | null;
    actor_user_id: string | null;
    created_at: string;
  }
  const [eventRows, noteRows] = await Promise.all([
    // Arm 1: task_* audit events for this task (payload->>'task_id' = taskId).
    // Written only on the task's own conversation, whose id puts the read on its index.
    task.conversation_id === null
      ? ([] as EventRow[])
      : db
          .from("conversation_events")
          .select("id,type,payload,actor_user_id,created_at")
          .eq("company_id", companyId)
          .eq("conversation_id", task.conversation_id)
          .in("type", [
            "task_created",
            "task_assigned",
            "task_due_set",
            "task_deleted",
            // task_attachment_added is NOT filtered: D28 closed the task upload
            // ingress, so no such event is ever written post-D28, and including
            // it would only match dead pre-D28 rows. task_attachment_removed stays:
            // the DELETE route now stamps task_id on it (legacy task-file
            // deletions), so it surfaces here via the payload->>task_id filter.
            "task_attachment_removed",
          ])
          .eq("payload->>task_id", taskId)
          .order("created_at", { ascending: true })
          .then((res) => unwrap<EventRow[]>(res, "task activity events")),
    // Arm 2: internal notes linked to this task (messages.task_id = taskId).
    db
      .from("messages")
      .select("id,body,sent_by_user_id,created_at")
      .eq("company_id", companyId)
      .eq("task_id", taskId)
      .eq("direction", "note")
      .order("created_at", { ascending: true })
      .then((res) =>
        unwrap<
          { id: string; body: string; sent_by_user_id: string | null; created_at: string }[]
        >(res, "task activity notes"),
      ),
  ]);

  // Resolve any actor/author names not already in the profiles cache (one batch).
  const assignees = await assigneeProfiles;
  const needed = new Set<string>();
  for (const e of eventRows) {
    if (e.actor_user_id && !assignees.has(e.actor_user_id)) {
      needed.add(e.actor_user_id);
    }
  }
  for (const n of noteRows) {
    if (n.sent_by_user_id && !assignees.has(n.sent_by_user_id)) {
      needed.add(n.sent_by_user_id);
    }
  }
  const others = await loadProfiles(db, [...needed], "task activity profiles");
  const profiles = new Map([...assignees, ...others]);
  const nameOf = (
    userId: string | null,
  ): { user_id: string; display_name: string | null } | null => {
    if (!userId) return null;
    const p = profiles.get(userId);
    return p
      ? { user_id: userId, display_name: (p.display_name as string) ?? null }
      : null;
  };

  const items: TaskActivityItem[] = [
    ...eventRows.map(
      (e): TaskActivityItem => ({
        kind: "event",
        id: e.id,
        type: e.type,
        payload: e.payload ?? {},
        actor_user_id: e.actor_user_id,
        actor: nameOf(e.actor_user_id),
        created_at: e.created_at,
      }),
    ),
    ...noteRows.map(
      (n): TaskActivityItem => ({
        kind: "note",
        id: n.id,
        body: n.body,
        author_user_id: n.sent_by_user_id,
        author: nameOf(n.sent_by_user_id),
        created_at: n.created_at,
      }),
    ),
  ];
  items.sort((a, b) => {
    const at = Date.parse(a.created_at);
    const bt = Date.parse(b.created_at);
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : 1;
  });
  return items;
}

/**
 * PATCH /v1/tasks/:id: metadata (T4) and, for a task with no message, `done`
 * (D64). An assignee change writes `task_assigned`; a due_at change writes
 * `task_due_set`. A message task's completion stays on the message route.
 */
tasksRoutes.patch("/tasks/:id", requireCapability("conversations.note"), async (c) => {
  const id = pathUuid(c, "id");
  const body = await parseJsonBody(c, patchSchema);
  if ("due_on" in body && "due_at" in body) {
    return errorResponse(c, "validation_failed", "Provide a time or a date for this job.", {
      key: "apiRefusals.bookingDuePrecision",
    });
  }
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const db = getDb(getEnv(c.env));

  // D17 as amended by D64: exactly one row owns done. A task that has a message
  // is completed through the message (D14/D22); only a task without one owns a
  // done_at of its own. Refused BEFORE anything is written so a mixed body does
  // not half-apply.
  if (body.done !== undefined) {
    const existing = await findTask(db, companyId, id, true);
    if (!existing) return errorResponse(c, "not_found", "No such task.");
    if (existing.message_id !== null) {
      throw new ApiError(
        "validation_failed",
        "done: this task came from a text, so mark its message done instead.",
      );
    }
    // #722: the move must be one the machine offers this member. Asking for the
    // state it is already in is a no-op the RPC answers as `unchanged`.
    const action = doneToggleAction((existing.done_state ?? null) !== null, body.done);
    if (action !== null && !taskAllowedActions(!body.done, c.get("role")).includes(action)) {
      throw new ApiError(
        "conflict",
        body.done ? "This task cannot be completed now." : "This task cannot be reopened now.",
      );
    }
  }

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
    body.priority !== undefined ||
    "due_at" in body ||
    "address" in body;
  const touchesCustomer = "contact_id" in body || "conversation_id" in body;
  let correction: z.infer<typeof taskCorrectionSchema> | null | undefined;
  const desiredCrew = requestedAssignees(body);
  const touchesAssignee = desiredCrew !== undefined;

  // Reject an unassignable member BEFORE anything is written.
  //
  // Each RPC is atomic on its own, but a PATCH carrying both metadata and an
  // assignee ran them as two transactions: the rename committed, then the
  // assignment was refused, and the caller received a 422 for a request that
  // had already changed the task. A client that treats the rejection as "none
  // of this applied" (ours restores its previous cache on error) then shows a
  // title the whole crew can already see, and retrying the identical body fails
  // the same way forever while the drift stands.
  //
  // The RPC's own not_member check stays as the authoritative one; this only
  // moves the ordinary case in front of the first write.
  if ((touchesMeta || touchesCustomer || "due_on" in body) && desiredCrew !== undefined && desiredCrew.length > 0) {
    const members = unwrap<{ user_id: string }[]>(
      await db
        .from("company_members")
        .select("user_id")
        .eq("company_id", companyId)
        .in("user_id", desiredCrew)
        .is("deactivated_at", null),
      "assignee membership lookup",
    );
    if (members.length < desiredCrew.length) {
      throw new ApiError(
        "validation_failed",
        "assignee_ids: not an active member of this company.",
      );
    }
  }

  // Track the freshest task row an RPC returned, and whether the task exists.
  let latest: Record<string, unknown> | null = null;
  let found = false;

  if (touchesCustomer) {
    if (body.conversation_id) {
      await requireConversationAccess(db, {
        companyId, userId, role: c.get("role"), conversationId: body.conversation_id, need: "note",
      });
    }
    const result = parseTaskOutcome(unwrap(await db.rpc("set_task_links", {
      p_company_id: companyId,
      p_task_id: id,
      p_actor_user_id: userId,
      p_contact_id: body.contact_id ?? null,
      p_conversation_id: body.conversation_id ?? null,
    }), "link job customer"));
    if (result.outcome === "not_found") {
      return errorResponse(c, "not_found", "No such task.", { key: "apiRefusals.bookingNotFound" });
    }
    if (result.outcome === "anchored") {
      return errorResponse(c, "validation_failed", "A task created from a text or call keeps its customer.", {
        key: "apiRefusals.bookingSourceCustomer",
      });
    }
    if (result.outcome !== "updated" && result.outcome !== "unchanged") {
      return errorResponse(c, "validation_failed", "Choose an available customer or conversation.", {
        key: "apiRefusals.bookingCustomerUnavailable",
      });
    }
    found = true;
    latest = result.task ?? null;
  }

  if ("due_on" in body) {
    const result = parseTaskOutcome(unwrap(await db.rpc("set_task_due_on", {
      p_company_id: companyId,
      p_task_id: id,
      p_actor_user_id: userId,
      p_due_on: body.due_on ?? null,
    }), "set job date"));
    if (result.outcome === "not_found") {
      return errorResponse(c, "not_found", "No such task.", { key: "apiRefusals.bookingNotFound" });
    }
    found = true;
    latest = result.task ?? latest;
    ({ correction } = result);
  }

  // #689 D: "time changed" needs the value that is about to be overwritten,
  // which the RPC does not return.
  const before = "due_at" in body ? await readTaskBefore(db, companyId, id) : null;

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
      // #214: only overwrite the address block when the client sent `address`
      // (null clears it); absent → the RPC leaves the address untouched.
      p_set_address: "address" in body,
      ...addressParams(body.address),
      p_priority: body.priority ?? null,
    });
    if (error) throw new Error(`update_task failed: ${error.message}`);
    const result = parseTaskOutcome(data);
    if (result.outcome === "not_found") {
      return errorResponse(c, "not_found", "No such task.");
    }
    found = true;
    if (result.task) latest = result.task;
    if ("due_at" in body) ({ correction } = result);
    if (
      result.outcome === "updated" &&
      before &&
      !sameInstant(before.due_at, result.task?.due_at)
    ) {
      await alertTaskSubscribers(c, {
        companyId,
        taskId: id,
        actorUserId: userId,
        kind: "due_changed",
      });
    }
    // #690: a rewritten description may add or drop a reference.
    if (body.description !== undefined) {
      await syncReferences(c, db, {
        sourceKind: "task_description",
        sourceId: id,
        text: body.description,
      });
    }
  }

  if (touchesAssignee) {
    const { data, error } = await db.rpc("set_task_assignees", {
      p_company_id: companyId,
      p_task_id: id,
      p_assignee_ids: desiredCrew,
      p_actor_user_id: userId,
    });
    if (error) throw new Error(`set_task_assignees failed: ${error.message}`);
    const result = parseTaskOutcome(data);
    if (result.outcome === "not_found") {
      return errorResponse(c, "not_found", "No such task.");
    }
    if (result.outcome === "not_member") {
      throw new ApiError(
        "validation_failed",
        "assignee_ids: not an active member of this company.",
      );
    }
    if (result.outcome === "too_many") {
      throw new ApiError(
        "validation_failed",
        `assignee_ids: a task holds at most ${MAX_ASSIGNEES} people.`,
      );
    }
    found = true;
    if (result.task) latest = result.task;
    // #515: only the people the RPC says it ADDED are told. `unchanged` is the
    // crew already being this, and re-pushing that would make a duplicate save
    // wake somebody for nothing.
    const crewChange = data as { added?: string[]; removed?: string[] } | null;
    for (const assigneeUserId of crewChange?.added ?? []) {
      await notifyAssignedTask(c, {
        companyId,
        actorUserId: userId,
        assigneeUserId,
        task: result.task ?? latest,
        taskId: id,
      });
    }
    // #689 D: each person taken off is told they no longer are on it.
    for (const previousAssigneeId of crewChange?.removed ?? []) {
      await alertTaskSubscribers(c, {
        companyId,
        taskId: id,
        actorUserId: userId,
        kind: "unassigned",
        previousAssigneeId,
      });
    }
  }

  if (body.done !== undefined) {
    const { data, error } = await db.rpc("set_task_done", {
      p_company_id: companyId,
      p_task_id: id,
      p_done: body.done,
      p_actor_user_id: userId,
    });
    if (error) throw new Error(`set_task_done failed: ${error.message}`);
    const result = parseTaskOutcome(data);
    if (result.outcome === "not_found") {
      return errorResponse(c, "not_found", "No such task.");
    }
    found = true;
    if (result.task) latest = result.task;
    if (result.outcome === "updated") {
      await alertTaskSubscribers(c, {
        companyId,
        taskId: id,
        actorUserId: userId,
        kind: body.done ? "completed" : "reopened",
      });
    }
    // Only a real transition finishes a job: `unchanged` is a second tap on the
    // same tick and must not queue a second rating question.
    if (result.outcome === "updated" && body.done) {
      const source = taskSource(latest ?? {});
      await afterTasksCompleted(c, {
        companyId,
        userId,
        tasks: [{
          id,
          title: (latest?.title as string | null) ?? null,
          source,
          askForRating: source?.kind === "call",
        }],
      });
    }
  }

  // #693: the repeat control. Always "this and future": it is the rule, not a
  // field of one occurrence.
  if ("repeat" in body) {
    latest = await setTaskRepeat(db, {
      companyId,
      taskId: id,
      userId,
      repeat: body.repeat ?? null,
    });
    found = true;
  }

  // #693: "this and future" carries this edit to the later occurrences and to
  // what new ones copy. The edit to THIS occurrence was made above.
  if (body.scope === "future") {
    const changes: Record<string, unknown> = {};
    if (body.title !== undefined) changes.title = body.title;
    if (body.description !== undefined) changes.description = body.description;
    if (body.priority !== undefined) changes.priority = body.priority;
    if (desiredCrew !== undefined) changes.assignee_ids = desiredCrew;
    if ("address" in body) {
      changes.address = body.address
        ? {
            street: body.address.street ?? null,
            unit: body.address.unit ?? null,
            city: body.address.city ?? null,
            state: body.address.state ?? null,
            postal_code: body.address.postal_code ?? null,
            country: body.address.country ?? null,
            provenance: body.address.provenance ?? null,
          }
        : null;
    }
    if (body.due_at) changes.due_at = body.due_at;
    if (body.due_on) changes.due_on = body.due_on;
    if (Object.keys(changes).length > 0) {
      await editTaskSeries(db, { companyId, taskId: id, userId, changes });
    }
  }

  // Every RPC that ran returned the row (created/updated/unchanged/not_found);
  // `latest` is the freshest. If an assignee no-op preceded nothing else, or a
  // combined no-op, fall back to the current row so the response is always the
  // task's present state.
  if (found) await syncRemindersAfterWrite(c, { companyId, taskId: id, userId });

  if (latest) {
    return c.json(await withLabelsAndRepeatOne(db, companyId, withSource({
      ...latest,
      ...(correction ? { correction } : {}),
    })));
  }
  if (found) {
    const current = await findTask(db, companyId, id);
    if (!current) return errorResponse(c, "not_found", "No such task.");
    return c.json(await withLabelsAndRepeatOne(db, companyId, current));
  }
  // Neither branch ran (impossible under patchSchema's refine, but typed-safe).
  return errorResponse(c, "not_found", "No such task.");
});

/** The `api_edit_task_series` RPC: carry an edit to the later occurrences. */
async function editTaskSeries(
  db: Db,
  input: {
    companyId: string;
    taskId: string;
    userId: string;
    changes: Record<string, unknown>;
  },
): Promise<void> {
  const { data, error } = await db.rpc("api_edit_task_series", {
    p_company_id: input.companyId,
    p_task_id: input.taskId,
    p_actor_user_id: input.userId,
    p_changes: input.changes,
  });
  if (error) throw new Error(`api_edit_task_series failed: ${error.message}`);
  const outcome = (data as { outcome?: string } | null)?.outcome;
  if (outcome === "not_member") {
    throw new ApiError(
      "validation_failed",
      "assignee_ids: not an active member of this company.",
    );
  }
  if (outcome === "too_many") {
    throw new ApiError(
      "validation_failed",
      `assignee_ids: a task holds at most ${MAX_ASSIGNEES} people.`,
    );
  }
  if (outcome === "bad_priority" || outcome === "invalid") {
    throw new ApiError("validation_failed", "That edit is not valid.");
  }
}

const taskTagBodySchema = z
  .object({
    tag_id: z.uuid().optional(),
    name: z.string().trim().min(1).max(50).optional(),
    scope: scopeSchema.optional(),
  })
  .refine((body) => (body.tag_id === undefined) !== (body.name === undefined), {
    message: "Provide exactly one of tag_id or name.",
  });

/**
 * POST /v1/tasks/:id/tags { tag_id } | { name }, optional scope: label a task.
 *
 * The workspace's one tag vocabulary: a name reuses the workspace's tag of that
 * spelling, and creating a new one needs `settings.manage` when the workspace
 * has locked its tag list. `scope: "future"` also labels the later occurrences
 * of a repeat and what new ones copy.
 */
tasksRoutes.post("/tasks/:id/tags", requireCapability("conversations.note"), async (c) => {
  const id = pathUuid(c, "id");
  const body = await parseJsonBody(c, taskTagBodySchema);
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const db = getDb(getEnv(c.env));

  if (!(await findTask(db, companyId, id))) {
    return errorResponse(c, "not_found", "No such task.");
  }

  let tagRows: { id: string; name: string; color: string | null }[];
  if (body.tag_id === undefined) {
    const rows = unwrap<
      { id: string; name: string; color: string | null; refused: boolean; reason: string | null }[]
    >(
      await db.rpc("api_find_or_create_tag", {
        p_company_id: companyId,
        p_name: body.name!,
        p_may_create: roleHasCapability(c.get("role"), "settings.manage"),
      }),
      "tag find-or-create",
    );
    const tagRow = rows.at(0);
    if (tagRow?.refused === true) {
      if (tagRow.reason === "at_ceiling") {
        return errorResponse(
          c,
          "conflict",
          "This workspace has hit its tag limit. Merge the duplicates in Settings, under Templates & tags.",
        );
      }
      return errorResponse(
        c,
        "forbidden",
        "Your workspace keeps a set list of tags. Pick an existing one, or ask an owner or admin to add this.",
      );
    }
    if (!rows[0]) throw new Error("tag find-or-create: no row returned");
    tagRows = rows;
  } else {
    tagRows = unwrap<{ id: string; name: string; color: string | null }[]>(
      await db
        .from("tags")
        .select("id,name,color")
        .eq("company_id", companyId)
        .eq("id", body.tag_id)
        .limit(1),
      "tag lookup",
    );
    if (!tagRows[0]) return errorResponse(c, "not_found", "No such tag.");
  }
  const [tag] = tagRows;
  const labels = await setTaskTags(db, { companyId, taskId: id, userId, add: [tag.id] });
  if (body.scope === "future") {
    await editTaskSeries(db, {
      companyId,
      taskId: id,
      userId,
      changes: { labels_add: [tag.id] },
    });
  }
  return c.json({ tag, labels }, 201);
});

/** DELETE /v1/tasks/:id/tags/:tag_id?scope=this|future: take a label off a task. */
tasksRoutes.delete(
  "/tasks/:id/tags/:tag_id",
  requireCapability("conversations.note"),
  async (c) => {
    const id = pathUuid(c, "id");
    const tagId = pathUuid(c, "tag_id");
    const companyId = c.get("companyId");
    const userId = c.get("userId");
    const db = getDb(getEnv(c.env));
    const scope = scopeSchema.safeParse(c.req.query("scope") ?? "this");
    if (!scope.success) {
      throw new ApiError("validation_failed", "scope must be this or future.");
    }

    if (!(await findTask(db, companyId, id))) {
      return errorResponse(c, "not_found", "No such task.");
    }
    const had = unwrap<unknown[]>(
      await db
        .from("task_tags")
        .select("tag_id")
        .eq("company_id", companyId)
        .eq("task_id", id)
        .eq("tag_id", tagId),
      "task tag lookup",
    );
    if (had.length === 0) return errorResponse(c, "not_found", "Tag is not attached.");

    await setTaskTags(db, { companyId, taskId: id, userId, remove: [tagId] });
    if (scope.data === "future") {
      await editTaskSeries(db, {
        companyId,
        taskId: id,
        userId,
        changes: { labels_remove: [tagId] },
      });
    }
    return c.body(null, 204);
  },
);

tasksRoutes.put("/tasks/:id/confirmation", requireCapability("conversations.note"), async (c) => {
  const db = getDb(getEnv(c.env));
  const { confirmed } = await parseJsonBody(c, z.strictObject({ confirmed: z.boolean() }));
  const result = parseTaskOutcome(unwrap(await db.rpc("api_set_task_confirmation", {
    p_company_id: c.get("companyId"),
    p_task_id: pathUuid(c, "id"),
    p_actor_user_id: c.get("userId"),
    p_confirmed: confirmed,
  }), "confirm job"));
  if (result.outcome === "not_found") {
    return errorResponse(c, "not_found", "No such task.", { key: "apiRefusals.bookingNotFound" });
  }
  if (result.outcome === "unscheduled") {
    return errorResponse(c, "validation_failed", "Set a date for this open job before confirming it.", {
      key: "apiRefusals.bookingConfirmationNeedsDate",
    });
  }
  return c.json({ confirmed_at: result.task?.confirmed_at ?? null, confirmed_by: result.task?.confirmed_by ?? null });
});

/**
 * PUT /v1/tasks/:id/reminders — stop (or restart) this job's reminders.
 *
 * ITS OWN ROUTE, not a field on the metadata PATCH. That patch runs through the
 * atomic `update_task` RPC, and widening a stored procedure to carry a boolean
 * would put a migration between this switch and the person who wants it. It is
 * also a different KIND of decision: title, assignee and due date describe the
 * job, and this one decides whether we text somebody about it.
 *
 * The sync is AWAITED here, unlike everywhere else, because here it is the
 * whole point. Somebody switching reminders off for a job wants the queued text
 * gone, and a response that returned before the queue was cleared would show
 * them a reminder they had just cancelled.
 */
tasksRoutes.put(
  "/tasks/:id/reminders",
  requireCapability("conversations.note"),
  async (c) => {
    const id = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const userId = c.get("userId");
    const env = getEnv(c.env);
    const db = getDb(env);

    const { off } = await parseJsonBody(c, z.object({ off: z.boolean() }));

    // An RPC rather than a column write so the task history can say who
    // flipped it (#689 E).
    const { data, error } = await db.rpc("set_task_reminders_off", {
      p_company_id: companyId,
      p_task_id: id,
      p_off: off,
      p_actor_user_id: userId,
    });
    if (error) throw new Error(`set_task_reminders_off failed: ${error.message}`);
    const result = parseTaskOutcome(data);
    if (result.outcome === "no_conversation") {
      return errorResponse(c, "validation_failed", "Link a customer conversation to turn on reminders.", {
        key: "apiRefusals.remindersNeedCustomer",
      });
    }
    if (result.outcome === "not_found" || !result.task) {
      return errorResponse(c, "not_found", "No such task.");
    }

    await syncTaskReminders(db, { companyId, taskId: id, userId }).catch(
      (notificationError: unknown) => {
        void reportHandledFailure(env, "task-reminder-sync", notificationError);
      },
    );

    return c.json(withSource(result.task));
  },
);

/**
 * DELETE /v1/tasks/:id — soft-delete (T4, M*). Creator OR owner/admin only.
 * Sets deleted_at, writes `task_deleted`. Does NOT touch messages.done_at
 * (removing the promotion leaves D14 archetype A intact). Best-effort object
 * cleanup of the task's generic attachments is a D19 sweep owned by the
 * storage track's cron — the row soft-delete here marks them for that sweep.
 */
tasksRoutes.delete("/tasks/:id", requireCapability("records.delete"), async (c) => {
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const db = getDb(getEnv(c.env));

  const current = await findTask(db, companyId, id);
  if (!current) {
    return errorResponse(c, "not_found", "No such task.");
  }

  // #693: "this one" skips an occurrence; "this and future" ends the repeat and
  // removes the later occurrences nobody finished. Finished ones stay.
  const scope = scopeSchema.safeParse(c.req.query("scope") ?? "this");
  if (!scope.success) {
    throw new ApiError("validation_failed", "scope must be this or future.");
  }
  if (scope.data === "future" && current.series_id) {
    const { data, error } = await db.rpc("api_delete_task_series", {
      p_company_id: companyId,
      p_task_id: id,
      p_actor_user_id: userId,
    });
    if (error) throw new Error(`api_delete_task_series failed: ${error.message}`);
    const result = parseTaskOutcome(data);
    if (result.outcome === "not_found") {
      return errorResponse(c, "not_found", "No such task.");
    }
    await syncRemindersAfterWrite(c, { companyId, taskId: id, userId });
    if (result.correction) return c.json({ correction: result.correction });
    return c.body(null, 204);
  }

  // #691: deleting is the `records.delete` capability, checked by the route gate.
  // The creator no longer deletes on that ground alone.

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
  // #237: a deleted job reminds nobody. The RPC clears the queue on a
  // soft-deleted task, so this is the same call every other write makes.
  await syncRemindersAfterWrite(c, { companyId, taskId: id, userId });

  if (result.correction) return c.json({ correction: result.correction });
  return c.body(null, 204);
});
