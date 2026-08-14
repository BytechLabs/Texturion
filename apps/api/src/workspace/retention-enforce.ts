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
 * AND A MESSAGE CANNOT BE DELETED ON ITS OWN (the #581 C3 finding).
 *
 * Two foreign keys REFUSE it — `usage_events.message_id` and `tasks.message_id`
 * are both `on delete restrict` — so the delete below would have thrown AFTER
 * the photos were already gone. Nightly, to live customers: attachments
 * destroyed, message rows kept, the thread left showing files that 404.
 *
 * It could not fire yet because nothing outside SQL sets `retention_days`, so
 * every workspace sits at the seven-year default. That made it dormant, not
 * fixed, and "we will do it when the setting ships" is how it would have gone
 * out with the setting.
 *
 * The two blockers are cleared differently, on purpose:
 *
 *   - a TASK is deleted. It is a promoted message (D17, `message_id NOT NULL`,
 *     "meaningless without its source message"), so it cannot outlive one.
 *   - a USAGE EVENT keeps its row and loses its POINTER. That row is the
 *     billing meter — a count and a Stripe identifier, carrying nothing a
 *     customer wrote — and destroying revenue history to honour a promise
 *     about message content would be answering the wrong question. The column
 *     is already nullable for exactly this shape (adjustment rows have no
 *     message), and the hourly re-reporter reads `meter_identifier ?? id`,
 *     never the pointer.
 *
 * `attachments` rows go with them, which the earlier version also missed:
 * `owner_id` is a bare uuid with NO foreign key (app-enforced, two id spaces),
 * so nothing cascades. Removing the object and leaving the row is how a gallery
 * ends up listing a photo that 404s.
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
import { VOICEMAILS_BUCKET } from "../messaging/inbound-ring";
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
  {
    table: "attachments",
    // A TASK's files, keyed by the task rather than by the message — which is
    // why the task ids are resolved before anything is destroyed. The task goes
    // with its message (`message_id NOT NULL`), so its photos have to go too,
    // and nothing else will ever look for them: `owner_id` has no foreign key,
    // so they are not orphans anything sweeps, just files.
    key: "owner_id",
    ownerType: "task",
    column: "storage_path",
    bucket: ATTACHMENTS_BUCKET,
    stripPrefix: null,
  },
] as const;

export interface RetentionEnforceSummary {
  companies: number;
  messagesDeleted: number;
  objectsRemoved: number;
  /** #284: voicemail recordings cleared on their own published one-year clock. */
  voicemailsCleared: number;
  /** #284: call records past the workspace's window, with their transcripts. */
  callsDeleted: number;
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
    voicemailsCleared: 0,
    callsDeleted: 0,
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
      summary.callsDeleted += result.calls;
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

  // The voicemail sweep runs on its OWN clock and its own failure budget: it
  // is platform-wide rather than per-workspace, so a tenant whose messages
  // failed above must not also stop every other tenant's audio from ageing out.
  try {
    summary.voicemailsCleared = await clearOverdueVoicemailAudio(db);
  } catch (cause) {
    console.error(
      "voicemail audio retention failed:",
      cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
    );
    failures.push(cause);
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `retention enforcement: ${failures.length} workspace(s) failed`,
    );
  }
  return summary;
}

/**
 * Delete voicemail recordings past the ONE YEAR legal/privacy publishes for
 * them, keeping the call row and its transcript.
 *
 * That asymmetry is the point, and it is the page's own reasoning: "the
 * transcript keeps what was said, while the recording is somebody's actual
 * voice in their home". It is also why this needs no warning, unlike the
 * message sweep — nothing is discovered by loss, because what was said is
 * still there to read. A crew that never noticed the audio go can still search
 * the words.
 *
 * The PATH IS NULLED IN THE SAME PASS that removed the object. Leaving it set
 * would leave a player pointing at a file that is gone, which reads as a bug
 * rather than as a policy — and would make the next run try to remove it
 * again, forever.
 */
