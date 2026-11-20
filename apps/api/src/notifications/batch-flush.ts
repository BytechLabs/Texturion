import { digestLine } from "@loonext/shared";
import type { Locale } from "@loonext/shared";

import { getDb } from "../db";
import type { Env } from "../env";
import { reportHandledFailure } from "../observability/capture";
import { deliverPush } from "./deliver";
import { DIGEST_PUSH_COPY } from "./digest-copy";

const MAX_MEMBERS_PER_TICK = 20;

export interface BatchFlushSummary {
  members: number;
  notifications: number;
}

interface NotificationBatch {
  company_id: string;
  user_id: string;
  counts: Record<string, number>;
  conversations: number;
  notifications: number;
}

export async function runBatchFlush(
  env: Env,
  now = new Date(),
): Promise<BatchFlushSummary> {
  const db = getDb(env);
  const summary: BatchFlushSummary = { members: 0, notifications: 0 };
  const leaseId = crypto.randomUUID();

  const { data, error } = await db.rpc("api_lease_notification_batches", {
    p_now: now.toISOString(),
    p_lease_id: leaseId,
    p_limit: MAX_MEMBERS_PER_TICK,
  });
  if (error) throw new Error(`lease notification batches failed: ${error.message}`);

  for (const batch of (data ?? []) as NotificationBatch[]) {
    try {
      let consumed = false;
      const consumeBatch = async (): Promise<boolean> => {
        const { data: consumedBatch, error: consumeError } = await db.rpc("api_consume_notification_batch", {
          p_company_id: batch.company_id,
          p_user_id: batch.user_id,
          p_lease_id: leaseId,
        });
        if (consumeError) throw new Error(consumeError.message);
        consumed = consumedBatch === true;
        return consumed;
      };

      if (batch.notifications === 0) {
        await consumeBatch();
        continue;
      }

      const counts = new Map(Object.entries(batch.counts));
      const digest = (locale: Locale) => ({
        title: DIGEST_PUSH_COPY[locale].title,
        body: digestLine(counts, batch.conversations, locale),
        url: `${env.APP_ORIGIN}/inbox`,
      });
      const failures: unknown[] = [];
      await deliverPush(env, db, {
        companyId: batch.company_id,
        category: "operational",
        userIds: [batch.user_id],
        content: { written: "us" },
        collapseKey: `digest:${batch.user_id}`,
        web: digest,
        native: (locale) => ({ kind: "digest", ...digest(locale) }),
        beforeDispatch: consumeBatch,
        failures,
      });
      if (failures.length > 0) {
        console.error(`batch flush: ${failures.length} push(es) failed for ${batch.user_id}`);
      }
      if (consumed) {
        summary.members += 1;
        summary.notifications += batch.notifications;
      }
    } catch (error_) {
      void reportHandledFailure(env, "notification-batch-flush", error_, {
        ids: { companyId: batch.company_id },
      });
    }
  }

  return summary;
}
