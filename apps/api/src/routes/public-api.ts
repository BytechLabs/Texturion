/**
 * #243 — the public REST surface.
 *
 *   GET  /public/v1/me         what this key is, and what it may do.
 *   GET  /public/v1/contacts   the customer list, newest first.
 *   POST /public/v1/contacts   { phone_e164, name?, email?, notes? }
 *   GET  /public/v1/conversations           the thread list, newest first.
 *   GET  /public/v1/conversations/:id/messages
 *   POST /public/v1/messages   { conversation_id, body } + Idempotency-Key.
 *   GET  /public/v1/tasks      the job list, newest first.
 *   POST /public/v1/tasks      { message_id?, title?, due_at?, description?,
 *                              assigned_user_id? | assignee_ids?, contact_id?,
 *                              conversation_id? }
 *                              (no message_id: a standalone task, title required)
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE INTERNAL API WITH A DIFFERENT DOOR
 *
 * #243 asks for "the ten calls an integrator actually needs", not the whole
 * first-party surface. The distinction is a commitment: every route here is a
 * promise that cannot be withdrawn without breaking somebody's connector,
 * while `/v1` changes shape whenever the product does. Mounting the same
 * handlers on both would quietly turn every internal refactor into a breaking
 * change for people we have never met.
 *
 * So this file is thin and separate, and it will grow one deliberate route at a
 * time.
 *
 * ---------------------------------------------------------------------------
 * TWO GATES ON EVERY ROUTE
 *
 * `requireCapability` asks whether the person who made the key may do this at
 * all. `requireScope` asks whether they delegated it to THIS key. Both, always
 * — a route carrying only one is a route where either the creator's role or the
 * key's narrowing is doing no work.
 *
 * The capability gate is not decorative: a key made by a bookkeeper carries
 * their role, and a bookkeeper has no `conversations.note`, so the same key
 * with the same scopes reaches less than an owner's would. That is the
 * intended behaviour and it falls out of acting AS the creator.
 */
import {
  missingWebhookScopes,
  PUBLIC_API_BASE,
  WEBHOOK_ENDPOINT_CAP,
  WEBHOOK_EVENT_TYPES,
  webhookUrlRejection,
} from "@loonext/shared";
import { Hono } from "hono";
import { z } from "zod";

import { apiKeyAuth, requireScope } from "../auth/api-key";
import { requireCapability } from "../auth/company";
import {
  requireConversationAccess,
  resolveNumberAccess,
} from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { buildPage } from "../http/pagination";
import { sendTextToConversation } from "../messaging/send-text";
import { requestedAssignees } from "../tasks/assignees";
import { afterTaskCreated } from "../tasks/follow-ups";
import { prioritySchema, repeatSchema, withLabelsAndRepeat } from "../tasks/repeat";
import { keysetFilter, optionalIdempotencyKey, parseCursor, parseJsonBody, pathUuid, unwrap } from "./core/http";
import { composeConversation } from "./compose";
import { normalizeNanpPhone } from "./core/phone";
import { contactNumberConflict, contactNumberOwner, contactNumberTaken } from "./core/contact-number";

/**
 * What a public read returns for a contact.
 *
 * A deliberate subset of the internal one. Custom fields, attribution and the
 * geocoding columns are omitted — not because they are secret, but because
 * every column published here becomes a shape somebody parses, and the honest
 * way to add one later is to add it, rather than to have leaked it early and
 * be unable to change it.
 */
const PUBLIC_CONTACT_COLUMNS =
  "id,phone_e164,name,email,business_name,address,notes,created_at,updated_at";

const PUBLIC_TASK_COLUMNS =
  "id,number,message_id,source_call_id,conversation_id,contact_id,title,description,due_at,due_on,due_time_set,assigned_user_id,created_at,priority,series_id";

type PublicListRow = { id: string; created_at: string } & Record<string, unknown>;
type PublicConversationRow = { id: string; last_message_at: string } & Record<string, unknown>;

/**
 * A public task keeps `message_id` (null for a task promoted from a call, D64,
 * or a standalone one) and gains `source`, which names which kind of thing the
 * task came from (null for a standalone task; `conversation_id` and
 * `contact_id` are then its optional links). The
 * old field is not repurposed: an integration that read it keeps working, it
 * just sees null where there is no message.
 */
