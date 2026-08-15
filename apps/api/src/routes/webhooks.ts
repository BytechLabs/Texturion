/**
 * #243 — outbound webhook management.
 *
 *   GET    /v1/webhooks                  every endpoint, never the secret.
 *   POST   /v1/webhooks                  { url, events, description? } → 201,
 *                                        and the ONLY time the secret is shown.
 *   PATCH  /v1/webhooks/:id              { url?, events?, description?, active? }
 *   DELETE /v1/webhooks/:id
 *   POST   /v1/webhooks/:id/secret       rotate; shown once, same as creation.
 *   POST   /v1/webhooks/:id/test         a signed ping, sent now, answer relayed.
 *   GET    /v1/webhooks/:id/deliveries   the log, newest first.
 *
 * ---------------------------------------------------------------------------
 * THE SECRET LEAVES THE BUILDING ONCE
 *
 * Nothing here ever selects `secret` into a response. It is returned by the
 * two endpoints that MINT one and nowhere else, which is why both of those
 * responses say so in a field the clients render rather than leaving it to a
 * screen somebody might not read.
 *
 * The alternative — a "reveal secret" endpoint — is the thing that makes an
 * audit log unable to answer "did anybody read this". A rotation is recorded;
 * a read that cannot happen needs no record.
 *
 * ---------------------------------------------------------------------------
 * WHO MAY DO WHAT
 *
 * `settings.manage` on every route, including the read. An endpoint list is
 * not neutral information: it names the third parties this workspace's message
 * content flows to, and the URLs frequently carry a per-tenant token in the
 * path. A read_only member has no reason to see it and every reason not to.
 */
import {
  WEBHOOK_ENDPOINT_CAP,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_PING_EVENT,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMEOUT_MS,
  webhookSignatureHeader,
  webhookSignaturePayload,
  webhookUrlRejection,
  webhookUrlRejectionKey,
} from "@loonext/shared";
import { Hono } from "hono";
import { z } from "zod";

import { recordAuditFromRequest } from "../audit/log";
import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { parseJsonBody, pathUuid, unwrap } from "./core/http";

/** Everything a client may see. `secret` is deliberately absent. */
const ENDPOINT_COLUMNS =
  "id,url,description,events,active,disabled_reason,disabled_at," +
  "consecutive_failures,last_success_at,last_failure_at,created_by,created_at";

const DELIVERY_COLUMNS =
  "id,event_type,status,attempts,response_status,last_error,created_at," +
  "delivered_at,next_attempt_at";

interface EndpointRow {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  disabled_reason: string | null;
  disabled_at: string | null;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_by: string | null;
  created_at: string;
}

const eventsSchema = z
  .array(z.enum(WEBHOOK_EVENT_TYPES))
  .min(1)
  .max(WEBHOOK_EVENT_TYPES.length)
  // A duplicate in the list is a client bug, not a subscription to twice as
  // much, and storing it would make the endpoint fire twice per event.
  .transform((events) => [...new Set(events)]);

const urlSchema = z.string().trim().min(1).max(2000);

const createSchema = z.object({
  url: urlSchema,
  events: eventsSchema,
  description: z.string().trim().max(200).optional(),
});

const patchSchema = z
  .object({
    url: urlSchema.optional(),
    events: eventsSchema.optional(),
    description: z.string().trim().max(200).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.url !== undefined ||
      body.events !== undefined ||
      body.description !== undefined ||
      body.active !== undefined,
    { message: "Provide at least one field to update." },
  );

/**
 * A signing secret.
 *
 * 32 bytes from the platform CSPRNG, hex, behind a prefix. The prefix is not
 * decoration: it is what makes a leaked secret findable by a scanner, in the
 * repo and in the customer's own, and `whsec_` is the convention receivers'
 * tooling already recognises.
 */
function mintSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `whsec_${hex}`;
}

/** The SSRF gate, as a route answer. */
function rejectUrl(c: Parameters<typeof errorResponse>[0], url: string) {
  const rejection = webhookUrlRejection(url);
  if (!rejection) return null;
  // The catalogue key travels in the message so the three clients can say
  // WHICH rule bit in the reader's own language. "Invalid URL" is not
  // actionable; "that address is inside a private network" is.
  return errorResponse(c, "validation_failed", webhookUrlRejectionKey(rejection));
}

export const webhooksRoutes = new Hono<AppEnv>();

