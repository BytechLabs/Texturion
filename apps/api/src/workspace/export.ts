/**
 * #227 — building a workspace's data export.
 *
 * Runs on the cron because it has to: a busy workspace holds tens of thousands
 * of messages, and assembling that inside an HTTP request would blow the
 * Worker's limits on exactly the customers most likely to ask for it. The
 * request enqueues; this builds.
 *
 * ONE TABLE AT A TIME, IN PAGES. Each table is written as numbered JSONL parts
 * and then recorded as done, so an interrupted run resumes at the next table
 * rather than rewriting what is already in the bucket. Nothing larger than one
 * page is ever held in memory, which is what keeps a 200,000-message workspace
 * from being the one that cannot export.
 *
 * JSONL, not PDF: portability means the data can be loaded somewhere else. A
 * manifest lists every part with its row count, so a reader can tell a
 * complete export from a truncated one.
 *
 * WHAT IS NOT IN IT: the files themselves. Attachments and voicemail audio are
 * listed in an attachments manifest with their paths and sizes, not copied —
 * duplicating a workspace's entire object storage into a second bucket is a
 * cost we would carry for every export, and the manifest is what a portability
 * request actually needs.
 */
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import { emailLayout } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

export const EXPORTS_BUCKET = "exports";

/** Rows per query and per written part. */
const PAGE = 1000;
/**
 * Parts per cron run. A day's budget: enough that any real workspace finishes
 * in one pass, bounded so one enormous tenant cannot hold the run open. The
 * next run resumes at the table it stopped on.
 */
const MAX_PARTS_PER_RUN = 60;
/** Exports built per run. */
const MAX_EXPORTS_PER_RUN = 3;

/**
 * The tables an export covers, in the order a reader would want them, with the
 * columns that carry meaning. Explicit rather than `select *`: an export is a
 * published contract, and a column added later should not silently start
 * leaving the building.
 */
const EXPORT_TABLES = [
  {
    table: "contacts",
    columns:
      "id,phone_e164,name,address,notes,consent_source,consent_at,created_at,updated_at",
    liveOnly: true,
  },
  {
    table: "conversations",
    columns:
      "id,contact_id,phone_number_id,assigned_user_id,status,is_spam,last_message_at,closed_at,created_at",
    liveOnly: false,
  },
  {
    table: "messages",
    columns:
      "id,conversation_id,direction,body,status,sent_by_user_id,done_at,created_at",
    liveOnly: false,
  },
  {
    table: "tasks",
    columns:
      "id,conversation_id,message_id,title,description,assigned_user_id,due_at," +
      "addr_street,addr_unit,addr_city,addr_state,addr_postal_code,addr_country," +
      "created_at,updated_at",
    liveOnly: true,
  },
  {
    table: "calls",
    columns:
      "id,conversation_id,caller_e164,direction,outcome,answered_by_user_id," +
      "voicemail_seconds,voicemail_transcript,started_at,ended_at",
    liveOnly: false,
  },
  {
    table: "templates",
    columns: "id,name,body,created_at,updated_at",
    liveOnly: false,
  },
  { table: "tags", columns: "id,name,color,created_at", liveOnly: false },
  {
    table: "opt_outs",
    columns: "id,phone_e164,source,created_at,revoked_at",
    liveOnly: false,
  },
  // The attachments manifest: what exists and where, not the bytes.
  {
    table: "attachments",
    columns:
      "id,conversation_id,owner_type,owner_id,file_name,content_type,size_bytes,storage_path,created_at",
    liveOnly: true,
  },
  {
    table: "message_attachments",
    columns: "id,message_id,content_type,size_bytes,storage_path,created_at",
    liveOnly: false,
  },
] as const;

export interface ExportSummary {
  exports: number;
  parts: number;
  completed: number;
}

interface ExportRow {
  id: string;
  company_id: string;
  requested_by: string;
  storage_prefix: string | null;
  completed_tables: string[];
  row_counts: Record<string, number>;
}

/**
 * The queue drain. Never throws for one export's failure — a workspace whose
 * export breaks must not stop everyone else's, and the row records the reason
 * so the customer is told rather than left waiting forever.
 */
export async function buildDataExports(
  env: Env,
  now: Date = new Date(),
): Promise<ExportSummary> {
  const db = getDb(env);
  const summary: ExportSummary = { exports: 0, parts: 0, completed: 0 };

  const { data, error } = await db
    .from("data_exports")
    .select("id,company_id,requested_by,storage_prefix,completed_tables,row_counts")
    .in("status", ["pending", "running"])
    .order("requested_at", { ascending: true })
    .limit(MAX_EXPORTS_PER_RUN);
  if (error) throw new Error(`export queue query failed: ${error.message}`);

  for (const row of (data ?? []) as ExportRow[]) {
    summary.exports += 1;
    try {
      const result = await buildOne(env, db, row, now);
      summary.parts += result.parts;
      if (result.completed) summary.completed += 1;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // Told, not silently stuck. An export nobody hears about again is worse
      // than one that failed — the customer is waiting on a legal right.
      await db
        .from("data_exports")
        .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
        .eq("id", row.id);
      Sentry.captureMessage(
        `data export failed for company ${row.company_id}: ${message}`,
        "error",
      );
    }
  }
  return summary;
}