async function clearOverdueVoicemailAudio(db: SupabaseClient): Promise<number> {
  let cleared = 0;

  for (let pass = 0; pass < MAX_BATCHES_PER_COMPANY; pass += 1) {
    const { data, error } = await db.rpc("api_voicemail_audio_overdue", {
      p_limit: BATCH,
    });
    if (error) {
      throw new Error(`voicemail audio scan failed: ${error.message}`);
    }
    const rows = (data ?? []) as { call_id: string; voicemail_path: string }[];
    if (rows.length === 0) break;

    const { error: removeError } = await db.storage
      .from(VOICEMAILS_BUCKET)
      .remove(rows.map((row) => row.voicemail_path));
    if (removeError) {
      // Same posture as the message objects: the column is the only pointer
      // left, so nulling it after a failed remove strands the audio for good.
      throw new Error(
        `voicemail audio remove failed: ${removeError.message}`,
      );
    }

    // BOTH pointers, because the two surfaces disagree about which one means "there
    // is a voicemail": the calls LIST draws its player from `voicemail_seconds` (web
    // `call-row.tsx`, Android `CallsScreen.kt`, and the iOS twin), while the detail
    // route derives `has_voicemail` from `voicemail_path`. Clearing only the path left
    // a play button sitting on the list, on two clients, for audio that had been
    // deleted a moment earlier — so pressing it 404s, and only on that one screen,
    // which is harder to work out than either clearing both or clearing neither.
    //
    // The other sweep (`attachments/sweep.ts`) already clears both and says exactly
    // this in its own docblock. One rule, written twice, and this copy was wrong: it
    // would first have gone off in about July 2027, a year after the first workspace
    // set a retention window.
    //
    // The TRANSCRIPT stays. Those are the words of a customer who rang, and they are
    // the only remaining record of what that person wanted once the audio has gone.
    const { error: clearError } = await db
      .from("calls")
      .update({ voicemail_path: null, voicemail_seconds: null })
      .in(
        "id",
        rows.map((row) => row.call_id),
      );
    if (clearError) {
      throw new Error(`voicemail path clear failed: ${clearError.message}`);
    }
    cleared += rows.length;
  }

  return cleared;
}

async function enforceCompany(
  db: SupabaseClient,
  companyId: string,
): Promise<{ messages: number; objects: number; calls: number }> {
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

    // Resolved BEFORE anything is destroyed: a task's files hang off the TASK,
    // and once the task is gone there is nothing left to find them by.
    const taskIds = await taskIdsFor(db, companyId, ids);

    objects += await removeMessageObjects(db, ids, taskIds);

    // The rows whose pointers are app-enforced, so nothing cascades them.
    await deleteAttachmentRows(db, companyId, ids, taskIds);
    // The two `on delete restrict` edges, cleared in the order that leaves the
    // least behind if the pass is interrupted: the task (which cannot outlive
    // its message) before the meter (which must).
    await deleteTasks(db, companyId, ids);
    await severUsageEvents(db, companyId, ids);

    const { error: deleteError } = await db
      .from("messages")
      .delete()
      .in("id", ids);
    if (deleteError) {
      throw new Error(`retention message delete failed: ${deleteError.message}`);
    }
    messages += ids.length;
  }

  const calls = await deleteOverdueCalls(db, companyId);
  return { messages, objects, calls };
}

/**
 * The sibling tables a call's rows live in, keyed by `call_session_id`.
 *
 * NOTHING CASCADES. None of these carries a foreign key to `calls`, so a delete
 * that took only the parent would leave a customer's call legs and per-call
 * records behind forever — present, unreachable, and counted by no retention
 * policy. The workspace purge lists the same tables for the same reason
 * (DELETION.md); this is the per-call subset of that list.
 */
const CALL_SIBLING_TABLES = [
  "call_records",
  "call_member_legs",
  "outbound_call_authorizations",
] as const;

/**
 * Delete call records past the workspace's window, with their transcripts.
 *
 * The transcript goes here rather than earlier, and that is the published
 * promise: the recording lasts a year, the words last as long as the call
 * record does. Deleting the row IS deleting the transcript, because it is a
 * column on it.
 */
async function deleteOverdueCalls(
  db: SupabaseClient,
  companyId: string,
): Promise<number> {
  let deleted = 0;

  for (let pass = 0; pass < MAX_BATCHES_PER_COMPANY; pass += 1) {
    const { data, error } = await db.rpc("api_retention_overdue_calls", {
      p_company_id: companyId,
      p_limit: BATCH,
    });
    if (error) throw new Error(`retention call scan failed: ${error.message}`);
    const rows = (data ?? []) as {
      call_id: string;
      call_session_id: string;
      voicemail_path: string | null;
    }[];
    if (rows.length === 0) break;

    // Any recording the one-year sweep could not clear goes with its row rather
    // than outliving it. Normally already null — seven years is well past one —
    // so this only fires when that sweep has been failing.
    const paths = rows
      .map((row) => row.voicemail_path)
      .filter((path): path is string => typeof path === "string" && path !== "");
    if (paths.length > 0) {
      const { error: removeError } = await db.storage
        .from(VOICEMAILS_BUCKET)
        .remove(paths);
      if (removeError) {
        throw new Error(
          `retention call audio remove failed: ${removeError.message}`,
        );
      }
    }

    // Children before the parent, so an interrupted pass never leaves a
    // sibling row whose call is gone and which nothing will ever find again.
    const sessionIds = rows.map((row) => row.call_session_id);
    for (const table of CALL_SIBLING_TABLES) {
      const { error: siblingError } = await db
        .from(table)
        .delete()
        .in("call_session_id", sessionIds);
      if (siblingError) {
        throw new Error(
          `retention ${table} delete failed: ${siblingError.message}`,
        );
      }
    }

    const { error: callError } = await db
      .from("calls")
      .delete()
      .in(
        "id",
        rows.map((row) => row.call_id),
      );
    if (callError) {
      throw new Error(`retention call delete failed: ${callError.message}`);
    }
    deleted += rows.length;
  }

  return deleted;
}

