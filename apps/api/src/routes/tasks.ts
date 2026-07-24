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
 *          cursor). Each carries the derived `done` boolean + attachment_count
 *          (the size of the SAME D28 union the detail returns).
 *   GET    /v1/tasks/:id             M  — detail: row + resolved assignee +
 *          created_by + the joined source message (live body + done_at for the
 *          derived status) + attachments (the D28 DERIVED union — see below).
 *   PATCH  /v1/tasks/:id             M  — metadata only { title?, description?,
 *          assigned_user_id?, due_at? }. NO `done` field (completion is the
 *          message route). An assignee change writes `task_assigned`; a due_at
 *          change writes `task_due_set`.
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
import { z } from "zod";

import { requireRole } from "../auth/company";
import {
  requireConversationAccess,
  resolveConversationLevel,
  resolveNumberAccess,
} from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import { getEnv, type Env } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { decodeCursor, encodeCursor } from "../http/pagination";
import {
  buildEnrichmentMessages,
  buildEnrichmentResult,
  type CompanyAiSettings,
  DEFAULT_AI_SETTINGS,
  detectEnrichmentSignals,
  ENRICHMENT_ALERT_THRESHOLD,
  ENRICHMENT_MAX_INPUT_CHARS,
  ENRICHMENT_MAX_OUTPUT_TOKENS,
  ENRICHMENT_MODEL,
  ENRICHMENT_MONTHLY_CAP,
  ENRICHMENT_TIMEOUT_MS,
  parseEnrichmentOutput,
} from "../tasks/enrichment";
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
  "assigned_user_id,due_at,created_by_user_id,created_at,updated_at," +
  // #214 structured job address + provenance (null when the task has no address).
  "addr_street,addr_unit,addr_city,addr_state,addr_postal_code," +
  "addr_country,addr_provenance";

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

