import { z } from "zod";
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
import {
  roleHasCapability,
  type Capability,
  type MemberRole,
} from "@loonext/shared";
import { Hono } from "hono";

import { alarmOnBulkContactAccess } from "../audit/bulk-contact-alarm";
import { recordAuditFromRequest } from "../audit/log";
import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { dispositionOptions } from "../storage/disposition";
import { EXPORTS_BUCKET } from "../workspace/export";
import { ApiError } from "../http/errors";
import { parseJsonBody } from "./core/http";
import { unwrap } from "./core/http";

export const exportsRoutes = new Hono<AppEnv>();

/** Long enough to download a big file, short enough that a leaked link dies. */
const DOWNLOAD_TTL_SECONDS = 60 * 60;
/** Recent exports worth showing. Older ones have expired anyway. */
const LIST_LIMIT = 5;

interface ExportRow {
  id: string;
  kind: string;
  status: "pending" | "running" | "ready" | "failed";
  storage_prefix: string | null;
  row_counts: Record<string, number>;
  error: string | null;
  requested_at: string;
  completed_at: string | null;
  expires_at: string | null;
}

/** Every column the list and detail routes read. Named once so they cannot diverge. */
const EXPORT_COLUMNS =
  "id,kind,status,storage_prefix,row_counts,error,requested_at,completed_at,expires_at";

/**
 * Who may COLLECT an export, decided per export.
 *
 * #581/C13: the two GET routes were gated on `contacts.bulk` alone, and one of the
 * POSTs is not. The usage summary is deliberately behind `billing.manage` — it counts
 * messages, minutes and money and names nobody — and `bookkeeper` was given exactly
 * that pairing so somebody's accountant can see the bill without being able to read a
 * customer's texts. So a bookkeeper could START the export built for them and then had
 * no way to list it or download it. The file was written, charged for, and unreachable
 * by the only role that asked for it.
 *
 * The fix is per-row rather than a looser gate on the route, because the other kinds
 * really are customer data: a workspace export is a copy of every message and contact,
 * conversation history quotes what people wrote, and every task hangs off a
 * conversation (D17) so a task list names customers too. Handing a bookkeeper the list
 * route would hand them all of that.
 *
 * Fails CLOSED on a kind it does not recognise. A new export kind is then invisible
 * until somebody decides who may collect it, which is the safe direction: the
 * alternative is a new kind of customer data readable by whoever the default favoured.
 */
const EXPORT_KIND_CAPABILITY: Record<string, Capability> = {
  // Counts of messages, minutes and money. Names nobody.
  usage_summary: "billing.manage",
  // All three are customer data: a workspace export is a copy of every message and
  // contact, conversation history quotes what people wrote, and every task hangs off a
  // conversation (D17) so a task list names customers and what they asked for.
  workspace: "contacts.bulk",
  conversation_history: "contacts.bulk",
  tasks: "contacts.bulk",
};

/**
 * The kinds this caller may collect — turned into the QUERY rather than applied to its
 * result.
 *
 * Asking the database for only the collectable kinds is what makes this structural: a
 * row the caller may not have cannot arrive in the first place, so no later addition to
 * the response shape can leak one by accident. It also makes `LIST_LIMIT` mean what it
 * says — a bookkeeper sees their five most recent usage summaries, rather than an empty
 * page because the workspace's five newest exports were all of a kind they cannot
 * collect. Same discipline as #106's number access, which is filtered SQL-side for the
 * same reason.
 *
 * Unknown kinds are absent, so a new one is invisible to everybody until somebody
 * decides who may collect it. That is the safe direction: the alternative is a new kind
 * of customer data readable by whoever the default happened to favour.
 */
function collectableKinds(role: MemberRole | undefined): string[] {
  if (role === undefined) return [];
  return Object.entries(EXPORT_KIND_CAPABILITY)
    .filter(([, capability]) => roleHasCapability(role, capability))
    .map(([kind]) => kind);
}

exportsRoutes.post("/exports", requireCapability("contacts.bulk"), async (c) => {
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

  // #497: the LOUDER of the two export paths had only the quiet half. A member
  // downloading a filtered contact CSV emails the owner within the hour (#345);
  // an admin requesting everything the business holds — every contact, message
  // and call — wrote a log row and nothing else. That is the departing-employee
  // signature #231 named, on the path that carries more.
  //
  // No count: this is built asynchronously and "everything" is not a quantity
  // the owner needs told. Never fires for the owner's own export.
  alarmOnBulkContactAccess(c, getEnv(c.env), db, {
    companyId,
    actorUserId: c.get("userId"),
    event: "workspace_exported",
    count: 0,
  });

  return c.json({ export_id: result.export_id, already_building: false }, 202);
});