webhooksRoutes.get("/webhooks", requireCapability("settings.manage"), async (c) => {
  const db = getDb(getEnv(c.env));
  const rows = unwrap<EndpointRow[]>(
    await db
      .from("webhook_endpoints")
      .select(ENDPOINT_COLUMNS)
      .eq("company_id", c.get("companyId"))
      .order("created_at", { ascending: true })
      .limit(WEBHOOK_ENDPOINT_CAP),
    "webhook endpoints list",
  );
  return c.json({ endpoints: rows, cap: WEBHOOK_ENDPOINT_CAP });
});

webhooksRoutes.post("/webhooks", requireCapability("settings.manage"), async (c) => {
  const body = await parseJsonBody(c, createSchema);
  const rejected = rejectUrl(c, body.url);
  if (rejected) return rejected;

  const db = getDb(getEnv(c.env));
  const companyId = c.get("companyId");
  const secret = mintSecret();

  const { data, error } = await db
    .from("webhook_endpoints")
    .insert({
      company_id: companyId,
      url: body.url,
      description: body.description ?? null,
      events: body.events,
      secret,
      created_by: c.get("userId"),
    })
    .select(ENDPOINT_COLUMNS)
    .limit(1);

  if (error) {
    // The cap is a database trigger, so this is the only place it can be
    // recognised. Reported as a conflict with the number in it rather than a
    // 500, because the person can act on it — they have ten and want an
    // eleventh.
    if (error.message.includes("webhook endpoint cap reached")) {
      return errorResponse(
        c,
        "conflict",
        `A workspace may have at most ${WEBHOOK_ENDPOINT_CAP} webhook endpoints.`,
      );
    }
    throw new Error(`webhook endpoint create failed: ${error.message}`);
  }

  const row = (data as unknown as EndpointRow[])[0];
  await recordAuditFromRequest(db, c, {
    companyId,
    action: "webhook.endpoint_created",
    targetType: "webhook_endpoint",
    targetId: row?.id ?? null,
    // The URL is the whole point of the entry: "where did our messages start
    // going" is the question this exists to answer. The secret is not in it.
    after: { url: body.url, events: body.events },
  });

  return c.json(
    {
      endpoint: row,
      // Named `secret_once` rather than `secret` so a client that stores the
      // response wholesale is at least storing something that says what it is.
      secret_once: secret,
    },
    201,
  );
});

webhooksRoutes.patch("/webhooks/:id", requireCapability("settings.manage"), async (c) => {
  const id = pathUuid(c, "id");
  const body = await parseJsonBody(c, patchSchema);
  if (body.url !== undefined) {
    const rejected = rejectUrl(c, body.url);
    if (rejected) return rejected;
  }

  const db = getDb(getEnv(c.env));
  const companyId = c.get("companyId");

  const existing = unwrap<EndpointRow[]>(
    await db
      .from("webhook_endpoints")
      .select(ENDPOINT_COLUMNS)
      .eq("company_id", companyId)
      .eq("id", id)
      .limit(1),
    "webhook endpoint read",
  );
  const before = existing[0];
  if (!before) return errorResponse(c, "not_found", "No such webhook endpoint.");

  const patch: Record<string, unknown> = {};
  if (body.url !== undefined) patch.url = body.url;
  if (body.events !== undefined) patch.events = body.events;
  if (body.description !== undefined) patch.description = body.description;
  if (body.active !== undefined) {
    patch.active = body.active;
    if (body.active) {
      // Re-enabling clears BOTH the streak and the reason. Leaving the counter
      // where it was would let one more failure re-disable an endpoint the
      // customer just fixed, which reads as the toggle not working.
      patch.consecutive_failures = 0;
      patch.disabled_reason = null;
      patch.disabled_at = null;
    }
  }

  const updated = unwrap<EndpointRow[]>(
    await db
      .from("webhook_endpoints")
      .update(patch)
      .eq("company_id", companyId)
      .eq("id", id)
      .select(ENDPOINT_COLUMNS)
      .limit(1),
    "webhook endpoint update",
  );

  await recordAuditFromRequest(db, c, {
    companyId,
    action: "webhook.endpoint_updated",
    targetType: "webhook_endpoint",
    targetId: id,
    before: { url: before.url, events: before.events, active: before.active },
    after: {
      url: updated[0]?.url,
      events: updated[0]?.events,
      active: updated[0]?.active,
    },
  });

  return c.json({ endpoint: updated[0] });
});