function publicTask(row: Record<string, unknown>): Record<string, unknown> {
  const { source_call_id: callId, series_id: _series, ...rest } = row;
  const source =
    typeof rest.message_id === "string"
      ? { kind: "message", id: rest.message_id }
      : (typeof callId === "string"
        ? { kind: "call", id: callId }
        : null);
  // #689 C: `assigned_user_id` is the FIRST assignee, kept for v1 callers, and
  // `assignee_ids` is everyone. The display names stay internal.
  delete rest.assignees;
  return { ...rest, source };
}

/** Bounded, and the bound is published so a caller can page deliberately. */
const MAX_PAGE = 100;
const DEFAULT_PAGE = 25;

function pageSize(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_PAGE;
  return Math.min(parsed, MAX_PAGE);
}

const createContactSchema = z.object({
  phone_e164: z.string().trim().min(8).max(20),
  name: z.string().trim().max(120).optional(),
  email: z.email().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const sendMessageSchema = z.object({
  conversation_id: z.uuid().optional(),
  to: z.string().trim().min(1).max(32)
    .refine((value) => normalizeNanpPhone(value) !== null, "Use a valid US or Canadian phone number.")
    .optional(),
  phone_number_id: z.uuid().optional(),
  consent_attested: z.literal(true).optional(),
  quiet_hours_confirmed: z.boolean().optional(),
  body: z.string().trim().min(1).max(1600),
}).refine(
  (body) => (body.conversation_id === undefined) !== (body.to === undefined),
  { message: "Provide exactly one of conversation_id or to." },
).refine(
  (body) => !body.to || body.consent_attested === true,
  { message: "consent_attested must be true when sending to a phone number." },
);

const subscribeSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).transform((e) => [...new Set(e)]),
  description: z.string().trim().max(200).optional(),
});

const createTaskSchema = z
  .object({
    // Absent: a standalone task (D64 amended, #689), which needs a title.
    message_id: z.uuid().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    due_at: z.iso.datetime({ offset: true }).optional(),
    due_on: z.iso.date().optional(),
    // One person, as before. `assignee_ids` (up to ten) wins when both are sent.
    assigned_user_id: z.uuid().nullable().optional(),
    assignee_ids: z.array(z.uuid()).max(10).optional(),
    contact_id: z.uuid().optional(),
    conversation_id: z.uuid().optional(),
    // #693: none, low, normal (default), high or urgent; workspace tag ids; and
    // a repeat ({kind, unit, every, ...}, see docs/PUBLIC-API.md).
    priority: prioritySchema.optional(),
    label_ids: z.array(z.uuid()).max(20).optional(),
    repeat: repeatSchema.optional(),
  })
  .refine((body) => body.message_id !== undefined || body.title !== undefined, {
    message: "title is required when the task has no message_id.",
    path: ["title"],
  })
  .refine(
    (body) =>
      body.message_id === undefined ||
      (body.contact_id === undefined && body.conversation_id === undefined),
    {
      message: "contact_id and conversation_id link a task that has no message_id.",
      path: ["contact_id"],
    },
  );

export const publicApiRoutes = new Hono<AppEnv>();

// Every route below this line is authenticated by an API key, rate-limited per
// key, and answers with the version header.
publicApiRoutes.use(`${PUBLIC_API_BASE}/*`, apiKeyAuth());

/**
 * The call every integrator makes first.
 *
 * Says which workspace the key reaches and exactly what it may do — so a
 * connector can fail at setup with "this key cannot send messages" rather than
 * at 3am with a 403 nobody is watching. It carries no scope requirement of its
 * own, because a key that cannot ask what it is would be undebuggable.
 */
publicApiRoutes.get(`${PUBLIC_API_BASE}/me`, (c) =>
  c.json({
    company_id: c.get("companyId"),
    key_id: c.get("apiKeyId"),
    scopes: c.get("apiKeyScopes") ?? [],
  }),
);

