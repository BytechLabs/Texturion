/**
 * GET /v1/search?q= (SPEC §6 Search, §7, D29) — the global palette over the
 * full entity set, served by the api_search_v2 security-definer SQL function:
 * messages FTS (websearch_to_tsquery over the generated tsvector, notes
 * included — each conversation hit carries the matched message's `direction`
 * so notes are labelable) grouped by conversation with ts_headline snippets;
 * contacts pg_trgm; tasks (title/description trigram, `done` derived from the
 * source message, D17); note-borne attachments (fuzzy file_name — MMS media
 * has no filename, D29 states this on purpose); templates (name/body with a
 * body snippet). All arms company-scoped. Conversations paginate on
 * (matched_at, id) DESC with the standard opaque cursor; every other arm is
 * first-page-only (its limit is 0 on cursor requests).
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

/** First-page size for the non-paginated palette arms (D29). */
const CONTACT_LIMIT = 10;
const PALETTE_ARM_LIMIT = 5;

interface SearchResult {
  conversations: { id: string; matched_at: string }[];
  contacts: unknown[];
  tasks: unknown[];
  attachments: unknown[];
  templates: unknown[];
}

export const searchRoutes = new Hono<AppEnv>();

searchRoutes.get("/search", requireRole("member"), async (c) => {
  const q = parseWith(qSchema, c.req.query("q"));
  const limit = parseLimit(c, 20, 50);
  const cursor = parseCursor(c);

  const db = getDb(getEnv(c.env));
  const result = unwrap<SearchResult>(
    await db.rpc("api_search_v2", {
      p_company_id: c.get("companyId"),
      p_q: q,
      p_conversation_limit: limit + 1,
      // The non-conversation arms have no cursor — they ride along on the
      // first page only.
      p_contact_limit: cursor ? 0 : CONTACT_LIMIT,
      p_task_limit: cursor ? 0 : PALETTE_ARM_LIMIT,
      p_attachment_limit: cursor ? 0 : PALETTE_ARM_LIMIT,
      p_template_limit: cursor ? 0 : PALETTE_ARM_LIMIT,
      p_cursor_ts: cursor?.ts ?? null,
      p_cursor_id: cursor?.id ?? null,
    }),
    "search",
  );

  const page = buildPage(result.conversations, limit, "matched_at");
  return c.json({
    conversations: page.data,
    contacts: result.contacts,
    tasks: result.tasks,
    attachments: result.attachments,
    templates: result.templates,
    next_cursor: page.next_cursor,
  });
});