/**
 * #304 — one customer's message history, over a date range.
 *
 * `contacts.bulk`, the same gate as the workspace dump, and deliberately not
 * `conversations.read`. The difference between reading a thread on screen and
 * exporting it is that the export LEAVES: it is a permanent copy of one
 * relationship, outside the product and outside its access rules. That is the
 * axis #231 calls "the departing-employee signature", and one customer's whole
 * correspondence is on it.
 *
 * The builder resolves the requester's number access again at build time, so a
 * thread they cannot see is not in the file. This route does not repeat that
 * check: two implementations of one security decision is the drift class D79
 * exists to prevent, and the builder is the side that must be right because it
 * is the side that writes the bytes.
 */
const historySchema = z.object({
  contact_id: z.string().uuid(),
  /** ISO instants. Absent means from the beginning / until now. */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

exportsRoutes.post(
  "/exports/history",
  requireCapability("contacts.bulk"),
  async (c) => {
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));
    const body = await parseJsonBody(c, historySchema);

    if (body.from && body.to && body.from > body.to) {
      throw new ApiError(
        "validation_failed",
        "The end of the period is before its start.",
      );
    }

    const { data, error } = await db.rpc("request_data_export", {
      p_company_id: companyId,
      p_user_id: c.get("userId"),
      p_kind: "conversation_history",
      p_filters: body,
    });
    if (error) throw new Error(`request_data_export failed: ${error.message}`);
    const result = data as { outcome: "queued" | "in_flight"; export_id: string };

    if (result.outcome === "in_flight") {
      // One scoped export at a time, per the same cost rule as the dump — and
      // scoped to the KIND, so this never waits behind a full workspace export.
      return c.json({ export_id: result.export_id, already_building: true });
    }

    // #231/#304: WHICH customer, not merely that an export happened. "Who
    // exported what" is the question an owner asks after somebody leaves, and
    // an audit row saying only "history" does not answer it.
    await recordAuditFromRequest(db, c, {
      companyId,
      action: "contacts.exported",
      targetType: "data_export",
      targetId: result.export_id,
      after: {
        scope: "conversation_history",
        contact_id: body.contact_id,
        from: body.from ?? null,
        to: body.to ?? null,
      },
    });

    // No count: it is built asynchronously, and one customer's whole history is
    // not a lookup whatever its length. Never fires for the owner's own.
    alarmOnBulkContactAccess(c, getEnv(c.env), db, {
      companyId,
      actorUserId: c.get("userId"),
      event: "history_exported",
      count: 0,
    });

    return c.json({ export_id: result.export_id, already_building: false }, 202);
  },
);

/**
 * #304 — POST /v1/exports/usage: what a bookkeeper needs beside the invoice.
 *
 * GATED ON `billing.manage`, NOT `contacts.bulk`. The history export next door
 * guards customer correspondence, and its capability is the right one for
 * that. This document contains no customer data at all — no names, no numbers,
 * no messages, only counts — and gating it on the bulk-customer capability
 * would lock out the BOOKKEEPER, whose whole preset (#315) is the books and
 * who is the person this exists for.
 *
 * `from` is required. An absent start would mean "since the beginning", which
 * is a different document; a bookkeeper works in periods and asking them to
 * name one is not friction, it is the point.
 *
 * No bulk-contact alarm fires: #231's alarm exists for customer data walking
 * out, and raising it on a count of segments would train an owner to ignore
 * the one that matters.
 */
const usageExportSchema = z.object({
  /** ISO instants. `to` absent means the period is still running. */
  from: z.string().datetime(),
  to: z.string().datetime().optional(),
});

exportsRoutes.post(
  "/exports/usage",
  requireCapability("billing.manage"),
  async (c) => {
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));
    const body = await parseJsonBody(c, usageExportSchema);

    if (body.to && body.from > body.to) {
      throw new ApiError(
        "validation_failed",
        "The end of the period is before its start.",
      );
    }

    const { data, error } = await db.rpc("request_data_export", {
      p_company_id: companyId,
      p_user_id: c.get("userId"),
      p_kind: "usage_summary",
      p_filters: body,
    });
    if (error) throw new Error(`request_data_export failed: ${error.message}`);
    const result = data as { outcome: "queued" | "in_flight"; export_id: string };

    if (result.outcome === "in_flight") {
      return c.json({ export_id: result.export_id, already_building: true });
    }

    // WHICH period, not merely that somebody exported. A row saying only
    // "usage" cannot answer the question it exists to answer.
    await recordAuditFromRequest(db, c, {
      companyId,
      action: "usage.exported",
      targetType: "data_export",
      targetId: result.export_id,
      after: { from: body.from, to: body.to ?? null },
    });

    return c.json({ export_id: result.export_id, already_building: false }, 202);
  },
);

