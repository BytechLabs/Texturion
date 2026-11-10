/**
 * #714: one activity timeline for every record. Mounted at /v1.
 *
 *   GET /v1/contacts/:id/activity
 *   GET /v1/conversations/:id/activity
 *   GET /v1/calls/:id/activity
 *   GET /v1/tasks/:id/record-activity
 *        (`/tasks/:id/activity` is the #689 feed that also carries comments and
 *        is what the phones read today; this is the same shared model.)
 *
 * Query: `category` = message | call | change (omit for All), `limit` (default
 * 50, max 100), `cursor` (opaque, from `next_cursor`).
 *
 * Response: { data: Item[], next_cursor }, newest first, where an Item is
 *   { id, kind, category, occurred_at,
 *     actor: { type: "member"|"customer"|"automation"|"system",
 *              user_id: string | null, display_name: string | null },
 *     payload, source: { type, id, conversation_id } | null }
 * `kind` is one of text_in, text_out, scheduled_queued, scheduled_sent,
 * scheduled_cancelled, call, voicemail, created, edited, tagged, untagged,
 * merged, unmerged, deleted, restored, assigned, unassigned, mentioned,
 * referenced, opted_out, opted_in, blocked, unblocked, task_created,
 * task_completed, completed, reopened. A call row's payload carries direction,
 * outcome, ended_reason and talk_seconds; an edit's carries field, from and to.
 *
 * ACCESS is the record's own: reading a record's activity needs exactly what
 * reading the record needs, including number access (#106). A record the caller
 * cannot see is a 404, and a row on a number the caller is denied is not
 * returned on any record.
 */
import { Hono } from "hono";
import { z } from "zod";

import { requireCapability } from "../auth/company";
import { resolveNumberAccess } from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { buildPage, decodeCursor } from "../http/pagination";
import { parseLimit, pathUuid, unwrap } from "./core/http";

type RecordType = "contact" | "task" | "conversation" | "call";

const CATEGORIES = ["message", "call", "change"] as const;

const rpcShape = z.object({
  outcome: z.enum(["ok", "not_found"]),
  items: z
    .array(
      z.object({
        id: z.string(),
        kind: z.string(),
        category: z.enum(CATEGORIES),
        occurred_at: z.string(),
        actor_type: z.enum(["member", "customer", "automation", "system"]),
        actor_id: z.string().nullable(),
        payload: z.record(z.string(), z.unknown()),
        source_type: z.string().nullable(),
        source_id: z.string().nullable(),
        conversation_id: z.string().nullable(),
      }),
    )
    .optional(),
});

const NOT_FOUND: Record<RecordType, string> = {
  contact: "No such contact.",
  task: "No such task.",
  conversation: "No such conversation.",
  call: "No such call.",
};

export const recordActivityRoutes = new Hono<AppEnv>();

async function readActivity(
  c: import("hono").Context<AppEnv>,
  recordType: RecordType,
): Promise<Response> {
  const recordId = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const limit = parseLimit(c, 50, 100);
  const rawCursor = c.req.query("cursor");
  const cursor = rawCursor === undefined ? null : decodeCursor(rawCursor);
  const category = c.req.query("category");
  if (category !== undefined && !(CATEGORIES as readonly string[]).includes(category)) {
    return errorResponse(
      c,
      "validation_failed",
      "category: one of message, call or change.",
    );
  }
  const db = getDb(getEnv(c.env));

  const access = await resolveNumberAccess(db, {
    companyId,
    userId: c.get("userId"),
    role: c.get("role"),
  });
  const { data, error } = await db.rpc("api_record_activity", {
    p_company_id: companyId,
    p_record_type: recordType,
    p_record_id: recordId,
    p_hidden_number_ids: access.hiddenNumberIds,
    p_category: category ?? null,
    // One more than the page, which only signals that an older page exists.
    p_limit: limit + 1,
    p_before_ts: cursor?.ts ?? null,
    p_before_id: cursor?.id ?? null,
  });
  if (error) throw new Error(`api_record_activity failed: ${error.message}`);
  const parsed = rpcShape.safeParse(data);
  if (!parsed.success) {
    throw new Error(`api_record_activity returned an unexpected shape: ${parsed.error}`);
  }
  if (parsed.data.outcome === "not_found") {
    return errorResponse(c, "not_found", NOT_FOUND[recordType]);
  }

  const rows = parsed.data.items ?? [];
  const page = buildPage(rows, limit, "occurred_at");

  const userIds = [
    ...new Set(
      page.data.flatMap((row) => (row.actor_id ? [row.actor_id] : [])),
    ),
  ];
  const names = new Map<string, string | null>();
  if (userIds.length > 0) {
    const profiles = unwrap<{ user_id: string; display_name: string | null }[]>(
      await db.from("profiles").select("user_id,display_name").in("user_id", userIds),
      "activity profiles",
    );
    for (const p of profiles) names.set(p.user_id, p.display_name);
  }

  return c.json({
    data: page.data.map((row) => ({
      id: row.id,
      kind: row.kind,
      category: row.category,
      occurred_at: row.occurred_at,
      actor: {
        type: row.actor_type,
        user_id: row.actor_id,
        display_name: row.actor_id ? (names.get(row.actor_id) ?? null) : null,
      },
      payload: row.payload,
      source:
        row.source_type && row.source_id
          ? {
              type: row.source_type,
              id: row.source_id,
              conversation_id: row.conversation_id,
            }
          : null,
    })),
    next_cursor: page.next_cursor,
  });
}

recordActivityRoutes.get(
  "/contacts/:id/activity",
  requireCapability("conversations.read"),
  (c) => readActivity(c, "contact"),
);
recordActivityRoutes.get(
  "/conversations/:id/activity",
  requireCapability("conversations.read"),
  (c) => readActivity(c, "conversation"),
);
recordActivityRoutes.get(
  "/calls/:id/activity",
  requireCapability("conversations.read"),
  (c) => readActivity(c, "call"),
);
recordActivityRoutes.get(
  "/tasks/:id/record-activity",
  requireCapability("conversations.read"),
  (c) => readActivity(c, "task"),
);
