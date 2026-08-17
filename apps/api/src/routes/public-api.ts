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
 *   POST /public/v1/tasks      { message_id, title?, due_at?, description? }
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
  PUBLIC_API_BASE,
  missingWebhookScopes,
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
import { sendTextToConversation } from "../messaging/send-text";
import { parseJsonBody, pathUuid, unwrap } from "./core/http";

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
  "id,message_id,conversation_id,title,description,due_at,assigned_user_id,created_at";

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
  conversation_id: z.uuid(),
  // Text only in v1. Media means an upload, a signed URL and a size budget,
  // and every one of those is a shape we would be promising forever — the
  // honest way to add it is to add it, once somebody has asked.
  body: z.string().trim().min(1).max(1600),
});

const subscribeSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).transform((e) => [...new Set(e)]),
  description: z.string().trim().max(200).optional(),
});

const createTaskSchema = z.object({
  message_id: z.uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  due_at: z.iso.datetime({ offset: true }).optional(),
});

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
    const rows = unwrap<unknown[]>(
      await db
        .from("contacts")
        .select(PUBLIC_CONTACT_COLUMNS)
        .eq("company_id", c.get("companyId"))
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit),
      "public contacts list",
    );
    return c.json({ data: rows, limit });
  },
);

publicApiRoutes.post(
  `${PUBLIC_API_BASE}/contacts`,
  requireScope("contacts:write"),
  requireCapability("conversations.note"),
  async (c) => {
    const body = await parseJsonBody(c, createContactSchema);
    const db = getDb(getEnv(c.env));
    const companyId = c.get("companyId");

    // Upsert on the same conflict target the first-party route uses, so an
    // integration re-sending a customer it already sent does not create a
    // second record. A connector replaying its own queue is the normal case,
    // not the exception.
    const rows = unwrap<Record<string, unknown>[]>(
      await db
        .from("contacts")
        .upsert(
          {
            company_id: companyId,
            phone_e164: body.phone_e164,
            deleted_at: null,
            created_by_user_id: c.get("userId"),
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.email !== undefined ? { email: body.email } : {}),
            ...(body.notes !== undefined ? { notes: body.notes } : {}),
          },
          { onConflict: "company_id,phone_e164" },
        )
        .select(PUBLIC_CONTACT_COLUMNS),
      "public contact upsert",
    );
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

    const rows = unwrap<Record<string, unknown>[]>(
      await db.rpc("api_list_conversations", {
        p_company_id: c.get("companyId"),
        p_user_id: c.get("userId"),
        p_limit: limit,
        p_status: c.req.query("status") ?? null,
        p_assigned_user_id: null,
        p_tag_id: null,
        p_is_spam: false,
        p_unread: false,
        p_q: null,
        p_cursor_ts: null,
        p_cursor_id: null,
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
    return c.json({
      data: rows.map((row) => ({
        id: row.id,
        contact_id: row.contact_id,
        status: row.status,
        last_message_at: row.last_message_at,
        assigned_user_id: row.assigned_user_id,
      })),
      limit,
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

    const rows = unwrap<unknown[]>(
      await db
        .from("messages")
        .select("id,conversation_id,direction,body,status,created_at")
        .eq("company_id", c.get("companyId"))
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(limit),
      "public messages list",
    );
    return c.json({ data: rows, limit });
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

    // The SAME sequence the thread send runs, from the same function: number
    // level, the pre-send gates, merge fields, then the atomic
    // opt-out/rate/cap insert, then dispatch. There is no second copy of that
    // order, which is the whole reason it was extracted.
    const { message, existing } = await sendTextToConversation(
      env,
      getDb(env),
      {
        companyId: c.get("companyId"),
        conversationId: body.conversation_id,
        userId: c.get("userId"),
        role: c.get("role"),
        body: body.body,
        idempotencyKey,
      },
    );

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
    const rows = unwrap<unknown[]>(
      await db
        .from("tasks")
        .select(PUBLIC_TASK_COLUMNS)
        .eq("company_id", c.get("companyId"))
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit),
      "public tasks list",
    );
    return c.json({ data: rows, limit });
  },
);

publicApiRoutes.post(
  `${PUBLIC_API_BASE}/tasks`,
  requireScope("tasks:write"),
  requireCapability("conversations.note"),
  async (c) => {
    const body = await parseJsonBody(c, createTaskSchema);
    const db = getDb(getEnv(c.env));

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
        const sourceRows = unwrap<{ conversation_id: string }[]>(
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

    // The same security-definer RPC the first-party route uses, so the
    // partial-unique conflict arbiter, the audit row and the broadcast trigger
    // all behave identically. A public path that wrote the table directly
    // would be a second way to create a task, and the second way is the one
    // that forgets the audit.
    const { data, error } = await db.rpc("create_task", {
      p_company_id: c.get("companyId"),
      p_message_id: body.message_id,
      p_title: body.title ?? null,
      p_description: body.description ?? null,
      p_assigned_user_id: null,
      p_due_at: body.due_at ?? null,
      p_actor_user_id: c.get("userId"),
      // #214's address arguments, all null. Named explicitly rather than
      // omitted because the RPC's signature is positional-by-name over
      // PostgREST: a missing argument resolves to a DIFFERENT overload, which
      // is the failure mode recorded on `purge_workspace_step`.
      p_addr_street: null,
      p_addr_unit: null,
      p_addr_city: null,
      p_addr_state: null,
      p_addr_postal_code: null,
      p_addr_country: null,
      p_addr_provenance: null,
    });
    if (error) throw new Error(`public create_task failed: ${error.message}`);

    const result = data as { outcome?: string; task?: Record<string, unknown> } | null;
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
    if (!result?.task) throw new Error("create_task returned no row");
    return c.json(result.task, 201);
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
        "This API key cannot subscribe to those events without the " +
          missing.join(", ") +
          (missing.length > 1 ? " scopes." : " scope."),
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

    const row = (data as unknown as Record<string, unknown>[])[0];
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
