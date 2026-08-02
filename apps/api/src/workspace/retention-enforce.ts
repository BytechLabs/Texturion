/**
 * #284 — the half that actually destroys something.
 *
 * The retention setting shipped, the 30-day warning shipped, and nothing ever
 * swung the axe. That order was deliberate — `retention-notice.ts` says so:
 * *"deliberately shipped ahead of the enforcement job — nobody should discover
 * retention by losing something."* Leaving it there is the worse half of the
 * two, because the promise is the liability. We mail a customer to say their
 * oldest messages are about to age out, and then keep them forever: the
 * privacy claim, the breach surface and the storage bill all stay exactly
 * where they were, and now there is an email trail saying otherwise.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER OF OPERATIONS IS THE WHOLE DESIGN.
 *
 * Objects, then rows, per batch — DELETION.md, and the same walk `purge.ts`
 * takes. The rows are where the object paths live, so deleting `messages`
 * first leaves a customer's photos in a bucket with nothing pointing at them:
 * unreachable, unbilled to anyone, and undeleted. That is the #378 bug, and it
 * is worse here than in a workspace purge because it would happen on a
 * schedule, to live customers, forever.
 *
 * RESUMABLE BY CONSTRUCTION, for the same reason purge.ts is: each pass
 * deletes rows, so the database state IS the cursor. An interrupted run leaves
 * nothing half-done that the next run cannot simply continue.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAKES IT SAFE TO RUN AT ALL.
 *
 * Two guards, both enforced in SQL rather than here (see the migration), so a
 * bug in this file cannot route around either one:
 *
 *   - a workspace under LEGAL HOLD is excluded from the query, never skipped
 *     in a loop, so it can never enter a partially-executed deletion;
 *   - a workspace that has not been WARNED about its current window is not
 *     eligible at all. The notice job is therefore load-bearing: if it breaks,
 *     nothing is destroyed. That is the correct direction for that failure to
 *     point, and it is the mechanism behind "never discover retention by
 *     losing something" rather than a comment promising it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { MMS_BUCKET } from "../messaging/media";
import { ATTACHMENTS_BUCKET } from "../routes/core/attachments";

/** Messages per batch, and objects per Storage call. */
const BATCH = 500;

/**
 * Batches per run, per workspace. A ceiling so one enormous tenant cannot hold
 * the run open indefinitely; tomorrow continues from wherever this stopped,
 * which is what makes the whole thing resumable.
 */
const MAX_BATCHES_PER_COMPANY = 20;

/** Workspaces per run, oldest overdue data first. */
const MAX_COMPANIES_PER_RUN = 5;

/**
 * Where a MESSAGE's files live, and the column holding each path.
 *
 * A subset of `purge.ts`'s `OBJECT_SOURCES`, and deliberately not a shared
 * constant: that list is scoped to a whole workspace and includes voicemail
 * audio and export blobs, neither of which hangs off a message. Importing it
 * here would silently widen this job to objects it has no right to touch —
 * a call's voicemail ages out on the CALL's clock, not on the thread's.
 */
const MESSAGE_OBJECT_SOURCES = [
  {
    table: "message_attachments",
    // What a customer MMS'd us. Keyed by the message directly.
    key: "message_id",
    ownerType: null,
    column: "storage_path",
    bucket: MMS_BUCKET,
    // Legacy rows carry the bucket name in the path (SPEC §6); Storage wants
    // the key without it.
    stripPrefix: "mms-media/",
  },
  {
    table: "attachments",
    // A note IS a message (D14 archetype A), so a note's files hang off the
    // message id through the generic owner pair rather than a column of their
    // own. `owner_type` is not optional here: `owner_id` is a bare uuid across
    // two id spaces, and a task whose id happened to collide with a message's
    // would have its files deleted by a thread's retention window.
    key: "owner_id",
    ownerType: "note",
    column: "storage_path",
    bucket: ATTACHMENTS_BUCKET,
    stripPrefix: null,
  },
] as const;

export interface RetentionEnforceSummary {
  companies: number;
  messagesDeleted: number;
  objectsRemoved: number;
}