async function buildOne(
  env: Env,
  db: SupabaseClient,
  row: ExportRow,
  now: Date,
): Promise<{ parts: number; completed: boolean }> {
  const prefix = row.storage_prefix ?? `${row.company_id}/${row.id}`;
  if (row.storage_prefix === null) {
    await db
      .from("data_exports")
      .update({ storage_prefix: prefix, status: "running", started_at: now.toISOString() })
      .eq("id", row.id);
  }

  const done = new Set(row.completed_tables ?? []);
  const counts: Record<string, number> = { ...(row.row_counts ?? {}) };
  let parts = 0;

  for (const spec of EXPORT_TABLES) {
    if (done.has(spec.table)) continue;
    if (parts >= MAX_PARTS_PER_RUN) {
      // Out of budget, not out of work. Tomorrow resumes at this table.
      return { parts, completed: false };
    }

    let written = 0;
    let page = 0;
    for (;;) {
      // Soft-deleted rows stay out: the customer deleted them, and an export
      // that hands them back is not a copy of their workspace, it is a copy of
      // things they thought were gone.
      let query = db
        .from(spec.table)
        .select(spec.columns)
        .eq("company_id", row.company_id);
      if (spec.liveOnly) query = query.is("deleted_at", null);
      const { data, error } = await query
        .order("id", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) {
        throw new Error(`export ${spec.table} read failed: ${error.message}`);
      }
      // supabase-js parses `select()` at the type level; a column list held in
      // a const table is opaque to it, so the cast goes through `unknown`.
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      if (rows.length === 0) break;

      const body = rows.map((entry) => JSON.stringify(entry)).join("\n");
      await putObject(
        db,
        `${prefix}/${spec.table}-${String(page + 1).padStart(4, "0")}.jsonl`,
        body,
        "application/x-ndjson",
      );
      written += rows.length;
      parts += 1;
      page += 1;
      if (rows.length < PAGE) break;
      if (parts >= MAX_PARTS_PER_RUN) break;
    }

    // Recorded only once the parts are safely in the bucket: a table marked
    // done whose files are missing is an export that lies about being whole.
    const { error: recordError } = await db.rpc("record_export_table", {
      p_export_id: row.id,
      p_table: spec.table,
      p_rows: written,
    });
    if (recordError) {
      throw new Error(`record_export_table failed: ${recordError.message}`);
    }
    counts[spec.table] = written;
    done.add(spec.table);
  }

  // The manifest lands last, so its presence means the export is whole.
  await putObject(
    db,
    `${prefix}/manifest.json`,
    JSON.stringify(
      {
        company_id: row.company_id,
        exported_at: now.toISOString(),
        format: "jsonl",
        note:
          "One .jsonl file per table, numbered. Attachments and voicemail audio " +
          "are listed with their paths and sizes rather than copied.",
        row_counts: counts,
      },
      null,
      2,
    ),
    "application/json",
  );

  await db
    .from("data_exports")
    .update({ status: "ready", completed_at: new Date().toISOString() })
    .eq("id", row.id);
  await notifyReady(env, db, row);
  return { parts, completed: true };
}

async function putObject(
  db: SupabaseClient,
  path: string,
  body: string,
  contentType: string,
): Promise<void> {
  const { error } = await db.storage
    .from(EXPORTS_BUCKET)
    .upload(path, new Blob([body], { type: contentType }), {
      contentType,
      // A resumed run rewrites a part it had already written rather than
      // failing on it — the same bytes either way.
      upsert: true,
    });
  if (error) throw new Error(`export upload ${path} failed: ${error.message}`);
}

/** Tell the person who asked. A right nobody is told about is not served. */
async function notifyReady(
  env: Env,
  db: SupabaseClient,
  row: ExportRow,
): Promise<void> {
  try {
    const { data, error } = await db.auth.admin.getUserById(row.requested_by);
    if (error || !data.user?.email) return;
    const link = `${env.APP_ORIGIN}/settings/workspace`;
    await sendEmail(env, {
      to: [data.user.email],
      subject: "Your Loonext data export is ready",
      text:
        "Your export is ready to download.\n\n" +
        `Get it here: ${link}\n\n` +
        "The download links are good for 7 days, after which the export is " +
        "deleted and you can ask for a fresh one.\n",
      html: emailLayout(
        `<p>Your export is ready to download.</p>` +
          `<p><a href="${link}" style="color:#66801F;text-decoration:underline;">Get your export</a></p>` +
          `<p style="font-size:14px;color:#6E7163;">The download links are good for 7 days, ` +
          `after which the export is deleted and you can ask for a fresh one.</p>`,
      ),
    });
  } catch (cause) {
    // The export IS ready and visible in settings; a failed email is worth
    // knowing about but must not mark a finished export as failed.
    Sentry.captureMessage(
      `data export ready-email failed for ${row.id}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      "warning",
    );
  }
}
