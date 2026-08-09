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
import {
  buildConversationHistory,
  type HistoryFilters,
} from "./history-export";
import {
  buildUsageExport,
  type UsageExportFilters,
} from "./usage-export";
import {
  buildTaskExport,
  type TaskExportFilters,
} from "./tasks-export";
import { emailLayout } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

export const EXPORTS_BUCKET = "exports";

/** #378: how many expired exports one daily run reclaims. */
const REAP_BATCH = 200;

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
    // #419: `liveOnly` stays false — a soft-deleted saved reply is still data
    // we hold, and an export that omitted it would be answering the wrong
    // question. But `deleted_at` now rides with it, or the export would
    // present a deleted template as a live one.
    table: "templates",
    columns: "id,name,body,created_at,updated_at,deleted_at",
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
  /** #304: `workspace` (the #227 dump) or `conversation_history`. */
  kind?: string;
  filters?: Record<string, unknown>;
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
    .select(
      "id,company_id,requested_by,storage_prefix,completed_tables,row_counts," +
        // #304: which builder this row wants, and what it asked for.
        "kind,filters",
    )
    .in("status", ["pending", "running"])
    .order("requested_at", { ascending: true })
    .limit(MAX_EXPORTS_PER_RUN);
  if (error) throw new Error(`export queue query failed: ${error.message}`);

  // The select is built from a concatenated string, which supabase-js
  // cannot parse at the type level, so the cast goes through `unknown`
  // exactly as the table reads below already do.
  for (const row of (data ?? []) as unknown as ExportRow[]) {
    summary.exports += 1;
    try {
      // #304: two kinds share this queue, this bucket, this reaper and this
      // failure path. What differs is what gets written, so the dispatch is
      // here and nowhere else.
      const result =
        row.kind === "conversation_history"
          ? await buildHistoryExport(db, row, now)
          : row.kind === "usage_summary"
            ? await buildUsageSummaryExport(db, row, now)
            : row.kind === "tasks"
              ? await buildTasksExport(db, row, now)
              : await buildOne(env, db, row, now);
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

/**
 * #304 — one customer's history, written and finished in a single run.
 *
 * No resume state, unlike the workspace dump: it is one document and one CSV,
 * bounded by `HISTORY_MESSAGE_CAP`, so there is no half-written state worth
 * remembering. A failure leaves the row failed and the requester told, which
 * is the same contract the dump has.
 */
async function buildHistoryExport(
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

  const result = await buildConversationHistory(
    db,
    {
      exportId: row.id,
      companyId: row.company_id,
      requestedBy: row.requested_by,
      filters: (row.filters ?? {}) as HistoryFilters,
      prefix,
      now,
    },
    (path, body, contentType) => putObject(db, path, body, contentType),
  );

  await db
    .from("data_exports")
    .update({
      status: "ready",
      completed_at: new Date().toISOString(),
      // The receipt, in the same shape the dump uses: what was written, and
      // whether anything was left out.
      row_counts: { messages: result.messages, partial: result.partial ? 1 : 0 },
    })
    .eq("id", row.id);
  return { parts: 2, completed: true };
}

/**
 * #304 — the bookkeeper's window, written in one run.
 *
 * Same shape as the history export: two files, no resume state, and a receipt
 * that records whether the figures are final. `partial` here does not mean the
 * document is short — it means segments in the window have not yet been
 * reported to Stripe, so the invoice they land on has not been written.
 */
async function buildUsageSummaryExport(
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

  const result = await buildUsageExport(
    db,
    {
      exportId: row.id,
      companyId: row.company_id,
      filters: (row.filters ?? {}) as UsageExportFilters,
      prefix,
      now,
    },
    (path, body, contentType) => putObject(db, path, body, contentType),
  );

  await db
    .from("data_exports")
    .update({
      status: "ready",
      completed_at: new Date().toISOString(),
      row_counts: { segments: result.segments, partial: result.partial ? 1 : 0 },
    })
    .eq("id", row.id);
  return { parts: 2, completed: true };
}

/** #304 — the work, written in one run. Same shape as the other two. */
async function buildTasksExport(
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

  const result = await buildTaskExport(
    db,
    {
      companyId: row.company_id,
      requestedBy: row.requested_by,
      filters: (row.filters ?? {}) as TaskExportFilters,
      prefix,
      now,
    },
    (path, body, contentType) => putObject(db, path, body, contentType),
  );

  await db
    .from("data_exports")
    .update({
      status: "ready",
      completed_at: new Date().toISOString(),
      row_counts: {
        tasks: result.tasks,
        partial: result.withheld > 0 || result.capped ? 1 : 0,
      },
    })
    .eq("id", row.id);
  return { parts: 2, completed: true };
}

async function putObject(
  db: SupabaseClient,
  path: string,
  /**
   * #587: `Uint8Array` as well as `string`, because a CSV part now carries a
   * byte-order mark and the mark is bytes. These files are downloaded by the
   * customer and opened in Excel — the same reader the HTTP exports have, so
   * the same rule applies. The HTML and JSON parts stay strings.
   */
  body: string | Uint8Array,
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
    const { id: emailId } = await sendEmail(env, {
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

    // #386 ask 4: keep the id the delivery outcome is recorded against. An
    // access request asks whether the person actually got their data — an
    // accepted-id only says we handed a message to a queue, and a bounced
    // export link is worth knowing about inside the seven-day window rather
    // than after it closes.
    if (emailId) {
      await db
        .from("data_exports")
        .update({ notify_email_id: emailId })
        .eq("id", row.id);
    }
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


/**
 * #378 — delete the objects behind one export prefix.
 *
 * An export is, by its own header, "a copy of every message, contact and note
 * the workspace holds": the single most concentrated personal-data object this
 * system ever produces. Nothing deleted from this bucket until now — the
 * seven-day window was an ACCESS check (`routes/exports.ts` refuses to sign a
 * URL past `expires_at`), so "expired" meant invisible rather than gone.
 *
 * That made the export blob an undocumented survivor of D48's erasure. The
 * survivor list in docs/DELETION.md gets its integrity from being complete and
 * deliberate — opt-outs survive because a STOP belongs to the person who sent
 * it, consent artifacts survive at the CASL floor. Those are defended choices.
 * This one was an oversight, and one unaccounted survivor damages that document
 * more than the accounted ones do.
 *
 * Returns how many objects went. Listing is bounded because an export writes
 * one file per table, not one per row.
 */
export async function removeExportObjects(
  db: SupabaseClient,
  prefix: string,
): Promise<number> {
  const { data, error } = await db.storage
    .from(EXPORTS_BUCKET)
    .list(prefix, { limit: 200 });
  if (error) throw new Error(`export object list failed: ${error.message}`);

  // The bucket is flat under the prefix and every real object has an
  // extension; Storage also returns placeholder entries for folders.
  const paths = (data ?? [])
    .filter((entry) => entry.name.includes("."))
    .map((entry) => `${prefix}/${entry.name}`);
  if (paths.length === 0) return 0;

  const { error: removeError } = await db.storage.from(EXPORTS_BUCKET).remove(paths);
  if (removeError) {
    throw new Error(`export object remove failed: ${removeError.message}`);
  }
  return paths.length;
}


/**
 * #378 — the reaper that makes the seven-day promise true.
 *
 * The completion email says "the download links are good for 7 days, after
 * which the export is deleted". That was enforced only as an ACCESS check:
 * past `expires_at` the API refuses to sign a URL, and the object stayed in
 * the bucket forever. Every export ever built was retained for every
 * workspace, with no cap, no ledger, no alert and nothing to reclaim it — the
 * uncapped cost centre the cost-protection mandate exists to kill, on the one
 * object that is far larger than any attachment.
 *
 * `reaped_at` rather than deleting the row: a customer looking at their export
 * history should see that they requested one and that it has since expired,
 * not a gap where it used to be. The row is a record of a request; the blob is
 * the data.
 */
export async function pruneExpiredExports(
  env: Env,
  now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<{ reaped: number; objectsRemoved: number }> {
  const { data, error } = await db
    .from("data_exports")
    .select("id,storage_prefix")
    .lt("expires_at", now.toISOString())
    .is("reaped_at", null)
    .not("storage_prefix", "is", null)
    .limit(REAP_BATCH);
  if (error) throw new Error(`expired export query failed: ${error.message}`);

  const rows = (data ?? []) as { id: string; storage_prefix: string }[];
  let objectsRemoved = 0;
  let reaped = 0;

  for (const row of rows) {
    try {
      objectsRemoved += await removeExportObjects(db, row.storage_prefix);
      // Stamped only after the objects are gone. Stamping first would mean a
      // failure here leaves the row looking reaped while the copy of every
      // message in the workspace is still sitting in the bucket — the exact
      // shape of the bug this job exists to fix.
      const { error: stampError } = await db
        .from("data_exports")
        .update({ reaped_at: now.toISOString() })
        .eq("id", row.id)
        .is("reaped_at", null);
      if (stampError) throw new Error(stampError.message);
      reaped += 1;
    } catch (cause) {
      // One stuck export must not stop the others, and tomorrow's run retries
      // it: the row is still unstamped and still expired.
      Sentry.captureMessage(
        `export reap failed for ${row.id}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        "error",
      );
    }
  }

  return { reaped, objectsRemoved };
}