publicApiRoutes.get(
  `${PUBLIC_API_BASE}/contacts`,
  requireScope("contacts:read"),
  requireCapability("conversations.read"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const limit = pageSize(c.req.query("limit"));
    const cursor = parseCursor(c);
    const rawPhone = c.req.query("phone");
    let query = db
      .from("contacts")
      .select(`${PUBLIC_CONTACT_COLUMNS},contact_tags(tags(name))`)
      .eq("company_id", c.get("companyId"))
      .is("deleted_at", null)
      .is("merged_into", null);
    if (rawPhone !== undefined) {
      const phone = normalizeNanpPhone(rawPhone);
      if (!phone) {
        return errorResponse(c, "validation_failed", "phone: use a valid US or Canadian phone number.");
      }
      const owner = await contactNumberOwner(db, c.get("companyId"), phone);
      query = owner && owner.phone_e164 !== phone
        ? query.eq("id", owner.id)
        : query.eq("phone_e164", phone);
    }
    if (cursor) query = query.or(keysetFilter("created_at", cursor));
    const rows = unwrap<PublicListRow[]>(
      await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1),
      "public contacts list",
    );
    const page = buildPage(rows, limit, "created_at");
    const data = page.data.map((row) => {
      const { contact_tags: links, ...rest } = row as {
        contact_tags?: { tags: { name: string } | null }[];
      } & Record<string, unknown>;
      const tags = (links ?? [])
        .map((link) => link.tags?.name)
        .filter((name): name is string => typeof name === "string")
        .toSorted((a, b) => a.localeCompare(b));
      return { ...rest, tags };
    });
    return c.json({ data, limit, next_cursor: page.next_cursor });
  },
);

publicApiRoutes.post(
  `${PUBLIC_API_BASE}/contacts`,
  requireScope("contacts:write"),
  requireCapability("conversations.note"),
  async (c) => {
    const body = await parseJsonBody(c, createContactSchema);
    const phone = normalizeNanpPhone(body.phone_e164);
    if (!phone) {
      return errorResponse(c, "validation_failed", "phone_e164: use a valid US or Canadian phone number.");
    }
    const db = getDb(getEnv(c.env));
    const companyId = c.get("companyId");

    const fields = {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.email === undefined ? {} : { email: body.email }),
      ...(body.notes === undefined ? {} : { notes: body.notes }),
    };

    /*
     * #581 — re-sending an EXISTING contact is an update, not a create.
     *
     * This route reused the raw upsert shape without the branch its
     * first-party twin carries (routes/contacts.ts), and a bare upsert here
     * is `ON CONFLICT DO UPDATE` over every column in the payload — including
     * `created_by_user_id`. So a connector replaying its own queue, which is
     * the NORMAL case rather than the exception, silently rewrote "who first
     * added this customer" to the key's creator on every pass, and never
     * stamped `updated_by_user_id` at all.
     *
     * That is not cosmetic: contacts.ts projects `created_by_name` and
     * `updated_by_name` from those columns, so the screen a person reads to
     * answer "who brought this customer in" was being overwritten by a
     * machine — and the answer it then gave was wrong in the direction that
     * erases somebody's work.
     *
     * A soft-deleted or brand-new number still takes the upsert, with a fresh
     * `created_by`: resurrecting a deleted contact IS a new addition.
     */
    const existing = await contactNumberOwner(db, companyId, phone);
    if (existing && existing.phone_e164 !== phone) return contactNumberTaken(c, existing.id);
    const live = existing?.deleted_at === null ? existing : null;

    const write = live
      ? await db
          .from("contacts")
          .update({ ...fields, updated_by_user_id: c.get("userId") })
          .eq("id", live.id)
          .is("merged_into", null)
          .select(PUBLIC_CONTACT_COLUMNS)
      : await db
          .from("contacts")
          .upsert(
            {
              company_id: companyId,
              phone_e164: phone,
              deleted_at: null,
              created_by_user_id: c.get("userId"),
              creation_origin: "api",
              ...fields,
            },
            { onConflict: "company_id,phone_e164" },
          )
          .select(PUBLIC_CONTACT_COLUMNS);
    const collision = contactNumberConflict(write.error);
    if (collision) return contactNumberTaken(c, collision);
    const rows = unwrap<Record<string, unknown>[]>(write, live ? "public contact update" : "public contact upsert");
    if (live && rows.length === 0) {
      const owner = await contactNumberOwner(db, companyId, phone);
      return owner ? contactNumberTaken(c, owner.id) : errorResponse(c, "not_found", "No such contact.");
    }
    return c.json(rows[0], 201);
  },
);