interface OverdueCompany {
  company_id: string;
  window_days: number;
  message_count: number;
  oldest_at: string;
}

/**
 * The daily sweep. One workspace's failure never stops the others — every step
 * is safely repeatable tomorrow, and a tenant stuck on a bad object path must
 * not freeze retention for the whole platform.
 */
export async function runRetentionEnforceJob(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<RetentionEnforceSummary> {
  const summary: RetentionEnforceSummary = {
    companies: 0,
    messagesDeleted: 0,
    objectsRemoved: 0,
  };

  const { data, error } = await db.rpc("api_retention_overdue_companies", {
    p_limit: MAX_COMPANIES_PER_RUN,
  });
  if (error) throw new Error(`retention overdue scan failed: ${error.message}`);

  const failures: unknown[] = [];
  for (const row of (data ?? []) as OverdueCompany[]) {
    try {
      const result = await enforceCompany(db, row.company_id);
      summary.companies += 1;
      summary.messagesDeleted += result.messages;
      summary.objectsRemoved += result.objects;
    } catch (cause) {
      // Named in the run's own logs, because an AggregateError serializes only
      // its top-level message on this platform and "1 of 5 failed" is not
      // diagnosable from a dashboard.
      console.error(
        `retention enforcement failed for ${row.company_id}:`,
        cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
      );
      failures.push(cause);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `retention enforcement: ${failures.length} workspace(s) failed`,
    );
  }
  return summary;
}

async function enforceCompany(
  db: SupabaseClient,
  companyId: string,
): Promise<{ messages: number; objects: number }> {
  let messages = 0;
  let objects = 0;

  for (let pass = 0; pass < MAX_BATCHES_PER_COMPANY; pass += 1) {
    // Re-read every pass rather than paginating. The rows from the last pass
    // are gone, so "the next batch" is always the same query — and the RPC
    // re-checks legal hold each time, which is what makes a hold placed
    // mid-run stop the very next batch instead of the next day's.
    const { data, error } = await db.rpc("api_retention_overdue_messages", {
      p_company_id: companyId,
      p_limit: BATCH,
    });
    if (error) {
      throw new Error(`retention batch query failed: ${error.message}`);
    }
    const ids = ((data ?? []) as { message_id: string }[]).map(
      (row) => row.message_id,
    );
    if (ids.length === 0) break;

    objects += await removeMessageObjects(db, ids);

    const { error: deleteError } = await db
      .from("messages")
      .delete()
      .in("id", ids);
    if (deleteError) {
      throw new Error(`retention message delete failed: ${deleteError.message}`);
    }
    messages += ids.length;
  }

  return { messages, objects };
}

/**
 * Clear the storage objects belonging to a batch of messages, before their
 * rows go away.
 *
 * A Storage failure THROWS rather than continuing, deliberately: the rows are
 * the only remaining pointer to those objects, so deleting them after a failed
 * remove would strand the files permanently. Leaving both in place means the
 * next run retries, and `remove()` is idempotent so a partial pass is safe to
 * repeat.
 */
async function removeMessageObjects(
  db: SupabaseClient,
  messageIds: string[],
): Promise<number> {
  let removed = 0;

  for (const source of MESSAGE_OBJECT_SOURCES) {
    let query = db
      .from(source.table)
      .select(source.column)
      .in(source.key, messageIds)
      .not(source.column, "is", null);
    if (source.ownerType !== null) {
      query = query.eq("owner_type", source.ownerType);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(
        `retention ${source.table} path query failed: ${error.message}`,
      );
    }
    const paths = ((data ?? []) as Record<string, string | null>[])
      .map((row) => row[source.column])
      .filter((path): path is string => typeof path === "string" && path !== "")
      .map((path) =>
        source.stripPrefix && path.startsWith(source.stripPrefix)
          ? path.slice(source.stripPrefix.length)
          : path,
      );
    if (paths.length === 0) continue;

    const { error: removeError } = await db.storage
      .from(source.bucket)
      .remove(paths);
    if (removeError) {
      throw new Error(
        `retention ${source.bucket} remove failed: ${removeError.message}`,
      );
    }
    removed += paths.length;
  }

  return removed;
}
