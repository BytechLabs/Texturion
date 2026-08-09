/**
 * #231 — GET /v1/audit-log: the owner-visible history of privileged changes.
 *
 * Owner/admin only. A log every member can read is a map of the workspace's
 * security posture, and the questions it answers ("who removed that contact",
 * "who granted the new guy access to the main number") are the owner's.
 *
 * Two shapes off one SQL function, deliberately: JSON pages for the screen and
 * the mobile list, and `?format=csv` for the export an owner hands to an
 * insurer or a security questionnaire. Both read through
 * `api_list_audit_log`, so a filter can never exist on one and not the other —
 * that is how a log stops being trustworthy.
 *
 * The table itself is append-only at the database level (update and delete
 * raise for every role, including this one), so nothing here can rewrite what
 * it reads.
 */
import { Hono } from "hono";
import { z } from "zod";

import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { csvResponse, csvSafeText } from "./core/csv";
import { parseWith } from "./core/http";

export const auditLogRoutes = new Hono<AppEnv>();

/** A page a person reads; the export takes the whole window in one pass. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/**
 * Export ceiling. Above this the CSV stops being something a browser downloads
 * and starts being a job; the date filters are how an owner takes a bigger
 * window, a month at a time.
 */
const MAX_EXPORT_ROWS = 10_000;

const querySchema = z.object({
  actor: z.uuid().optional(),
  action: z.string().trim().min(1).max(100).optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  until: z.iso.datetime({ offset: true }).optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  format: z.enum(["json", "csv"]).optional(),
});

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_ip: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  occurred_at: string;
}

/** `<occurred_at>|<id>` — the keyset the SQL orders on. */
function encodeCursor(row: AuditRow): string {
  return `${row.occurred_at}|${row.id}`;
}

function decodeCursor(raw: string | undefined): {
  ts: string | null;
  id: string | null;
} {
  if (!raw) return { ts: null, id: null };
  const split = raw.lastIndexOf("|");
  if (split <= 0) return { ts: null, id: null };
  return { ts: raw.slice(0, split), id: raw.slice(split + 1) };
}

/**
 * #580: one cell's TEXT, guarded so a spreadsheet reads it instead of running it.
 *
 * This used to be a local `csvCell` that applied RFC-4180 quoting and nothing
 * else, which left the only export in the repo that never called `csvSafeText`.
 * The quoting was not neutral about it either — it PRESERVED the commas between
 * a formula's arguments, so `=IMPORTDATA("https://…")` in the actor column
 * survived the trip intact and fires in Google Sheets with no prompt.
 *
 * Guarded on every column rather than a chosen few. Three are already reachable:
 * `actor` is `profiles.display_name`, which any member sets on themselves
 * through `PATCH /v1/me` over any charset; `target_id` is `input.phoneE164` for
 * the opt-out actions, so it leads with `+`; and `actor_ip` falls back to
 * `X-Forwarded-For`, a header nobody validated. Choosing columns means deciding
 * again for every column added later, and the docblock above describes who reads
 * this file.
 *
 * Free of charge for everything else: `csvSafeText` only acts on a value LEADING
 * with `=+-@` or whitespace, so the timestamps, the action vocabulary and the
 * JSON blobs come through byte-for-byte. RFC-4180 quoting is `serializeCsv`'s
 * layer below, not this one — separated precisely because one function doing
 * both is how the guarding half went missing.
 */
function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return csvSafeText(text);
}

auditLogRoutes.get("/audit-log", requireCapability("history.read"), async (c) => {
  const query = parseWith(querySchema, c.req.query());
  const db = getDb(getEnv(c.env));
  const csv = query.format === "csv";
  const limit = csv ? MAX_EXPORT_ROWS : (query.limit ?? DEFAULT_LIMIT);
  const cursor = decodeCursor(query.cursor);

  const { data, error } = await db.rpc("api_list_audit_log", {
    p_company_id: c.get("companyId"),
    // One extra row is the "is there more" sentinel, never returned.
    p_limit: csv ? limit : limit + 1,
    p_actor: query.actor ?? null,
    p_action: query.action ?? null,
    p_since: query.since ?? null,
    p_until: query.until ?? null,
    p_cursor_ts: cursor.ts,
    p_cursor_id: cursor.id,
  });
  if (error) {
    throw new Error(`api_list_audit_log failed: ${error.message}`);
  }
  const rows = (data ?? []) as AuditRow[];

  if (csv) {
    const header = [
      "occurred_at",
      "actor",
      "actor_ip",
      "action",
      "target_type",
      "target_id",
      "before",
      "after",
    ];
    // The header rides through the same serializer as the body: the column names
    // are our own literals, and a second join here is a second CSV writer.
    const table = [
      header,
      ...rows.map((row) =>
        [
          row.occurred_at,
          row.actor_name ?? row.actor_user_id ?? "system",
          row.actor_ip,
          row.action,
          row.target_type,
          row.target_id,
          row.before,
          row.after,
        ].map(csvCell),
      ),
    ];
    // #587: through `csvResponse` for the byte-order mark. Without it Excel on
    // Windows opens this in the system codepage, so an actor named `Zoë
    // Fournier` arrives mangled — in the one file an owner hands to an insurer
    // or attaches to a security questionnaire.
    return csvResponse(table, "audit-log.csv");
  }

  const page = rows.slice(0, limit);
  return c.json({
    data: page,
    next_cursor:
      rows.length > limit && page.length > 0
        ? encodeCursor(page[page.length - 1])
        : null,
  });
});
