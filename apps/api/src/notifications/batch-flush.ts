/**
 * #297 — the batch, sent as one thing.
 *
 * "Four new messages across three conversations" is one useful notification
 * instead of four interruptions. That sentence is the entire feature: the queue
 * exists so this job can say it.
 *
 * ONE PUSH PER MEMBER, NOT PER ROW. The claim RPC groups by member for exactly
 * this reason — flushing row by row would send four notifications that each say
 * "1 new message", which is the volume problem wearing the feature's name, with
 * nothing to error and nobody to file a bug.
 *
 * A batch NEVER contains anything urgent. Urgent events are sent before the
 * queue is consulted, so nothing in here can be an emergency waiting on a
 * window — which is the property that makes the whole feature safe to offer.
 */
import { digestLine } from "@loonext/shared";

import { getDb } from "../db";
import type { Env } from "../env";
import { deliverPush } from "./deliver";

/** How many members' batches one tick will flush. */
const MAX_MEMBERS_PER_TICK = 20;

export interface BatchFlushSummary {
  members: number;
  notifications: number;
}

interface PendingRow {
  id: string;
  company_id: string;
  user_id: string;
  category: string;
  conversation_id: string | null;
}

/**
 * Send every batch whose window has closed.
 *
 * Best-effort per member: one workspace's dead push tokens must not stop the
 * next member's digest. Failures are logged and the run continues, because the
 * alternative is one bad row holding the sweep hostage every minute.
 */
export async function runBatchFlush(
  env: Env,
  now = new Date(),
): Promise<BatchFlushSummary> {
  const db = getDb(env);
  const summary: BatchFlushSummary = { members: 0, notifications: 0 };

  const { data, error } = await db.rpc("api_claim_due_notifications", {
    p_now: now.toISOString(),
    p_limit: MAX_MEMBERS_PER_TICK,
  });
  if (error) throw new Error(`claim due notifications failed: ${error.message}`);

  const rows = (data ?? []) as PendingRow[];
  if (rows.length === 0) return summary;

  // Group by (company, member): the claim already scoped it that way, and a
  // member who belongs to two workspaces gets two digests, because they are
  // two different inboxes and one sentence could not honestly cover both.
  const batches = new Map<string, PendingRow[]>();
  for (const row of rows) {
    const key = `${row.company_id}:${row.user_id}`;
    batches.set(key, [...(batches.get(key) ?? []), row]);
  }

  for (const batch of batches.values()) {
    const first = batch[0];
    try {
      const conversations = new Set(
        batch
          .map((row) => row.conversation_id)
          .filter((id): id is string => id !== null),
      );
      const body = digestLine(batch.length, conversations.size);

      // Into the inbox rather than a thread, EVEN when the digest covers one
      // conversation. A digest is a summary of a period, and landing somebody
      // in a single thread would answer a question they did not ask while
      // hiding the other three.
      const url = `${env.APP_ORIGIN}/inbox`;
      const failures: unknown[] = [];
      await deliverPush(env, db, {
        companyId: first.company_id,
        // The digest is not any one category — it is what a member asked to
        // have grouped. Sending it as `operational` is what stops the volume
        // control from being applied to the volume control's own output,
        // which would queue the digest and never send anything at all.
        category: "operational",
        failures,
        userIds: [first.user_id],
        // #430: every word is ours. A digest deliberately carries no customer
        // content — it is a count, which is the one thing a lock screen can
        // say about four different people without quoting any of them.
        content: { written: "us" },
        // One identity per member: a second digest REPLACES the first rather
        // than stacking. Somebody who was away for an hour should find one
        // notification, not twelve.
        collapseKey: `digest:${first.user_id}`,
        web: () => ({ title: "While you were away", body, url }),
        native: () => ({
          kind: "digest",
          title: "While you were away",
          body,
          url,
        }),
      });
      if (failures.length > 0) {
        console.error(
          `batch flush: ${failures.length} push(es) failed for ${first.user_id}`,
        );
      }
      summary.members += 1;
      summary.notifications += batch.length;
    } catch (cause) {
      // The rows are already claimed and deleted, so this batch is not
      // retried. That is the right trade: a retry loop would re-notify
      // everybody whose batch happened to share a tick with a broken one, and
      // every message in it is still sitting unread in the inbox.
      console.error(`batch flush: ${first.user_id} failed`, cause);
    }
  }

  return summary;
}
