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
import { isLocale, resolveLocale } from "@loonext/shared";
import type { Locale } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Context } from "hono";

import type { AppEnv } from "../context";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { reportHandledFailure } from "../observability/capture";
import { requestClient, requestGeo } from "./request-origin";
import type { ClientKind } from "./request-origin";

const CLIENT_LABEL: Record<Locale, Record<ClientKind, string>> = {
  en: {
    web: "a web browser",
    android: "an Android phone",
    ios: "an iPhone or iPad",
    unknown: "a new device",
  },
  "fr-CA": {
    web: "un navigateur Web",
    android: "un téléphone Android",
    ios: "un iPhone ou un iPad",
    unknown: "un nouvel appareil",
  },
};

const DEVICE_NOTICE = {
  en: {
    subject: "New sign-in to your account",
    intro: (device: string) => `Someone signed in to your Loonext account from ${device}.`,
    location: (where: string) => where ? `Location (approximate): ${where}` : "Location: not available",
    time: (date: Date) => `Time: ${date.toUTCString()}`,
    expected: "If this was you, there is nothing to do.",
    unexpected: "If it was not, open Settings → Signed-in devices and sign that device " +
      "out. It stops working immediately, and it stops receiving your customers' messages.",
  },
  "fr-CA": {
    subject: "Nouvelle connexion à votre compte",
    intro: (device: string) => `Quelqu’un s’est connecté à votre compte Loonext depuis ${device}.`,
    location: (where: string) => where ? `Lieu approximatif : ${where}` : "Lieu : non disponible",
    time: (date: Date) => `Heure (UTC) : ${date.toLocaleString("fr-CA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    })}`,
    expected: "Si c’était vous, vous n’avez rien à faire.",
    unexpected: "Si vous ne reconnaissez pas cette connexion, ouvrez Paramètres → Appareils connectés " +
      "et déconnectez l’appareil. Il perdra aussitôt l’accès à Loonext et ne recevra plus les messages de vos clients.",
  },
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
  const work = deliver(env, db, userId, sessionId, client, geo).catch((error: unknown) =>
    reportHandledFailure(env, "new-device-notice", error)
  );
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
  client: ClientKind,
  geo: { country: string | null; region: string | null; city: string | null },
): Promise<void> {
  const [{ data, error }, profile] = await Promise.all([
    db.auth.admin.getUserById(userId),
    db.from("profiles").select("locale").eq("user_id", userId).maybeSingle(),
  ]);
  if (error) throw new Error(`auth admin lookup failed: ${error.message}`);
  const to = data.user?.email;
  if (!to) return;

  const savedLocale: unknown = data.user?.user_metadata?.locale;
  const locale = resolveLocale(profile.data?.locale, isLocale(savedLocale) ? savedLocale : null);
  const copy = DEVICE_NOTICE[locale];
  const labels = CLIENT_LABEL[locale];
  const where = [geo.city, geo.region, geo.country].filter(Boolean).join(", ");
  const lines = [
    copy.intro(labels[client]),
    "",
    copy.location(where),
    copy.time(new Date()),
    "",
    copy.expected,
    "",
    copy.unexpected,
    "",
    `${env.APP_ORIGIN}/settings/devices`,
  ];
  const text = lines.join("\n");

  await sendEmail(env, {
    to,
    subject: copy.subject,
    text,
    locale,
    html: renderEmailHtml(text, locale),
    headers: {
      // Groups the thread in the recipient's client rather than stacking one
      // conversation per sign-in.
      "X-Entity-Ref-ID": sessionId,
    },
  });
}
