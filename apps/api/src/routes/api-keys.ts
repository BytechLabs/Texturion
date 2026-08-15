/**
 * #243 — API key management.
 *
 *   GET    /v1/api-keys        every key, live and switched off. Never a token.
 *   POST   /v1/api-keys        { name, scopes, expires_at? } → 201, and the ONLY
 *                              time the token exists outside the caller's app.
 *   DELETE /v1/api-keys/:id    revoke. A stamp, not a delete.
 *
 * ---------------------------------------------------------------------------
 * THE TOKEN IS NEVER STORED AND NEVER SHOWN TWICE
 *
 * What goes in the database is a SHA-256 of the token and its first twelve
 * characters. Nothing in this file can reconstruct one, and there is no
 * "reveal" route — a credential that can be read back is one that can be read
 * back by whoever gets into an admin session, and the audit log could never
 * tell you whether they had.
 *
 * ---------------------------------------------------------------------------
 * REVOCATION IS A STAMP
 *
 * `DELETE` sets `revoked_at` and `revoked_by`. "When was that key turned off,
 * and by whom" is the first question after an incident, and a deleted row
 * cannot answer it. The resolver treats a stamped row as absent, so the key
 * stops working on the very next request either way.
 */
import {
  API_KEY_CAP,
  API_KEY_DISPLAY_CHARS,
  API_KEY_PREFIX,
  API_KEY_SCOPES,
  API_KEY_SECRET_BYTES,
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

/** Everything a client may see. `token_hash` is deliberately absent. */
const KEY_COLUMNS =
  "id,name,token_prefix,scopes,created_by,created_at,last_used_at," +
  "revoked_at,revoked_by,expires_at";

interface KeyRow {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  expires_at: string | null;
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z
    .array(z.enum(API_KEY_SCOPES))
    .min(1)
    .max(API_KEY_SCOPES.length)
    // A duplicate is a client bug, not twice the permission.
    .transform((scopes) => [...new Set(scopes)]),
  expires_at: z.iso.datetime({ offset: true }).optional(),
});

/**
 * Mint a token, and return it with the two things the database stores.
 *
 * base64url over 32 CSPRNG bytes: URL-safe, header-safe, and no character a
 * customer has to escape when pasting it into somebody else's config file.
 */
async function mintToken(): Promise<{
  token: string;
  prefix: string;
  hash: string;
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(API_KEY_SECRET_BYTES));
  const base64 = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const token = `${API_KEY_PREFIX}${base64}`;

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return { token, prefix: token.slice(0, API_KEY_DISPLAY_CHARS), hash };
}

export const apiKeysRoutes = new Hono<AppEnv>();

apiKeysRoutes.get("/api-keys", requireCapability("settings.manage"), async (c) => {
  const db = getDb(getEnv(c.env));
  const rows = unwrap<KeyRow[]>(
    await db
      .from("api_keys")
      .select(KEY_COLUMNS)
      .eq("company_id", c.get("companyId"))
      .order("created_at", { ascending: false })
      // Revoked keys are listed too, and that is the point: "what did we turn
      // off, and when" is a question somebody asks after an incident, and a
      // list that hides them cannot answer it. Bounded well above the live cap
      // so the history is visible without being unbounded.
      .limit(50),
    "api keys list",
  );
  return c.json({
    keys: rows,
    cap: API_KEY_CAP,
    // Published so the screen can say "you have reached the limit of ten"
    // without holding its own copy of the number.
    live: rows.filter((row) => row.revoked_at === null).length,
  });
});

apiKeysRoutes.post("/api-keys", requireCapability("settings.manage"), async (c) => {
  const body = await parseJsonBody(c, createSchema);
  const db = getDb(getEnv(c.env));
  const companyId = c.get("companyId");
  const minted = await mintToken();

  const { data, error } = await db
    .from("api_keys")
    .insert({
      company_id: companyId,
      name: body.name,
      token_prefix: minted.prefix,
      token_hash: minted.hash,
      scopes: body.scopes,
      created_by: c.get("userId"),
      expires_at: body.expires_at ?? null,
    })
    .select(KEY_COLUMNS)
    .limit(1);

  if (error) {
    // The cap is a database trigger, so this is the only place it can be
    // recognised. A conflict with the number in it, not a 500 — the person can
    // act on it.
    if (error.message.includes("api key cap reached")) {
      return errorResponse(
        c,
        "conflict",
        `A workspace may have at most ${API_KEY_CAP} active API keys.`,
      );
    }
    throw new Error(`api key create failed: ${error.message}`);
  }

  const row = (data as unknown as KeyRow[])[0];
  await recordAuditFromRequest(db, c, {
    companyId,
    action: "api_key.created",
    targetType: "api_key",
    targetId: row?.id ?? null,
    // The SCOPES are the entry's point — "what could that key do" is the
    // question an incident review asks. The token is not in it and could not
    // be: nothing here has it after this response.
    after: { name: body.name, scopes: body.scopes },
  });

  return c.json(
    {
      key: row,
      // Named `token_once` so a caller that stores the response wholesale is
      // at least storing something that says what it is.
      token_once: minted.token,
    },
    201,
  );
});

apiKeysRoutes.delete(
  "/api-keys/:id",
  requireCapability("settings.manage"),
  async (c) => {
    const id = pathUuid(c, "id");
    const db = getDb(getEnv(c.env));
    const companyId = c.get("companyId");

    const updated = unwrap<KeyRow[]>(
      await db
        .from("api_keys")
        .update({ revoked_at: new Date().toISOString(), revoked_by: c.get("userId") })
        .eq("company_id", companyId)
        .eq("id", id)
        // Idempotent: revoking an already-revoked key changes nothing and must
        // not overwrite who did it first. The FIRST revocation is the one the
        // incident review cares about.
        .is("revoked_at", null)
        .select(KEY_COLUMNS)
        .limit(1),
      "api key revoke",
    );

    if (!updated[0]) {
      // Either no such key, or it was already off. Both are "the key is not
      // live", which is what the caller asked for — so this is a 204 rather
      // than a 404 for the second case and a lie for the first. Distinguished
      // by a read, so a wrong id still 404s.
      const existing = unwrap<{ id: string }[]>(
        await db
          .from("api_keys")
          .select("id")
          .eq("company_id", companyId)
          .eq("id", id)
          .limit(1),
        "api key read",
      );
      if (!existing[0]) return errorResponse(c, "not_found", "No such API key.");
      return c.body(null, 204);
    }

    await recordAuditFromRequest(db, c, {
      companyId,
      action: "api_key.revoked",
      targetType: "api_key",
      targetId: id,
      before: { name: updated[0].name, scopes: updated[0].scopes },
    });

    return c.body(null, 204);
  },
);
