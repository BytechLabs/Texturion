/**
 * #227 — requesting and collecting a workspace's data export.
 *
 * ADMIN ONLY. An export is a copy of every message, contact and note the
 * business holds; it is not a thing any member should be able to take.
 *
 * POST enqueues and returns immediately. The building happens on the cron
 * (workspace/export.ts) because a busy workspace would blow the Worker's
 * limits inside a request, and the customers most likely to want an export are
 * exactly the ones with the most data.
 *
 * GET lists recent exports with a freshly-minted signed URL per file. The URLs
 * are minted at read time and short-lived rather than stored, so a link in an
 * old email cannot outlive the export it points at.
 */
import { Hono } from "hono";

import { recordAuditFromRequest } from "../audit/log";
import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { EXPORTS_BUCKET } from "../workspace/export";
import { unwrap } from "./core/http";

export const exportsRoutes = new Hono<AppEnv>();

/** Long enough to download a big file, short enough that a leaked link dies. */
const DOWNLOAD_TTL_SECONDS = 60 * 60;
/** Recent exports worth showing. Older ones have expired anyway. */
const LIST_LIMIT = 5;

interface ExportRow {
  id: string;
  status: "pending" | "running" | "ready" | "failed";
  storage_prefix: string | null;
  row_counts: Record<string, number>;
  error: string | null;
  requested_at: string;
  completed_at: string | null;
  expires_at: string | null;
}

exportsRoutes.post("/exports", requireRole("admin"), async (c) => {
  const companyId = c.get("companyId");
  const db = getDb(getEnv(c.env));

  const { data, error } = await db.rpc("request_data_export", {
    p_company_id: companyId,
    p_user_id: c.get("userId"),
  });
  if (error) throw new Error(`request_data_export failed: ${error.message}`);
  const result = data as { outcome: "queued" | "in_flight"; export_id: string };

  if (result.outcome === "in_flight") {
    // Cost protection: an export reads every row and writes a copy of it. The
    // second click is told about the first rather than quietly making another.
    return c.json({ export_id: result.export_id, already_building: true });
  }

  // #231: taking a copy of everything the business holds is exactly the kind
  // of privileged act the log exists for — and the departing-employee
  // signature the audit issue calls out by name.
  await recordAuditFromRequest(db, c, {
    companyId,
    action: "contacts.exported",
    targetType: "data_export",
    targetId: result.export_id,
    after: { scope: "workspace" },
  });

  return c.json({ export_id: result.export_id, already_building: false }, 202);
});

exportsRoutes.get("/exports", requireRole("admin"), async (c) => {
  const companyId = c.get("companyId");
  const db = getDb(getEnv(c.env));

  const rows = unwrap<ExportRow[]>(
    await db
      .from("data_exports")
      .select(
        "id,status,storage_prefix,row_counts,error,requested_at,completed_at,expires_at",
      )
      .eq("company_id", companyId)
      .order("requested_at", { ascending: false })
      .limit(LIST_LIMIT),
    "data export list",
  );

  const data = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      status: row.status,
      row_counts: row.row_counts ?? {},
      error: row.error,
      requested_at: row.requested_at,
      completed_at: row.completed_at,
      expires_at: row.expires_at,
      files: await signFiles(db, row),
    })),
  );
  return c.json({ data, next_cursor: null });
});

/**
 * One signed URL per file, minted now rather than stored. An expired export
 * lists nothing: the objects are gone, and offering links to them would be a
 * download that fails instead of an explanation.
 */
async function signFiles(
  db: ReturnType<typeof getDb>,
  row: ExportRow,
): Promise<{ name: string; url: string }[]> {
  if (row.status !== "ready" || !row.storage_prefix) return [];
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return [];
  }

  const { data, error } = await db.storage
    .from(EXPORTS_BUCKET)
    .list(row.storage_prefix, { limit: 200 });
  if (error) throw new Error(`export file list failed: ${error.message}`);

  const files = (data ?? []).filter((entry) => entry.name.includes("."));
  const signed = await Promise.all(
    files.map(async (entry) => {
      const path = `${row.storage_prefix}/${entry.name}`;
      const { data: url, error: signError } = await db.storage
        .from(EXPORTS_BUCKET)
        .createSignedUrl(path, DOWNLOAD_TTL_SECONDS);
      if (signError || !url?.signedUrl) return null;
      return { name: entry.name, url: url.signedUrl };
    }),
  );
  return signed.filter((entry): entry is { name: string; url: string } => entry !== null);
}

exportsRoutes.get("/exports/:id", requireRole("admin"), async (c) => {
  const db = getDb(getEnv(c.env));
  const rows = unwrap<ExportRow[]>(
    await db
      .from("data_exports")
      .select(
        "id,status,storage_prefix,row_counts,error,requested_at,completed_at,expires_at",
      )
      .eq("company_id", c.get("companyId"))
      .eq("id", c.req.param("id"))
      .limit(1),
    "data export lookup",
  );
  const row = rows[0];
  if (!row) return errorResponse(c, "not_found", "No such export.");
  return c.json({
    id: row.id,
    status: row.status,
    row_counts: row.row_counts ?? {},
    error: row.error,
    requested_at: row.requested_at,
    completed_at: row.completed_at,
    expires_at: row.expires_at,
    files: await signFiles(db, row),
  });
});
