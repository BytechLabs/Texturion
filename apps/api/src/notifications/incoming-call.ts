/**
 * Push-to-wake (#135): alert every ringing member on their PHONE the moment an
 * inbound call arrives, so a mobile browser tab that's been suspended (and so
 * can't render the in-app ring) still surfaces the call. High urgency + a short
 * TTL — the call is only live for the ring window, so a late-delivered push is
 * noise, not a ring.
 *
 * Best-effort by contract: a push failure (dead subscription, push-service
 * weather) must NEVER disturb the ring / voicemail path, so this never throws.
 * Dead subscriptions (404/410) are pruned opportunistically.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";

import { sendWebPush } from "./webpush";

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** How long a ringing-call push is worth delivering (≈ the ring window). */
const CALL_PUSH_TTL_SECS = 30;

export async function notifyIncomingCall(
  env: Env,
  db: SupabaseClient,
  input: { userIds: string[]; caller: string | null },
): Promise<void> {
  if (input.userIds.length === 0) return;

  const { data, error } = await db
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", input.userIds);
  if (error || !data || data.length === 0) return; // best-effort — never throw
  const subscriptions = data as SubscriptionRow[];

  const payload = JSON.stringify({
    kind: "call", // the service worker renders this as an urgent call alert
    title: "Incoming call",
    body: input.caller ?? "Someone is calling your business number",
    url: "/calls",
  });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        const result = await sendWebPush(
          env,
          sub,
          payload,
          CALL_PUSH_TTL_SECS,
          "high",
        );
        if (result.gone) {
          await db.from("push_subscriptions").delete().eq("id", sub.id);
        }
      } catch {
        /* push weather must never break a live call */
      }
    }),
  );
}