publicApiRoutes.get(
  `${PUBLIC_API_BASE}/conversations`,
  requireScope("conversations:read"),
  requireCapability("conversations.read"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const limit = pageSize(c.req.query("limit"));
    const cursor = parseCursor(c);

    // #106: the same deny list the first-party inbox resolves, from the same
    // function, against the KEY'S CREATOR. A key must not be able to enumerate
    // conversations on a number its creator cannot see — which is the whole
    // reason the middleware resolves a real member rather than inventing a
    // service identity with no access rules attached to it.
    const access = await resolveNumberAccess(db, {
      companyId: c.get("companyId"),
      userId: c.get("userId"),
      role: c.get("role"),
    });

    const rows = unwrap<PublicConversationRow[]>(
      await db.rpc("api_list_conversations", {
        p_company_id: c.get("companyId"),
        p_user_id: c.get("userId"),
        p_limit: limit + 1,
        p_status: c.req.query("status") ?? null,
        p_assigned_user_id: null,
        p_tag_id: null,
        p_is_spam: false,
        p_unread: false,
        p_q: null,
        p_cursor_ts: cursor?.ts ?? null,
        p_cursor_id: cursor?.id ?? null,
        p_pinned: null,
        p_hidden_number_ids: access.hiddenNumberIds,
        p_snoozed: "all",
        p_awaiting: null,
      }),
      "public conversations list",
    );

    // Reshaped rather than passed through. The internal row carries embedded
    // tags, unread state and a snippet shaped for our own inbox; publishing it
    // would make every one of those a promise, and they change whenever the
    // inbox does.
    const page = buildPage(rows, limit, "last_message_at");
    return c.json({
      data: page.data.map((row) => ({
        id: row.id,
        contact_id: row.contact_id,
        status: row.status,
        last_message_at: row.last_message_at,
        assigned_user_id: row.assigned_user_id,
      })),
      limit,
      next_cursor: page.next_cursor,
    });
  },
);

publicApiRoutes.get(
  `${PUBLIC_API_BASE}/conversations/:id/messages`,
  requireScope("messages:read"),
  requireCapability("conversations.read"),
  async (c) => {
    const conversationId = pathUuid(c, "id");
    const db = getDb(getEnv(c.env));
    const limit = pageSize(c.req.query("limit"));

    // #106 again, and this one 404s rather than 403s: a thread on a number the
    // creator cannot see is indistinguishable from a thread that does not
    // exist, which is what stops a key being used to probe for them.
    await requireConversationAccess(db, {
      companyId: c.get("companyId"),
      userId: c.get("userId"),
      role: c.get("role"),
      conversationId,
      need: "read",
    });

    const cursor = parseCursor(c);
    let query = db
      .from("messages")
      .select("id,conversation_id,direction,body,status,created_at")
      .eq("company_id", c.get("companyId"))
      .eq("conversation_id", conversationId)
      .is("deleted_at", null);
    if (cursor) query = query.or(keysetFilter("created_at", cursor));
    const rows = unwrap<PublicListRow[]>(
      await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1),
      "public messages list",
    );
    return c.json({ ...buildPage(rows, limit, "created_at"), limit });
  },
);

publicApiRoutes.post(
  `${PUBLIC_API_BASE}/messages`,
  requireScope("messages:send"),
  requireCapability("conversations.send"),
  async (c) => {
    const body = await parseJsonBody(c, sendMessageSchema);
    const env = getEnv(c.env);

    // Required, not optional, and that is a decision about who is calling. An
    // integration retries — that is what makes it an integration — and a send
    // endpoint without an idempotency key turns every network blip into a
    // second text to a real customer. The first-party clients are held to the
    // same rule for the same reason.
    const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      return errorResponse(
        c,
        "validation_failed",
        "An `Idempotency-Key` header is required so a retry cannot send twice.",
      );
    }

    const db = getDb(env);
    const companyId = c.get("companyId");
    const result = body.to
      ? await composeConversation(c, {
        phone_e164: body.to,
        phone_number_id: body.phone_number_id,
        body: body.body,
        consent_attested: true,
        quiet_hours_confirmed: body.quiet_hours_confirmed,
      }, idempotencyKey, "api")
      : await sendTextToConversation(env, db, {
        companyId,
        conversationId: body.conversation_id!,
        userId: c.get("userId"),
        role: c.get("role"),
        body: body.body,
        idempotencyKey,
      });
    const { message, existing } = result;

    return c.json(
      {
        id: message.id,
        conversation_id: message.conversation_id,
        direction: message.direction,
        body: message.body,
        status: message.status,
        created_at: message.created_at,
      },
      // 200 on a replay, 201 on a new send — so a caller can tell whether its
      // retry actually did anything.
      existing ? 200 : 201,
    );
  },
);

