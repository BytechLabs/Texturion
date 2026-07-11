/**
 * GET /v1/calls (#129 Calls feature, docs/CALLS-FEATURE.md P3) — the
 * company's call log from the session-grain `calls` read model, newest
 * first, keyset-paginated on (started_at, id).
 *
 * Every row is #106 number-access filtered INSIDE the SQL (the deny list
 * runs before the keyset window, so cursors never strand restricted
 * members): a member whose access excludes number N sees no calls to N —
 * anywhere. Owners/admins short-circuit with hiddenNumberIds = null. Rows
 * whose number was released (NULL phone_number_id) stay visible, matching
 * the conversations semantics.
 *
 * `?outcome=missed|answered|voicemail` narrows the list (the surface's one
 * filter — "who called and do I need to act?").
 */
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import { resolveNumberAccess } from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { buildPage } from "../http/pagination";
import { parseCursor, parseLimit, parseWith, unwrap } from "./core/http";

const listQuerySchema = z.object({
  outcome: z.enum(["answered", "voicemail", "missed"]).optional(),
});

/** One row of GET /v1/calls (mirrored by the web `Call` type). */
export interface CallRow {
  id: string;
  caller_e164: string | null;
  contact_id: string | null;
  contact_name: string | null;
  phone_number_id: string | null;
  conversation_id: string | null;
  outcome: "answered" | "voicemail" | "missed" | null;
  forward_seconds: number;
  started_at: string;
}

export const callsRoutes = new Hono<AppEnv>();

callsRoutes.get("/calls", requireRole("member"), async (c) => {
  const query = parseWith(listQuerySchema, {
    outcome: c.req.query("outcome"),
  });
  const limit = parseLimit(c, 25, 100);
  const cursor = parseCursor(c);

  const db = getDb(getEnv(c.env));
  const access = await resolveNumberAccess(db, {
    companyId: c.get("companyId"),
    userId: c.get("userId"),
    role: c.get("role"),
  });
  const rows = unwrap<CallRow[]>(
    await db.rpc("api_list_calls", {
      p_company_id: c.get("companyId"),
      p_limit: limit + 1,
      p_outcome: query.outcome ?? null,
      p_cursor_ts: cursor?.ts ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_hidden_number_ids: access.hiddenNumberIds,
    }),
    "calls list",
  );
  return c.json(buildPage(rows, limit, "started_at"));
});