const createSchema = z.object({
  // message_id REQUIRED — every task promotes a real message (T0.1: standalone
  // tasks are cut from MVP; completion always derives from messages.done_at).
  message_id: z.uuid(),
  title: z.string().trim().min(1).max(TITLE_MAX).optional(),
  description: z.string().max(5000).optional(),
  assigned_user_id: z.uuid().nullable().optional(),
  due_at: z.iso.datetime({ offset: true }).nullable().optional(),
  // #214: the confirmed enriched (or hand-entered) job address.
  address: addressSchema.nullable().optional(),
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
    // #214: replace the whole address block (null clears it).
    address: addressSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.title !== undefined ||
      body.description !== undefined ||
      "assigned_user_id" in body ||
      "due_at" in body ||
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

  // #106/#107: a member with no access to the source message's number can't
  // promote it to a task (that number's content is hidden from them). Creating
  // a task is internal coordination, so 'note' access is enough — a notes-only
  // member may organize work they can read. An unknown message falls through to
  // the RPC's own 422. Owners/admins and no-rules companies short-circuit
  // without touching messages/conversations.
  const role = c.get("role");
  if (role !== "owner" && role !== "admin") {
    const access = await resolveNumberAccess(db, { companyId, userId, role });
    if (access.hiddenNumberIds !== null) {
      const sourceRows = unwrap<{ conversation_id: string }[]>(
        await db
          .from("messages")
          .select("conversation_id")
          .eq("company_id", companyId)
          .eq("id", body.message_id)
          .limit(1),
        "task source lookup",
      );
      if (sourceRows[0]) {
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

  // T3: the mutation is the `create_task` security-definer RPC — ONE atomic
  // transaction that resolves conversation_id from the source message
  // (company-scoped, §10), validates the assignee, inserts the tasks row (the
  // partial-unique tasks_message_uq is the race-safe conflict arbiter), links
  // the source note back (messages.task_id, when the source is a note — so its
  // own files reach the derived attachments union, arm (b)) AND writes the
  // `task_created` audit event together. The route only maps the outcome to the
  // §7 error/HTTP surface; the DB tasks_broadcast trigger fires the ID-only
  // `task.changed` for free (T1.3), so the route publishes no realtime
  // (SPEC §8 broadcast-from-DB).
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
    // #214: the confirmed job address (all-null when the task has none).
    ...addressParams(body.address),
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

// --------------------------------------------------------------------------
// #214 — task enrichment (Cloudflare Workers AI). A pure SUGGESTION endpoint:
// it never writes a task and never blocks task creation. The client posts the
// task text, pre-fills the create form with what comes back, and the user
// reviews + saves. Everything degrades to the empty result — toggles off, no AI
// binding, rate-limited, over the monthly cap, AI timeout/error, or malformed
// output. The model output is DATA (parsed + schema-validated), never an
// instruction; no tool use, no side effect. See src/tasks/enrichment.ts.
// --------------------------------------------------------------------------
const enrichSchema = z.object({
  // Generous ceiling (reject only the absurd); truncated to the model input cap
  // before the AI call.
  text: z.string().trim().min(1).max(20000),
  // Either locates the linked contact whose address is the fallback source.
  message_id: z.uuid().optional(),
  conversation_id: z.uuid().optional(),
});

const EMPTY_ENRICHMENT = {
  address: null,
  address_provenance: null,
  due_at: null,
} as const;

/** Company AI toggles (defaults to all-off when the row is absent). */
async function loadAiSettings(
  db: Db,
  companyId: string,
): Promise<CompanyAiSettings> {
  const rows = unwrap<CompanyAiSettings[]>(
    await db
      .from("company_ai_settings")
      .select("enrich_task_address,enrich_task_due")
      .eq("company_id", companyId)
      .limit(1),
    "ai settings lookup",
  );
  return rows[0] ?? DEFAULT_AI_SETTINGS;
}

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
  const company = companyRows[0];

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
    timezone: company?.timezone ?? "America/Toronto",
    contactAddress,
  };
}

/** One-shot ops alert when a company crosses the enrichment alert threshold. */
async function sendEnrichmentCapAlert(
  env: Env,
  companyId: string,
  count: number,
): Promise<void> {
  const text =
    `Company ${companyId} has used ${count} of ${ENRICHMENT_MONTHLY_CAP} AI ` +
    `task-enrichment calls this month (alerting at ${ENRICHMENT_ALERT_THRESHOLD}). ` +
    `At the cap, enrichment silently stops for the rest of the month — task ` +
    `creation is unaffected. Review if this volume looks abusive.`;
  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    subject: `AI task-enrichment nearing monthly cap — company ${companyId}`,
    text,
    html: renderEmailHtml(text),
  });
}

tasksRoutes.post("/tasks/enrich", requireRole("member"), async (c) => {
  const body = await parseJsonBody(c, enrichSchema);
  const companyId = c.get("companyId");
  const env = getEnv(c.env);
  const db = getDb(env);

  // Settings gate — never call the AI unless the company opted a type in.
  const settings = await loadAiSettings(db, companyId);
  if (!settings.enrich_task_address && !settings.enrich_task_due) {
    return c.json({ ...EMPTY_ENRICHMENT, enrichment_disabled: true });
  }

  const text = body.text.slice(0, ENRICHMENT_MAX_INPUT_CHARS);
  const ctx = await loadEnrichmentContext(db, companyId, {
    conversationId: body.conversation_id,
    messageId: body.message_id,
  });
  const contactAddress = ctx.contactAddress?.trim() || null;

  // "Only when needed" (cost): call the model ONLY when the text plausibly holds
  // the enrichment we're permitted to make. A no-signal task ("call back", "send
  // the quote") never spends an AI call or a cap unit.
  const signals = detectEnrichmentSignals(text);
  const wantAddress = settings.enrich_task_address && signals.address;
  const wantDue = settings.enrich_task_due && signals.due;

  // The contact's address on file — offered as a FREE (no-model) fallback for a
  // task whose text names no address of its own.
  const contactFallback = () =>
    settings.enrich_task_address && contactAddress
      ? c.json({
          address: {
            street: contactAddress,
            unit: null,
            city: null,
            state: null,
            postal_code: null,
            country: null,
          },
          address_provenance: "contact" as const,
          due_at: null,
        })
      : c.json(EMPTY_ENRICHMENT);

  // Nothing worth a model call — the single biggest cost saver.
  if (!wantAddress && !wantDue) return contactFallback();
  // No binding (local dev/tests): degrade to the free fallback, never the model.
  if (!env.AI) return contactFallback();

  // Per-company burst limiter (absent in dev/tests → skipped).
  if (env.AI_ENRICH_RATE_LIMITER) {
    const { success } = await env.AI_ENRICH_RATE_LIMITER.limit({
      key: companyId,
    });
    if (!success) return c.json(EMPTY_ENRICHMENT);
  }

  // Monthly cap-and-drop: reserve one unit atomically; over cap → skip the call.
  const { data: reserveData, error: reserveErr } = await db.rpc(
    "ai_enrich_reserve",
    {
      p_company_id: companyId,
      p_cap: ENRICHMENT_MONTHLY_CAP,
      p_alert_threshold: ENRICHMENT_ALERT_THRESHOLD,
    },
  );
  if (reserveErr) {
    throw new Error(`ai_enrich_reserve failed: ${reserveErr.message}`);
  }
  const reserve = reserveData as {
    count: number;
    over_cap: boolean;
    should_alert: boolean;
  };
  if (reserve.should_alert) {
    c.executionCtx.waitUntil(
      sendEnrichmentCapAlert(env, companyId, reserve.count).catch(() => {}),
    );
  }
  if (reserve.over_cap) return contactFallback();

  const messages = buildEnrichmentMessages({
    text,
    now: new Date(),
    timezone: ctx.timezone,
    contactAddress: ctx.contactAddress,
  });

  // Never block on the AI: race the call against a timeout, degrade on failure.
  let raw: unknown;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    raw = await Promise.race([
      env.AI.run(ENRICHMENT_MODEL, {
        messages,
        max_tokens: ENRICHMENT_MAX_OUTPUT_TOKENS,
      }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("ai enrichment timeout")),
          ENRICHMENT_TIMEOUT_MS,
        );
      }),
    ]);
  } catch {
    return c.json(EMPTY_ENRICHMENT);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  const output = parseEnrichmentOutput(raw);
  if (!output) return c.json(EMPTY_ENRICHMENT);

  const result = buildEnrichmentResult(output, {
    enableAddress: settings.enrich_task_address,
    // Gate on the date SIGNAL, not just the toggle: never surface an inferred
    // due when the text stated no date (belt-and-suspenders with the prompt).
    enableDue: wantDue,
    timezone: ctx.timezone,
    contactAddress: ctx.contactAddress,
  });
  return c.json(result);
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

  // Validate the filter params before they reach PostgREST — a malformed
  // uuid/timestamp otherwise raises a PostgREST type error (22P02) that surfaces
  // as a 500 + Sentry noise instead of a clean 422 (matches GET /v1/conversations).
  if (conversationId !== undefined && !z.uuid().safeParse(conversationId).success) {
    throw new ApiError("validation_failed", "conversation_id must be a UUID.");
  }
  if (
    rawAssignee !== undefined &&
    rawAssignee !== "me" &&
    !z.uuid().safeParse(rawAssignee).success
  ) {
    throw new ApiError(
      "validation_failed",
      "assigned_user_id must be a UUID or 'me'.",
    );
  }
  for (const [name, value] of [
    ["due_before", dueBefore],
    ["due_after", dueAfter],
  ] as const) {
    if (
      value !== undefined &&
      !z.iso.datetime({ offset: true }).safeParse(value).success
    ) {
      throw new ApiError(
        "validation_failed",
        `${name} must be an ISO 8601 datetime.`,
      );
    }
  }

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

  // messages!message_id!inner embeds the SOURCE row (tasks.message_id → messages,
  // disambiguated from the reverse messages.task_id FK) so status can filter on
  // done_at and the response carries the derived `done`. has_location joins
  // contacts via the source conversation only when requested (keeps the common
  // path lean).
  const select =
    `${TASK_COLUMNS},messages!message_id!inner(id,done_at)` +
    (hasLocation
      ? ",conversations!inner(id,phone_number_id,contacts!inner(id,name,lat,lng))"
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
    // #106/#107: the map view exposes the source contact's NAME + geocode via
    // the conversations→contacts join — that's conversation content, not the
    // globally-visible task title. Exclude tasks whose number is hidden from
    // the caller so the map can never plot a hidden customer. The !inner join
    // makes this embed filter drop the parent row, so the keyset window stays
    // correct (no post-filter truncation). Owners/admins and no-rules companies
    // resolve unrestricted and skip it.
    const access = await resolveNumberAccess(db, {
      companyId,
      userId,
      role: c.get("role"),
    });
    if (access.hiddenNumberIds && access.hiddenNumberIds.length > 0) {
      query = query.not(
        "conversations.phone_number_id",
        "in",
        `(${access.hiddenNumberIds.join(",")})`,
      );
    }
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

  interface TaskListContactEmbed {
    id: string;
    name: string | null;
    lat: number | null;
    lng: number | null;
  }
  interface TaskListRow {
    id: string;
    created_at: string;
    due_at: string | null;
    messages: { done_at: string | null } | null;
    // Only present when has_location narrowed the set (the conversations!inner
    // → contacts!inner embed): the source contact's cached geocode. A single
    // conversation resolves to one contact object (not an array).
    conversations?: { id: string; contacts: TaskListContactEmbed | null } | null;
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
    // Map view (D25): when has_location narrowed the set, project the already-
    // joined contact geocode onto the row as `contact` (the TaskContactLocation
    // shape the web client's `taskCoords` reads). Without this the coordinates
    // that the join used to FILTER would never reach the client and no pin
    // could render. Non-located reads never carry the join, so `contact` is
    // simply absent there — the frozen non-map contract is unchanged.
    const base = { ...rest, done, status: done ? "done" : "open" };
    if (hasLocation) {
      const contact = row.conversations?.contacts ?? null;
      return {
        ...base,
        contact: contact
          ? {
              id: contact.id,
              name: contact.name,
              lat: contact.lat,
              lng: contact.lng,
            }
          : null,
      };
    }
    return base;
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
      message_id: string;
      messages: { done_at: string | null } | null;
      [key: string]: unknown;
    }
    const rows = unwrap<ChecklistRow[]>(
      await db
        .from("tasks")
        .select(`${TASK_COLUMNS},messages!message_id!inner(id,done_at)`)
        .eq("company_id", companyId)
        .eq("conversation_id", conversationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      "conversation tasks",
    );

    // attachment_count: the size of the D28 derived union (source-message MMS
    // + linked-note files + legacy task rows) — the SAME loader the detail's
    // `attachments` array uses, so the badge and the drawer always agree.
    const attachmentUnions = await loadTaskAttachments(
      db,
      companyId,
      rows.map((row) => ({ id: row.id, message_id: row.message_id })),
    );

    const data = rows.map((row) => {
      const { messages, ...rest } = row;
      const done = (messages?.done_at ?? null) !== null;
      return {
        ...rest,
        done,
        status: done ? "done" : "open",
        attachment_count: attachmentUnions.get(row.id)?.length ?? 0,
      };
    });
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
  tasks: { id: string; message_id: string }[],
): Promise<Map<string, TaskAttachmentItem[]>> {
  const byTask = new Map<string, TaskAttachmentItem[]>();
  if (tasks.length === 0) return byTask;
  for (const task of tasks) byTask.set(task.id, []);
  const taskIds = tasks.map((task) => task.id);

  // Arm (a) — MMS media of the source messages, one batched lookup.
  const taskByMessage = new Map(tasks.map((task) => [task.message_id, task.id]));
  const mmsRows = unwrap<
    {
      id: string;
      message_id: string;
      content_type: string | null;
      size_bytes: number | null;
      created_at: string;
    }[]
  >(
    await db
      .from("message_attachments")
      .select("id,message_id,content_type,size_bytes,created_at")
      .eq("company_id", companyId)
      .in("message_id", [...taskByMessage.keys()]),
    "task mms attachments",
  );
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
    });
  }

  // Arm (b) — notes linked to the tasks, then their live generic attachments.
  const noteRows = unwrap<{ id: string; task_id: string }[]>(
    await db
      .from("messages")
      .select("id,task_id")
      .eq("company_id", companyId)
      .eq("direction", "note")
      .in("task_id", taskIds),
    "task note links",
  );
  const taskByNote = new Map(noteRows.map((note) => [note.id, note.task_id]));

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
  const pushGeneric = (
    row: GenericRow,
    source: "note" | "task",
    taskId: string | undefined,
  ): void => {
    if (taskId === undefined) return;
    byTask.get(taskId)?.push({
      id: row.id,
      source,
      kind: attachmentKind(row.content_type),
      file_name: row.file_name,
      content_type: row.content_type,
      size_bytes: row.size_bytes,
      created_at: row.created_at,
    });
  };

  if (taskByNote.size > 0) {
    const rows = unwrap<GenericRow[]>(
      await db
        .from("attachments")
        .select(genericSelect)
        .eq("company_id", companyId)
        .eq("owner_type", "note")
        .in("owner_id", [...taskByNote.keys()])
        .is("deleted_at", null),
      "task note attachments",
    );
    for (const row of rows) pushGeneric(row, "note", taskByNote.get(row.owner_id));
  }

  const legacyRows = unwrap<GenericRow[]>(
    await db
      .from("attachments")
      .select(genericSelect)
      .eq("company_id", companyId)
      .eq("owner_type", "task")
      .in("owner_id", taskIds)
      .is("deleted_at", null),
    "task legacy attachments",
  );
  for (const row of legacyRows) pushGeneric(row, "task", row.owner_id);

  for (const items of byTask.values()) {
    items.sort((a, b) => {
      if (a.created_at !== b.created_at) {
        return a.created_at < b.created_at ? -1 : 1;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }
  return byTask;
}

/**
 * GET /v1/tasks/:id — task detail (T6.2). Full row + resolved profiles + the
 * joined source message (live body + done_at for the derived status) + the
 * D28 derived attachments union.
 */
tasksRoutes.get("/tasks/:id", requireRole("member"), async (c) => {
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const db = getDb(getEnv(c.env));

  interface DetailRow {
    id: string;
    message_id: string;
    conversation_id: string;
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
          "messages!message_id!inner(id,body,done_at,done_by_user_id,created_at,direction)",
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

  const { messages, ...task } = row;
  const done = (messages?.done_at ?? null) !== null;
  const identity = {
    ...task,
    done,
    status: done ? "done" : "open",
    assignee: row.assigned_user_id
      ? profiles.get(row.assigned_user_id) ?? null
      : null,
    created_by: profiles.get(row.created_by_user_id) ?? null,
  };

  // #107: tasks are GLOBAL (assignable to anyone, visible on /tasks + /for-you),
  // but the source conversation obeys #106. A member with no access to the
  // task's number still sees the task's identity, but every field derived from
  // the hidden conversation — the source message, its attachments, the note
  // discussion — is withheld. `viewer_level` lets the web hide the text/reply
  // affordance at 'note' and show a no-access notice at 'none'.
  const viewerLevel = await resolveConversationLevel(db, {
    companyId,
    userId: c.get("userId"),
    role: c.get("role"),
    conversationId: row.conversation_id,
  });
  if (viewerLevel === "none") {
    return c.json({
      ...identity,
      viewer_level: viewerLevel,
      source_message: null,
      attachments: [],
      activity: [],
    });
  }

  // D28: the derived attachments union (source-message MMS + linked-note files
  // + legacy task-owned rows), gallery-shaped, no pre-signed urls — the web
  // calls GET /v1/attachments/:id/url per item.
  const attachmentUnions = await loadTaskAttachments(db, companyId, [
    { id, message_id: row.message_id },
  ]);
  const attachments = attachmentUnions.get(id) ?? [];

  // TASKS-V2 D-C + D-D: the merged activity-and-discussion timeline. Reuses
  // existing data — no new table. Two arms, both company + task scoped:
  //   1. the task_* conversation_events for THIS task (filtered by the audit
  //      payload's task_id), and
  //   2. the internal notes linked to this task (messages.task_id = id).
  // Merged and sorted (created_at, id) ASC so the drawer reads oldest-first,
  // like the thread. Author display names are resolved from profiles.
  const activity = await loadTaskActivity(db, companyId, id, profiles);

  return c.json({
    ...identity,
    viewer_level: viewerLevel,
    source_message: messages,
    attachments,
    activity,
  });
});

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
 * company-scoped arms: the `task_*` conversation_events for this task id (the
 * audit payload carries `task_id`) and the internal notes linked to the task
 * (`messages.task_id = taskId`). `profiles` is the already-resolved
 * assignee/creator name cache; note/event actor names not in it are resolved in
 * one extra batch. Result is sorted (created_at, id) ASC (oldest-first).
 */
async function loadTaskActivity(
  db: Db,
  companyId: string,
  taskId: string,
  profiles: Map<string, Record<string, unknown>>,
): Promise<TaskActivityItem[]> {
  // Arm 1: task_* audit events for this task (payload->>'task_id' = taskId).
  const eventRows = unwrap<
    {
      id: string;
      type: string;
      payload: Record<string, unknown> | null;
      actor_user_id: string | null;
      created_at: string;
    }[]
  >(
    await db
      .from("conversation_events")
      .select("id,type,payload,actor_user_id,created_at")
      .eq("company_id", companyId)
      .in("type", [
        "task_created",
        "task_assigned",
        "task_due_set",
        "task_deleted",
        // task_attachment_added is NOT filtered: D28 closed the task upload
        // ingress, so no such event is ever written post-D28 — including it
        // would only match dead pre-D28 rows. task_attachment_removed stays: the
        // DELETE route now stamps task_id on it (legacy task-file deletions), so
        // it surfaces here via the payload->>task_id filter below.
        "task_attachment_removed",
      ])
      .eq("payload->>task_id", taskId)
      .order("created_at", { ascending: true }),
    "task activity events",
  );

  // Arm 2: internal notes linked to this task (messages.task_id = taskId).
  const noteRows = unwrap<
    {
      id: string;
      body: string;
      sent_by_user_id: string | null;
      created_at: string;
    }[]
  >(
    await db
      .from("messages")
      .select("id,body,sent_by_user_id,created_at")
      .eq("company_id", companyId)
      .eq("task_id", taskId)
      .eq("direction", "note")
      .order("created_at", { ascending: true }),
    "task activity notes",
  );

  // Resolve any actor/author names not already in the profiles cache (one batch).
  const needed = new Set<string>();
  for (const e of eventRows) {
    if (e.actor_user_id && !profiles.has(e.actor_user_id)) {
      needed.add(e.actor_user_id);
    }
  }
  for (const n of noteRows) {
    if (n.sent_by_user_id && !profiles.has(n.sent_by_user_id)) {
      needed.add(n.sent_by_user_id);
    }
  }
  if (needed.size > 0) {
    const found = unwrap<{ user_id: string; display_name: string | null }[]>(
      await db
        .from("profiles")
        .select("user_id,display_name")
        .in("user_id", [...needed]),
      "task activity profiles",
    );
    for (const p of found) profiles.set(p.user_id, p);
  }
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
    "due_at" in body ||
    "address" in body;
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
      // #214: only overwrite the address block when the client sent `address`
      // (null clears it); absent → the RPC leaves the address untouched.
      p_set_address: "address" in body,
      ...addressParams(body.address),
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
