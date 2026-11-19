import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { captureException } from "../observability/capture";

const MINUTE_MS = 60_000;
const EXTENDED_BACKOFF_MINUTES = [2, 5, 15, 60, 180, 360, 720, 1440] as const;
const EXTENDED_TELNYX_PREFIXES = ["message.", "10dlc.", "porting_order.", "portout."] as const;
const SHORT_ATTEMPT_LIMIT = 5;
const SHORT_RETRY_MINUTES = 10;

export const WEBHOOK_REPLAY_LIMIT = EXTENDED_BACKOFF_MINUTES.length + 1;
export const WEBHOOK_REPLAY_FAMILIES = [
  `attempts.lte.${SHORT_ATTEMPT_LIMIT}`,
  "provider.in.(stripe,resend)",
  ...EXTENDED_TELNYX_PREFIXES.map((prefix) => `event_type.like.${prefix}*`),
].join(",");

interface WebhookLedgerEvent {
  provider: "telnyx" | "stripe" | "resend";
  eventId: string;
  eventType: string;
}

export function nextWebhookAttempt(
  event: Pick<WebhookLedgerEvent, "provider" | "eventType">,
  attempt: number,
  now: number,
): string | null {
  const extended = event.provider !== "telnyx" ||
    EXTENDED_TELNYX_PREFIXES.some((prefix) => event.eventType.startsWith(prefix));
  const minutes = extended
    ? EXTENDED_BACKOFF_MINUTES[attempt - 1]
    : attempt < SHORT_ATTEMPT_LIMIT ? SHORT_RETRY_MINUTES : undefined;
  return minutes === undefined ? null : new Date(now + minutes * MINUTE_MS).toISOString();
}

export async function recordWebhookFailure(
  env: Env,
  db: SupabaseClient,
  event: WebhookLedgerEvent,
  recordedAttempts: number,
  attempt: number,
  message: string,
): Promise<void> {
  const now = Date.now();
  const nextAttemptAt = nextWebhookAttempt(event, attempt, now);
  const { data, error } = await db
    .from("webhook_events")
    .update({
      attempts: attempt,
      claimed_at: null,
      next_attempt_at: nextAttemptAt,
      abandoned_at: nextAttemptAt === null ? new Date(now).toISOString() : null,
      last_error: message.slice(0, 2000),
    })
    .eq("provider", event.provider)
    .eq("event_id", event.eventId)
    .eq("attempts", recordedAttempts)
    .is("processed_at", null)
    .is("abandoned_at", null)
    .select("event_id");
  if (error) {
    console.error(`webhook failure stamp failed for ${event.provider} ${event.eventId}: ${error.message}`);
    return;
  }
  if (!data?.length) return;

  const context = {
    source: "cron" as const,
    job: "job:sweep-webhooks",
    extra: {
      provider: event.provider,
      event_id: event.eventId,
      event_type: event.eventType,
      attempts: attempt,
    },
  };
  if (attempt === SHORT_ATTEMPT_LIMIT) {
    void captureException(env, `webhook replay failed ${attempt} times`, context);
  }
  if (nextAttemptAt === null) {
    void captureException(env, "webhook replay abandoned", context);
  }
}