/**
 * The tasks promoted from this batch of messages.
 *
 * Read before anything is deleted, because a task's files are keyed by the
 * TASK's id — once the row is gone there is no way left to find them, and they
 * would sit in the bucket billed to nobody forever.
 */
async function taskIdsFor(
  db: SupabaseClient,
  companyId: string,
  messageIds: string[],
): Promise<string[]> {
  const { data, error } = await db
    .from("tasks")
    .select("id")
    // Scoped as well as keyed (#347). The ids come from a company-scoped RPC,
    // so the filter is redundant today and is exactly the redundancy that keeps
    // a future caller from deleting another workspace's rows.
    .eq("company_id", companyId)
    .in("message_id", messageIds);
  if (error) throw new Error(`retention task lookup failed: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

/**
 * Delete the `attachments` rows for this batch — a note's by the message id,
 * a task's by the task id.
 *
 * `owner_id` carries NO foreign key: it is a bare uuid across two id spaces
 * (D19), so neither deleting the message nor deleting the task removes these.
 * Clearing the object and leaving the row is worse than doing neither, because
 * the gallery reads live rows and would list a photo that 404s.
 *
 * Hard delete rather than the soft-delete this table also supports: the sweep
 * behind `deleted_at` exists to remove the OBJECT later, and the object is
 * already gone by the time this runs.
 */
async function deleteAttachmentRows(
  db: SupabaseClient,
  companyId: string,
  messageIds: string[],
  taskIds: string[],
): Promise<void> {
  const owners: { ownerType: string; ids: string[] }[] = [
    { ownerType: "note", ids: messageIds },
    { ownerType: "task", ids: taskIds },
  ];
  for (const owner of owners) {
    if (owner.ids.length === 0) continue;
    const { error } = await db
      .from("attachments")
      .delete()
      .eq("company_id", companyId)
      .eq("owner_type", owner.ownerType)
      .in("owner_id", owner.ids);
    if (error) {
      throw new Error(
        `retention ${owner.ownerType} attachment row delete failed: ${error.message}`,
      );
    }
  }
}

/**
 * Delete the tasks promoted from this batch.
 *
 * `tasks.message_id` is `NOT NULL … on delete restrict` and the migration says
 * why: "a task is meaningless without its source message". So a task cannot
 * outlive the message it was promoted from, and the alternative — keeping it
 * with a dangling pointer — is not expressible in the schema anyway.
 *
 * Everything hanging off a task follows automatically: ratings and reminders
 * cascade, and a note's `task_id` is `set null`.
 */
async function deleteTasks(
  db: SupabaseClient,
  companyId: string,
  messageIds: string[],
): Promise<void> {
  const { error } = await db
    .from("tasks")
    .delete()
    .eq("company_id", companyId)
    .in("message_id", messageIds);
  if (error) throw new Error(`retention task delete failed: ${error.message}`);
}

/**
 * Cut the meter's pointer at this batch, keeping the meter.
 *
 * A `usage_events` row is a segment count and a Stripe identifier. It holds
 * nothing a customer wrote, and retention is a promise about what a customer
 * wrote — deleting revenue history to keep it would be answering a question
 * nobody asked, on a table whose whole purpose is to still be there when an
 * invoice is disputed.
 *
 * The column is already nullable for this exact shape (an adjustment row has
 * no message), the unique index that stops double-billing is partial on
 * `message_id is not null`, and the hourly re-reporter identifies a row by
 * `meter_identifier ?? id` and never reads this column.
 */
async function severUsageEvents(
  db: SupabaseClient,
  companyId: string,
  messageIds: string[],
): Promise<void> {
  const { error } = await db
    .from("usage_events")
    .update({ message_id: null })
    .eq("company_id", companyId)
    .in("message_id", messageIds);
  if (error) {
    throw new Error(`retention usage-event sever failed: ${error.message}`);
  }
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
  taskIds: string[],
): Promise<number> {
  let removed = 0;

  for (const source of MESSAGE_OBJECT_SOURCES) {
    const keyIds = source.ownerType === "task" ? taskIds : messageIds;
    if (keyIds.length === 0) continue;
    let query = db
      .from(source.table)
      .select(source.column)
      .in(source.key, keyIds)
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
