/**
 * #341 / D48 — erasing closed workspaces, phase 2.
 *
 * Runs daily. Picks up workspaces whose 30-day window has passed and walks the
 * teardown in docs/DELETION.md a batch at a time, until the workspace is empty
 * and its row is anonymised.
 *
 * RESUMABLE BY CONSTRUCTION. There is no cursor to keep: each step deletes
 * rows, so the database state is the position and a re-run picks up exactly
 * where the last one stopped. That is what makes an interrupted purge safe —
 * the failure mode this whole design exists to prevent is a workspace left
 * half-erased with nobody able to say which half.
 *
 * THE STORAGE OBJECTS GO FIRST, per step, because the rows are where the paths
 * live. A teardown that deletes `attachments` before removing its objects
 * leaves a customer's photos in a bucket with nothing left pointing at them —
 * unreachable, unbilled to anyone, and undeleted. `remove()` is idempotent, so
 * repeating a partial pass is safe.
 *
 * The Stripe customer goes last, after the rows: it is the one step whose
 * failure should not stop the rest, and re-running the sweep retries it.
 */
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getStripe } from "../billing/stripe";
import { getDb } from "../db";
import type { Env } from "../env";
import { MMS_BUCKET } from "../messaging/media";
import { VOICEMAILS_BUCKET } from "../messaging/inbound-ring";
import { ATTACHMENTS_BUCKET } from "../routes/core/attachments";
import { sendDeletionEmail, workspacePurgedEmail } from "./deletion-emails";

/** Rows per delete, and objects per Storage call. */
const BATCH = 500;
/**
 * Steps per cron run. A day of erasing is plenty for any real workspace, and a
 * ceiling means one enormous tenant cannot hold the run open indefinitely —
 * the next day picks up where this one stopped, which is the whole point of
 * making it resumable.
 */
const MAX_STEPS_PER_RUN = 200;
/** Workspaces per run. */
const MAX_WORKSPACES_PER_RUN = 5;

/**
 * The three places a closed workspace's files live, and the column holding
 * each path. Swept before the owning table's rows are deleted.
 */
const OBJECT_SOURCES = [
  {
    table: "message_attachments",
    column: "storage_path",
    bucket: MMS_BUCKET,
    // Legacy rows carry the bucket name in the path (SPEC §6); Storage wants
    // the key without it.
    stripPrefix: "mms-media/",
  },
  {
    table: "attachments",
    column: "storage_path",
    bucket: ATTACHMENTS_BUCKET,
    stripPrefix: null,
  },
  {
    table: "calls",
    column: "voicemail_path",
    bucket: VOICEMAILS_BUCKET,
    stripPrefix: null,
  },
] as const;

interface PurgeStep {
  step: string | null;
  deleted: number;
  done: boolean;
}

export interface PurgeSummary {
  workspaces: number;
  rowsDeleted: number;
  objectsRemoved: number;
  completed: number;
  /** #371: erasure receipts that reached the customer. */
  receiptsSent: number;
}

/**
 * The daily sweep. Never throws for one workspace's failure — a stuck tenant
 * must not stop the others, and every step is safely repeatable tomorrow.
 */
