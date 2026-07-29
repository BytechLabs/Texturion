/**
 * #236: "a new device signed in to your account."
 *
 * The sessions list only helps somebody who thinks to go and look at it.
 * Nobody looks until they already suspect something, and by then the phone
 * has been reading the company's customer messages for a week. This is the
 * message that makes them look — the one email in the product whose whole
 * purpose is to be ignored ninety-nine times and read once.
 *
 * Addressed to the ACCOUNT HOLDER, never to the owner or the workspace: a
 * sign-in is a fact about a person's account, they are the only one who knows
 * whether it was them, and telling a boss where an employee signed in from
 * would be surveillance rather than security.
 *
 * Best-effort throughout, and deliberately so — it rides `waitUntil`, so a
 * Resend outage, a suppressed address or a slow lookup can never turn the
 * first request from a new phone into a failed one.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Context } from "hono";

import type { AppEnv } from "../context";
import { sendEmail } from "../email/resend";
import { renderEmailHtml } from "../email/html";
import type { Env } from "../env";
import { requestClient, requestGeo } from "./request-origin";

const CLIENT_LABEL: Record<string, string> = {
  web: "a web browser",
  android: "an Android phone",
  ios: "an iPhone or iPad",
  unknown: "a new device",
};

/** Fire-and-forget: schedules the notice and returns immediately. */
export function announceNewDevice(
  c: Context<AppEnv>,
  env: Env,
  db: SupabaseClient,
  userId: string,
  sessionId: string,
): void {
  const client = requestClient(c);
  const geo = requestGeo(c);
  const work = deliver(env, db, userId, sessionId, client, geo).catch((cause) => {
    console.error(
      `new-device notice failed for session ${sessionId}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  });
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // No execution context (tests, and the `app.request()` path): the promise
    // is already running and already catches its own failures.
  }
}

async function deliver(
  env: Env,
  db: SupabaseClient,
  userId: string,
  sessionId: string,
  client: string,
  geo: { country: string | null; region: string | null; city: string | null },
): Promise<void> {
  const { data, error } = await db.auth.admin.getUserById(userId);
  if (error) throw new Error(`auth admin lookup failed: ${error.message}`);
  const to = data.user?.email;
  if (!to) return;

  const where = [geo.city, geo.region, geo.country].filter(Boolean).join(", ");
  const lines = [
    `Someone signed in to your Loonext account from ${CLIENT_LABEL[client] ?? CLIENT_LABEL.unknown}.`,
    "",
    where ? `Location (approximate): ${where}` : "Location: not available",
    `Time: ${new Date().toUTCString()}`,
    "",
    "If this was you, there is nothing to do.",
    "",
    "If it was not, open Settings → Signed-in devices and sign that device " +
      "out. It stops working immediately, and it stops receiving your " +
      "customers' messages.",
    "",
    `${env.APP_ORIGIN}/settings/devices`,
  ];
  const text = lines.join("\n");

  await sendEmail(env, {
    to,
    subject: "New sign-in to your account",
    text,
    html: renderEmailHtml(text),
    headers: {
      // Groups the thread in the recipient's client rather than stacking one
      // conversation per sign-in.
      "X-Entity-Ref-ID": sessionId,
    },
  });
}