/**
 * #304 — POST /v1/exports/tasks: the work, as a file.
 *
 * GATED ON `contacts.bulk`, like the history export and unlike the usage one.
 * A task list looks like internal admin and is not: every task hangs off a
 * conversation (D17), so each row names a customer and quotes what they asked
 * for. Gating it on `workspace.access` — which is what "it is only our own
 * to-do list" would suggest — would hand every member a customer list.
 *
 * The builder resolves #106 number access again at build time and states what
 * it withheld. This route does not repeat that check, for the same reason the
 * history route does not: two implementations of one security decision is the
 * drift D79 exists to prevent, and the builder is the side that writes bytes.
 */
const tasksExportSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** Absent means both, which is what an unfiltered export of work means. */
  state: z.enum(["open", "done"]).optional(),
});

exportsRoutes.post(
  "/exports/tasks",
  requireCapability("contacts.bulk"),
  async (c) => {
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));
    const body = await parseJsonBody(c, tasksExportSchema);

    if (body.from && body.to && body.from > body.to) {
      throw new ApiError(
        "validation_failed",
        "The end of the period is before its start.",
      );
    }

    const { data, error } = await db.rpc("request_data_export", {
      p_company_id: companyId,
      p_user_id: c.get("userId"),
      p_kind: "tasks",
      p_filters: body,
    });
    if (error) throw new Error(`request_data_export failed: ${error.message}`);
    const result = data as { outcome: "queued" | "in_flight"; export_id: string };

    if (result.outcome === "in_flight") {
      return c.json({ export_id: result.export_id, already_building: true });
    }

    // WHAT was asked for, not merely that an export happened — the same reason
    // the history route names the customer.
    await recordAuditFromRequest(db, c, {
      companyId,
      action: "contacts.exported",
      targetType: "data_export",
      targetId: result.export_id,
      after: {
        scope: "tasks",
        from: body.from ?? null,
        to: body.to ?? null,
        state: body.state ?? null,
      },
    });

    // #231: a list of every customer with outstanding work is the same shape of
    // artifact the bulk alarm exists for, so it fires here as it does for the
    // history export.
    alarmOnBulkContactAccess(c, getEnv(c.env), db, {
      companyId,
      actorUserId: c.get("userId"),
      event: "history_exported",
      count: 0,
    });

    return c.json({ export_id: result.export_id, already_building: false }, 202);
  },
);

/**
 * The floor is `workspace.access`; which exports exist AS FAR AS THIS CALLER IS
 * CONCERNED is decided by [collectableKinds], in the query. An admin's list is
 * unchanged — they hold both capabilities — and a bookkeeper sees the usage summaries
 * they asked for and nothing else.
 */
exportsRoutes.get("/exports", requireCapability("workspace.access"), async (c) => {
  const companyId = c.get("companyId");
  const db = getDb(getEnv(c.env));

  const rows = unwrap<ExportRow[]>(
    await db
      .from("data_exports")
      .select(EXPORT_COLUMNS)
      .eq("company_id", companyId)
      .in("kind", collectableKinds(c.get("role") as MemberRole | undefined))
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
      // #317: always a download. These are our own CSVs, but a CSV carries a
      // payload of its own — a cell beginning `=` is a formula the recipient's
      // spreadsheet may evaluate — and the whole point of the screen is to save
      // the file, not to read it in a browser tab.
      const { data: url, error: signError } = await db.storage
        .from(EXPORTS_BUCKET)
        .createSignedUrl(path, DOWNLOAD_TTL_SECONDS, dispositionOptions("text/csv"));
      if (signError || !url?.signedUrl) return null;
      return { name: entry.name, url: url.signedUrl };
    }),
  );
  return signed.filter((entry): entry is { name: string; url: string } => entry !== null);
}

exportsRoutes.get("/exports/:id", requireCapability("workspace.access"), async (c) => {
  const db = getDb(getEnv(c.env));
  const rows = unwrap<ExportRow[]>(
    await db
      .from("data_exports")
      .select(EXPORT_COLUMNS)
      .eq("company_id", c.get("companyId"))
      .eq("id", c.req.param("id"))
      // The same filter as the list, so an export of a kind this caller may not collect
      // answers exactly as an id that does not exist. A 403 would confirm that this
      // workspace holds one, and there is nothing they could do with that except learn
      // it.
      .in("kind", collectableKinds(c.get("role") as MemberRole | undefined))
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