export async function purgeClosedWorkspaces(
  env: Env,
  now: Date = new Date(),
): Promise<PurgeSummary> {
  const db = getDb(env);
  const summary: PurgeSummary = {
    workspaces: 0,
    rowsDeleted: 0,
    objectsRemoved: 0,
    completed: 0,
    receiptsSent: 0,
  };

  const { data, error } = await db
    .from("companies")
    // #371: the name and the receipt address are read HERE, at the top of the
    // run, because both are cleared by the anonymise at the end of it. A
    // resumed purge that finishes today still carries what it needs to say so.
    .select("id,name,stripe_customer_id,purge_receipt_email")
    .not("purge_after", "is", null)
    .lte("purge_after", now.toISOString())
    .is("purged_at", null)
    .order("purge_after", { ascending: true })
    .limit(MAX_WORKSPACES_PER_RUN);
  if (error) throw new Error(`purge sweep query failed: ${error.message}`);

  for (const row of (data ?? []) as {
    id: string;
    name: string | null;
    stripe_customer_id: string | null;
    purge_receipt_email: string | null;
  }[]) {
    summary.workspaces += 1;
    try {
      const result = await purgeWorkspace(env, db, row.id, row.stripe_customer_id);
      summary.rowsDeleted += result.rowsDeleted;
      summary.objectsRemoved += result.objectsRemoved;
      if (result.completed) {
        summary.completed += 1;
        // #371: the receipt proper, and the last thing this workspace ever
        // does. After the anonymise there is no name and no address left, so
        // this is the final moment either exists.
        if (
          row.purge_receipt_email &&
          (await sendDeletionEmail(
            env,
            row.purge_receipt_email,
            workspacePurgedEmail({
              companyName: row.name ?? "your workspace",
              purgedAt: now,
            }),
            `workspace purge ${row.id}`,
          ))
        ) {
          summary.receiptsSent += 1;
        }
      }
    } catch (cause) {
      // Loud, and never fatal to the rest of the run. A workspace that failed
      // partway is exactly as safe to resume as one that has not started.
      Sentry.captureMessage(
        `workspace purge failed for ${row.id}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        "error",
      );
    }
  }
  return summary;
}

async function purgeWorkspace(
  env: Env,
  db: SupabaseClient,
  companyId: string,
  stripeCustomerId: string | null,
): Promise<{ rowsDeleted: number; objectsRemoved: number; completed: boolean }> {
  let rowsDeleted = 0;
  let objectsRemoved = 0;

  for (let step = 0; step < MAX_STEPS_PER_RUN; step += 1) {
    // Files before rows, every pass: the rows are where the paths are, and a
    // deleted row is an object nothing can reach.
    objectsRemoved += await removeObjects(db, companyId);

    const { data, error } = await db.rpc("purge_workspace_step", {
      p_company_id: companyId,
      p_limit: BATCH,
    });
    if (error) throw new Error(`purge_workspace_step failed: ${error.message}`);
    const result = data as PurgeStep;
    rowsDeleted += result.deleted;

    if (result.done) {
      // Rows gone. Stripe next — its failure must not block the anonymise,
      // because a customer record we could not delete is our problem to retry,
      // not a reason to leave the workspace named.
      await deleteStripeCustomer(env, companyId, stripeCustomerId);
      const { error: anonError } = await db.rpc("anonymize_purged_workspace", {
        p_company_id: companyId,
      });
      if (anonError) {
        throw new Error(`anonymize_purged_workspace failed: ${anonError.message}`);
      }
      return { rowsDeleted, objectsRemoved, completed: true };
    }
  }

  // Out of budget, not out of work. Tomorrow resumes here.
  return { rowsDeleted, objectsRemoved, completed: false };
}

/**
 * One batch of Storage objects per source, removed before their rows are.
 * Returns how many objects Storage was asked to reclaim.
 */
async function removeObjects(
  db: SupabaseClient,
  companyId: string,
): Promise<number> {
  let removed = 0;
  for (const source of OBJECT_SOURCES) {
    const { data, error } = await db
      .from(source.table)
      .select(source.column)
      .eq("company_id", companyId)
      .not(source.column, "is", null)
      .limit(BATCH);
    if (error) {
      throw new Error(`purge ${source.table} path query failed: ${error.message}`);
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
      // Leave the rows in place so the next pass retries: deleting them now
      // would orphan the objects permanently.
      throw new Error(
        `purge ${source.bucket} remove failed: ${removeError.message}`,
      );
    }
    removed += paths.length;
  }
  return removed;
}

/** The customer record at Stripe. Best-effort; the next run retries. */
async function deleteStripeCustomer(
  env: Env,
  companyId: string,
  customerId: string | null,
): Promise<void> {
  if (!customerId) return;
  try {
    await getStripe(env).customers.del(customerId);
  } catch (cause) {
    Sentry.captureMessage(
      `workspace purge: Stripe customer delete failed for ${companyId}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      "error",
    );
  }
}