webhooksRoutes.delete("/webhooks/:id", requireCapability("settings.manage"), async (c) => {
  const id = pathUuid(c, "id");
  const db = getDb(getEnv(c.env));
  const companyId = c.get("companyId");

  const existing = unwrap<EndpointRow[]>(
    await db
      .from("webhook_endpoints")
      .select(ENDPOINT_COLUMNS)
      .eq("company_id", companyId)
      .eq("id", id)
      .limit(1),
    "webhook endpoint read",
  );
  const before = existing[0];
  if (!before) return errorResponse(c, "not_found", "No such webhook endpoint.");

  unwrap<unknown[]>(
    await db
      .from("webhook_endpoints")
      .delete()
      .eq("company_id", companyId)
      .eq("id", id)
      .select("id"),
    "webhook endpoint delete",
  );

  await recordAuditFromRequest(db, c, {
    companyId,
    action: "webhook.endpoint_deleted",
    targetType: "webhook_endpoint",
    targetId: id,
    before: { url: before.url, events: before.events },
  });

  return c.body(null, 204);
});

webhooksRoutes.post(
  "/webhooks/:id/secret",
  requireCapability("settings.manage"),
  async (c) => {
    const id = pathUuid(c, "id");
    const db = getDb(getEnv(c.env));
    const companyId = c.get("companyId");
    const secret = mintSecret();

    const updated = unwrap<EndpointRow[]>(
      await db
        .from("webhook_endpoints")
        .update({ secret })
        .eq("company_id", companyId)
        .eq("id", id)
        .select(ENDPOINT_COLUMNS)
        .limit(1),
      "webhook secret rotate",
    );
    if (!updated[0]) return errorResponse(c, "not_found", "No such webhook endpoint.");

    await recordAuditFromRequest(db, c, {
      companyId,
      action: "webhook.secret_rotated",
      targetType: "webhook_endpoint",
      targetId: id,
      after: { url: updated[0].url },
    });

    return c.json({ endpoint: updated[0], secret_once: secret });
  },
);

webhooksRoutes.post("/webhooks/:id/test", requireCapability("settings.manage"), async (c) => {
  const id = pathUuid(c, "id");
  const db = getDb(getEnv(c.env));
  const companyId = c.get("companyId");

  // The secret is selected HERE and nowhere else in this file, because signing
  // is the one thing that cannot be done without it. It never enters a
  // response.
  const rows = unwrap<{ id: string; url: string; secret: string }[]>(
    await db
      .from("webhook_endpoints")
      .select("id,url,secret")
      .eq("company_id", companyId)
      .eq("id", id)
      .limit(1),
    "webhook endpoint read",
  );
  const endpoint = rows[0];
  if (!endpoint) return errorResponse(c, "not_found", "No such webhook endpoint.");

  // Re-checked at send time, not trusted from creation. An endpoint stored
  // before a rule tightened is exactly the one worth refusing.
  const rejected = rejectUrl(c, endpoint.url);
  if (rejected) return rejected;

  const body = JSON.stringify({
    id: crypto.randomUUID(),
    type: WEBHOOK_PING_EVENT,
    created_at: new Date().toISOString(),
    company_id: companyId,
    data: {},
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(endpoint.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(webhookSignaturePayload(timestamp, body)),
  );
  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [WEBHOOK_SIGNATURE_HEADER]: webhookSignatureHeader(timestamp, hex),
        "loonext-event": WEBHOOK_PING_EVENT,
        "user-agent": "Loonext-Webhooks/1",
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      redirect: "manual",
    });
    return c.json({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
    });
  } catch (cause) {
    // A test that fails is a successful test — the person learns their endpoint
    // is unreachable, which is the whole reason they pressed the button. So
    // this is a 200 with `ok: false`, not a 502: the REQUEST worked.
    const name = cause instanceof Error ? cause.name : "Error";
    return c.json({
      ok: false,
      status: null,
      reason: name === "TimeoutError" ? "timeout" : "unreachable",
    });
  }
});

webhooksRoutes.get(
  "/webhooks/:id/deliveries",
  requireCapability("settings.manage"),
  async (c) => {
    const id = pathUuid(c, "id");
    const db = getDb(getEnv(c.env));

    const rows = unwrap<unknown[]>(
      await db
        .from("webhook_deliveries")
        .select(DELIVERY_COLUMNS)
        .eq("company_id", c.get("companyId"))
        .eq("endpoint_id", id)
        .order("created_at", { ascending: false })
        // A debugging surface, not a feed. Fifty is enough to see the shape of
        // a failure and short enough that the query stays cheap.
        .limit(50),
      "webhook deliveries list",
    );
    return c.json({ deliveries: rows });
  },
);
