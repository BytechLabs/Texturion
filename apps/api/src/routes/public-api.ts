/**
 * #243 — the public REST surface.
 *
 *   GET  /public/v1/me         what this key is, and what it may do.
 *   GET  /public/v1/contacts   the customer list, newest first.
 *   POST /public/v1/contacts   { phone_e164, name?, email?, notes? }
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
import { PUBLIC_API_BASE } from "@loonext/shared";
import { Hono } from "hono";
import { z } from "zod";

import { apiKeyAuth, requireScope } from "../auth/api-key";
import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { parseJsonBody, unwrap } from "./core/http";

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