publicApiRoutes.get(
  `${PUBLIC_API_BASE}/tasks`,
  requireScope("tasks:read"),
  requireCapability("conversations.read"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const limit = pageSize(c.req.query("limit"));
    const cursor = parseCursor(c);
    const companyId = c.get("companyId");
    const contactId = c.req.query("contact_id");
    if (contactId !== undefined && !z.uuid().safeParse(contactId).success) {
      return errorResponse(c, "validation_failed", "contact_id: not a valid id.");
    }
    const taskColumns = contactId === undefined
      ? PUBLIC_TASK_COLUMNS
      : `${PUBLIC_TASK_COLUMNS},conversations!conversation_id()`;
    let query = db
      .from("tasks")
      .select(taskColumns)
      .eq("company_id", companyId)
      .is("deleted_at", null);
    if (contactId !== undefined) {
      const access = await resolveNumberAccess(db, {
        companyId,
        userId: c.get("userId"),
        role: c.get("role"),
      });
      query = query
        .eq("conversations.company_id", companyId)
        .eq("conversations.contact_id", contactId)
        .is("conversations.deleted_at", null)
        .or(`contact_id.eq.${contactId},conversations.not.is.null`);
      if (access.hiddenNumberIds?.length) {
        query = query.or(
          `phone_number_id.is.null,phone_number_id.not.in.(${access.hiddenNumberIds.join(",")})`,
          { referencedTable: "conversations" },
        );
      }
    }
    if (cursor) query = query.or(keysetFilter("created_at", cursor));
    const rows = unwrap<unknown>(
      await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1),
      "public tasks list",
    ) as PublicListRow[];
    const page = buildPage(rows, limit, "created_at");
    const decorated = await withLabelsAndRepeat(db, companyId, page.data);
    return c.json({ data: decorated.map(publicTask), limit, next_cursor: page.next_cursor });
  },
);

