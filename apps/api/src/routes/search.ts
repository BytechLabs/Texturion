/**
 * GET /v1/search?q= (SPEC §6 Search, §7) — messages FTS
 * (websearch_to_tsquery over the generated tsvector) grouped by conversation
 * with ts_headline snippets, plus contacts pg_trgm matching; company-scoped,
 * served by the api_search security-definer SQL function. Conversations
 * paginate on (matched_at, id) DESC with the standard opaque cursor; the
 * contacts arm accompanies the first page only.
 */
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { buildPage } from "../http/pagination";
import { parseCursor, parseLimit, parseWith, unwrap } from "./core/http";

const qSchema = z.string().trim().min(1).max(200);

interface SearchResult {
  conversations: { id: string; matched_at: string }[];
  contacts: unknown[];
}

export const searchRoutes = new Hono<AppEnv>();

searchRoutes.get("/search", requireRole("member"), async (c) => {
  const q = parseWith(qSchema, c.req.query("q"));
  const limit = parseLimit(c, 20, 50);
  const cursor = parseCursor(c);

  const db = getDb(getEnv(c.env));
  const result = unwrap<SearchResult>(
    await db.rpc("api_search", {
      p_company_id: c.get("companyId"),
      p_q: q,
      p_conversation_limit: limit + 1,
      // Contacts have no cursor — they ride along on the first page only.
      p_contact_limit: cursor ? 0 : 10,
      p_cursor_ts: cursor?.ts ?? null,
      p_cursor_id: cursor?.id ?? null,
    }),
    "search",
  );

  const page = buildPage(result.conversations, limit, "matched_at");
  return c.json({
    conversations: page.data,
    contacts: result.contacts,
    next_cursor: page.next_cursor,
  });
});