publicApiRoutes.post(
  `${PUBLIC_API_BASE}/tasks`,
  requireScope("tasks:write"),
  requireCapability("conversations.note"),
  async (c) => {
    const body = await parseJsonBody(c, createTaskSchema);
    if (body.due_on && body.due_at) {
      return errorResponse(c, "validation_failed", "Provide a time or a date for this job.", {
        key: "apiRefusals.bookingDuePrecision",
      });
    }
    const idempotencyKey = optionalIdempotencyKey(c);
    const db = getDb(getEnv(c.env));
    if (body.repeat?.kind === "schedule" && !body.due_at && !body.due_on) {
      return errorResponse(
        c,
        "validation_failed",
        "repeat: a schedule needs a due_at to start from.",
      );
    }

    /*
     * #106 — the same check routes/tasks.ts makes on the identical act, and
     * it was missing here.
     *
     * A task PROMOTES a message, so creating one on a message the key's
     * creator cannot see is two things at once: work appearing on a thread
     * they are denied, and — because the task title defaults to the message
     * body — a way to read that body straight back out of the task list.
     *
     * Owners, admins and workspaces with no rules short-circuit without
     * touching messages, exactly as the first-party route does. An unknown
     * message falls through to the RPC's own 422 rather than being reported
     * here, so a key cannot use this to probe which message ids exist.
     */
    const role = c.get("role");
    if (role !== "owner" && role !== "admin") {
      const access = await resolveNumberAccess(db, {
        companyId: c.get("companyId"),
        userId: c.get("userId"),
        role,
      });
      if (access.hiddenNumberIds !== null) {
        // A standalone task is gated by the conversation it links to, if any;
        // one with no conversation has no number to be denied by.
        const sourceRows =
          body.message_id === undefined
            ? (body.conversation_id === undefined
              ? []
              : [{ conversation_id: body.conversation_id }])
            : unwrap<{ conversation_id: string }[]>(
                await db
                  .from("messages")
                  .select("conversation_id")
                  .eq("company_id", c.get("companyId"))
                  .eq("id", body.message_id)
                  .limit(1),
                "public task source lookup",
              );
        if (sourceRows[0]) {
          await requireConversationAccess(db, {
            companyId: c.get("companyId"),
            userId: c.get("userId"),
            role,
            conversationId: sourceRows[0].conversation_id,
            need: "note",
          });
        }
      }
    }

    const { data, error } = await db.rpc("api_create_public_task", {
      p_company_id: c.get("companyId"),
      p_api_key_id: c.get("apiKeyId"),
      p_actor_user_id: c.get("userId"),
      p_task: body,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw new Error(`api_create_public_task failed: ${error.message}`);

    const result = data as { outcome?: string; reason?: string; task?: Record<string, unknown> } | null;
    if (result?.outcome === "no_message") {
      return errorResponse(
        c,
        "validation_failed",
        "message_id: no such message in this workspace.",
      );
    }
    if (result?.outcome === "conflict") {
      return errorResponse(c, "conflict", "This message is already a task.");
    }
    if (result?.outcome === "key_conflict") {
      return errorResponse(c, "conflict", "Idempotency-Key was already used for a task.", {
        key: "apiRefusals.taskCreateKeyUsed",
      });
    }
    if (result?.outcome === "not_member") {
      return errorResponse(
        c,
        "validation_failed",
        "assigned_user_id / assignee_ids: not an active member of this workspace.",
      );
    }
    if (result?.outcome === "too_many") {
      return errorResponse(
        c,
        "validation_failed",
        "assignee_ids: a task holds at most 10 people.",
      );
    }
    if (result?.outcome === "no_conversation") {
      return errorResponse(
        c,
        "validation_failed",
        "conversation_id: no such conversation in this workspace.",
      );
    }
    if (result?.outcome === "no_contact") {
      return errorResponse(
        c,
        "validation_failed",
        "contact_id: no such contact in this workspace.",
      );
    }
    if (result?.outcome === "contact_mismatch") {
      return errorResponse(
        c,
        "validation_failed",
        "contact_id: not the contact of that conversation.",
      );
    }
    if (result?.outcome === "title_required") {
      return errorResponse(c, "validation_failed", "title: required without a message_id.");
    }
    if (result?.outcome === "tag_not_found") {
      return errorResponse(c, "validation_failed", "label: no such tag in this company.", {
        key: "apiRefusals.publicTaskUnknownTag",
      });
    }
    if (result?.outcome === "needs_due") {
      return errorResponse(c, "validation_failed", "repeat: a schedule needs a due date to start from.", {
        key: "apiRefusals.publicTaskRepeatNeedsDueDate",
      });
    }
    if (result?.outcome === "invalid") {
      const field = result.reason;
      return errorResponse(
        c,
        "validation_failed",
        `repeat: ${field ?? "not a valid rule"}.`,
        field
          ? { key: "apiRefusals.publicTaskInvalidRepeatField", vars: { field } }
          : { key: "apiRefusals.publicTaskInvalidRepeat" },
      );
    }
    if (!result?.task) throw new Error("api_create_public_task returned no row");
    const companyId = c.get("companyId");
    if (result.outcome === "created") {
      await afterTaskCreated(c, {
        companyId,
        userId: c.get("userId"),
        task: result.task,
        assigneeIds: requestedAssignees(body) ?? [],
      });
    }
    const [decorated] = await withLabelsAndRepeat(db, companyId, [result.task]);
    return c.json(publicTask(decorated), result.outcome === "replayed" ? 200 : 201);
  },
);

/**
 * #243 — REST hooks, which is how Zapier and Make actually work.
 *
 * A connector creates a subscription when somebody turns a Zap on, and removes
 * it when they turn it off, using the credential the customer pasted in.
 * Without these two routes every such integration either could not be built or
 * required handing over a login.
 *
 * Bounded twice, and both bounds matter:
 *
 * - The address goes through `webhookUrlRejection`, the same SSRF gate the
 *   settings screen uses. A connector is not more trusted than a person.
 * - The endpoint records WHICH KEY made it, and a key may only remove its own.
 *   Scoping to the key's creator instead would let a Zap tear down a webhook
 *   the same person set up by hand in Settings, or one belonging to a
 *   different Zap — invisible until the messages stop arriving.
 */
publicApiRoutes.post(
  `${PUBLIC_API_BASE}/webhooks`,
  requireScope("webhooks:manage"),
  requireCapability("settings.manage"),
  async (c) => {
    const body = await parseJsonBody(c, subscribeSchema);

    /*
     * #581 — the key must be able to READ what it is asking to be sent.
     *
     * `webhooks:manage` alone was a read-everything scope: refused by
     * GET /public/v1/messages, and then handed every message body, both
     * phone numbers and every voicemail transcript by subscribing to them
     * instead.
     *
     * The two gates above do not close this and cannot. `requireCapability`
     * asks about the ROLE OF THE PERSON WHO MINTED THE KEY, so a key
     * narrowed to nothing still passes it — which is the exact failure the
     * two-gate design exists to prevent, and it defeats the invariant this
     * feature's own migration is named for.
     *
     * The refusal NAMES the missing scope. "Forbidden" teaches a connector
     * author nothing, and the next thing they try is a broader key.
     */
    const missing = missingWebhookScopes(
      body.events,
      c.get("apiKeyScopes") ?? [],
    );
    if (missing.length > 0) {
      return errorResponse(
        c,
        "forbidden",
        `This API key cannot subscribe to those events without the ${ 
          missing.join(", ") 
          }${missing.length > 1 ? " scopes." : " scope."}`,
      );
    }

    const rejection = webhookUrlRejection(body.url);
    if (rejection) {
      // The catalogue key would be noise to a machine, so the public surface
      // says the rule in words. The clients get the key; a connector gets a
      // sentence its logs can carry.
      return errorResponse(
        c,
        "validation_failed",
        `That address cannot receive deliveries (${rejection}).`,
      );
    }

    const db = getDb(getEnv(c.env));
    const secret = `whsec_${[...crypto.getRandomValues(new Uint8Array(32))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;

    const { data, error } = await db
      .from("webhook_endpoints")
      .insert({
        company_id: c.get("companyId"),
        url: body.url,
        description: body.description ?? null,
        events: body.events,
        secret,
        created_by: c.get("userId"),
        created_by_api_key_id: c.get("apiKeyId") ?? null,
      })
      .select("id,url,events,active,created_at")
      .limit(1);

    if (error) {
      if (error.message.includes("webhook endpoint cap reached")) {
        return errorResponse(
          c,
          "conflict",
          `A workspace may have at most ${WEBHOOK_ENDPOINT_CAP} webhook endpoints.`,
        );
      }
      throw new Error(`public webhook subscribe failed: ${error.message}`);
    }

    const [row] = (data as unknown as Record<string, unknown>[]);
    return c.json({ ...row, secret_once: secret }, 201);
  },
);

publicApiRoutes.delete(
  `${PUBLIC_API_BASE}/webhooks/:id`,
  requireScope("webhooks:manage"),
  requireCapability("settings.manage"),
  async (c) => {
    const id = pathUuid(c, "id");
    const db = getDb(getEnv(c.env));

    const removed = unwrap<{ id: string }[]>(
      await db
        .from("webhook_endpoints")
        .delete()
        .eq("company_id", c.get("companyId"))
        .eq("id", id)
        // The bound that makes this safe. An endpoint a person created in
        // Settings has a NULL here and can never match, so it is unreachable
        // from the public API by construction rather than by a check somebody
        // could forget.
        .eq("created_by_api_key_id", c.get("apiKeyId") ?? "")
        .select("id"),
      "public webhook unsubscribe",
    );

    if (!removed[0]) {
      return errorResponse(
        c,
        "not_found",
        "No such webhook, or it was not created by this key.",
      );
    }
    return c.body(null, 204);
  },
);
