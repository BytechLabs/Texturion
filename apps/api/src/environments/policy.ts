import { isOwnDialedLeg } from "../calls/outbound-leg-gate";
import type { Env } from "../env";
import { deployEnv } from "./mode";

/**
 * D142: everything that differs between production, the rig and a laptop.
 *
 * Rig mode only ever ADDS a restriction, which is what makes it safe for the
 * rig to run production's code. Production and local get the permissive answer
 * from every function below except the start-up refusals: production refuses a
 * redirected vendor host and a database on the rig, and local refuses anything
 * that says it is really the rig. `policy.test.ts` asserts the inert answer for
 * every export, so a new function cannot quietly widen anything.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function hostnameOf(url: string | undefined): string | null {
  if (url === undefined) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isRigHost(url: string | undefined): boolean {
  const hostname = hostnameOf(url);
  if (hostname === null) return false;
  return hostname === "rig.internal" || hostname.endsWith(".rig.internal");
}

function isRigOrLoopbackHost(url: string | undefined): boolean {
  const hostname = hostnameOf(url);
  if (hostname === null) return false;
  return LOOPBACK_HOSTS.has(hostname) || isRigHost(url);
}

function hostIsOrUnder(url: string, domain: string): boolean {
  const hostname = hostnameOf(url);
  return hostname === domain || (hostname?.endsWith(`.${domain}`) ?? false);
}

/** A raw Telnyx v2 API key. The rig holds a guard caller token instead. */
const RAW_TELNYX_KEY = /^KEY[0-9A-Z_]{16,}/i;
const LIVE_STRIPE_KEY = /^(sk|rk)_live_/;

/**
 * Each redirects a vendor's traffic, and with it our credentials and our
 * customers' calls, texts, email or pushes, to whatever host it names.
 */
const VENDOR_SEAMS = [
  "TELNYX_API_BASE",
  "TELNYX_WEBHOOK_URL",
  "TELNYX_MEDIA_PUBLIC_BASE",
  "STRIPE_API_BASE",
  "RESEND_API_BASE",
  "FCM_API_BASE",
  "FCM_OAUTH_TOKEN_URL",
] as const;

/**
 * Configuration this deployment must refuse to start with. Variable names and
 * reasons only, never values: the values are secrets.
 */
export function deployPostureRefusals(env: Env): string[] {
  const mode = deployEnv(env);
  const refusals: string[] = [];

  // Unset means local, and local gets every permissive answer. A rig
  // configuration that lost its DEPLOY_ENV line would therefore boot with
  // none of the rig's gates, so anything only the rig sets is taken as proof
  // the flag is missing rather than ignored. Production is left out: there
  // the flag is stamped, and a stray variable it never reads is harmless.
  if (mode === "local") {
    for (const name of ["RIG_OWNED_E164", "RIG_ROBOT_WEBHOOK_ORIGIN"] as const) {
      if (env[name] !== undefined) {
        refusals.push(`${name} is set, which only the rig does, but DEPLOY_ENV is not rig`);
      }
    }
    for (const name of ["SUPABASE_URL", "SUPABASE_JWKS_URL", "APP_ORIGIN"] as const) {
      if (isRigHost(env[name])) {
        refusals.push(`${name} is a *.rig.internal host, but DEPLOY_ENV is not rig`);
      }
    }
  }

  if (mode === "production") {
    for (const name of VENDOR_SEAMS) {
      if (env[name] !== undefined) {
        refusals.push(`${name} is set, and production talks only to the vendor itself`);
      }
    }
    if (isRigOrLoopbackHost(env.SUPABASE_URL)) {
      refusals.push("SUPABASE_URL is a rig or loopback database");
    }
  }

  if (mode === "rig") {
    if (!isRigOrLoopbackHost(env.SUPABASE_URL)) {
      refusals.push("SUPABASE_URL is outside *.rig.internal and loopback");
    }
    if (!isRigOrLoopbackHost(env.SUPABASE_JWKS_URL)) {
      refusals.push("SUPABASE_JWKS_URL is outside *.rig.internal and loopback");
    }
    if (LIVE_STRIPE_KEY.test(env.STRIPE_SECRET_KEY)) {
      refusals.push("STRIPE_SECRET_KEY is a live key");
    }
    if (RAW_TELNYX_KEY.test(env.TELNYX_API_KEY)) {
      refusals.push("TELNYX_API_KEY is a raw Telnyx key, not a guard caller token");
    }
    if (
      env.TELNYX_API_BASE === undefined ||
      hostIsOrUnder(env.TELNYX_API_BASE, "telnyx.com")
    ) {
      refusals.push("TELNYX_API_BASE must point at the guard, not at Telnyx");
    }
    if (
      env.RESEND_API_BASE === undefined ||
      hostIsOrUnder(env.RESEND_API_BASE, "resend.com")
    ) {
      refusals.push("RESEND_API_BASE must point at the guard, not at Resend");
    }
    for (const name of ["FCM_API_BASE", "FCM_OAUTH_TOKEN_URL"] as const) {
      const value = env[name];
      if (value === undefined || hostIsOrUnder(value, "googleapis.com")) {
        refusals.push(`${name} must point at the guard, not at Google`);
      }
    }
    // Unset means "owns every number with no billing group", which is
    // production's whole fleet.
    if (env.TELNYX_BILLING_GROUP_ID === undefined) {
      refusals.push("TELNYX_BILLING_GROUP_ID is unset");
    }
  }

  return refusals;
}

/**
 * Sentry's `environment`. Production keeps the name its alerts and saved
 * searches already use, and a laptop keeps "development".
 */
export function sentryEnvironment(env: Env): string {
  switch (deployEnv(env)) {
    case "production":
      return "production";
    case "rig":
      return "rig";
    case "local":
      return "development";
  }
}

export function servesRigRoutes(env: Env): boolean {
  return deployEnv(env) === "rig";
}

/**
 * How an FCM send authenticates.
 *
 * `google` mints an OAuth token from the service account. On the rig the only
 * Google key is the guard's, the service account is a dummy, and the bearer is
 * the rig's guard caller token, the one TELNYX_API_KEY holds there (start-up
 * refuses a raw Telnyx key in that variable).
 */
export type FcmCredential = { kind: "google" } | { kind: "guard"; bearer: string };

export function fcmCredential(env: Env): FcmCredential {
  if (deployEnv(env) !== "rig") return { kind: "google" };
  return { kind: "guard", bearer: env.TELNYX_API_KEY };
}

const E164 = /^\+[1-9]\d{7,14}$/;

function rigOwnedNumbers(env: Env): Set<string> {
  return new Set(
    (env.RIG_OWNED_E164 ?? "")
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => E164.test(entry)),
  );
}

/**
 * The partition's numbers, and member SIP credentials.
 *
 * A credential URI is judged by the same structural test the call engine uses
 * to recognise its own legs, so `sip:+1…@sip.telnyx.com` (a phone number in a
 * SIP costume) is a phone number here too. Which credentials are the rig's is
 * the guard's question: only the guard can list the nonprod connection.
 */
function isRigEndpoint(env: Env, value: string): boolean {
  return isOwnDialedLeg(value) || rigOwnedNumbers(env).has(value);
}

export const RIG_DESTINATION_REFUSED = "rig_destination_refused";

export interface DestinationRefusal {
  code: typeof RIG_DESTINATION_REFUSED;
  /** Never carries the number: it is persisted on the message row and logged. */
  detail: string;
}

/**
 * The outbound destination gate, consulted before every text, dial, transfer
 * and verification code. Null means "send it".
 *
 * The guard enforces the same rule again, so this layer is what keeps a bug in
 * the app from depending on the guard alone.
 */
export function outboundDestinationRefusal(
  env: Env,
  destination: string,
): DestinationRefusal | null {
  if (deployEnv(env) !== "rig") return null;
  if (isRigEndpoint(env, destination.trim())) return null;
  return {
    code: RIG_DESTINATION_REFUSED,
    detail: "rig mode refuses a destination outside RIG_OWNED_E164",
  };
}

/**
 * The inbound half: may a call or text from this caller reach ring, voicemail,
 * transcription or text-back? Null means yes. A withheld caller is a stranger.
 */
export function inboundCallerRefusal(
  env: Env,
  caller: string | null | undefined,
): string | null {
  if (deployEnv(env) !== "rig") return null;
  if (isRigEndpoint(env, (caller ?? "").trim())) return null;
  return "rig mode refuses a caller outside RIG_OWNED_E164";
}

export const RIG_ENDPOINT_REFUSED = "rig_endpoint_refused";

/**
 * 10DLC, porting and hosted messaging act on the whole Telnyx account, so the
 * guard never forwards them from the rig. They are refused here too because
 * some of them text a number the request does not carry: a sole proprietor's
 * OTP goes to the mobile stored on the brand, which the destination gate
 * cannot see, and the guard would otherwise be all that stands between that
 * text and a stranger. `destination-gate.test.ts` keeps this list equal to the
 * endpoint registry's refused class.
 */
const ACCOUNT_WIDE_TELNYX_PATH =
  /^\/v2\/(?:10dlc|documents|messaging_hosted_number_orders|messaging_hosted_numbers|portability_checks|porting_orders)(?:\/|$)/;

/** Whether this Telnyx request may leave at all. Null means it may. */
export function telnyxRequestRefusal(env: Env, request: { path: string }): string | null {
  if (deployEnv(env) !== "rig") return null;
  return ACCOUNT_WIDE_TELNYX_PATH.test(request.path)
    ? "rig mode refuses a Telnyx endpoint that acts on the whole account"
    : null;
}

/** Stripe events from live mode never reach anything but production. */
export function liveStripeEventRefusal(
  env: Env,
  event: { livemode?: boolean | null },
): string | null {
  if (deployEnv(env) !== "rig") return null;
  return event.livemode === false ? null : "rig mode refuses live Stripe events";
}

/** In rig mode a customer webhook is delivered to the robot or nowhere. */
export function customerWebhookRefusal(env: Env, url: string): string | null {
  if (deployEnv(env) !== "rig") return null;
  const robot = env.RIG_ROBOT_WEBHOOK_ORIGIN;
  if (robot === undefined) {
    return "rig mode delivers webhooks only to RIG_ROBOT_WEBHOOK_ORIGIN, which is unset";
  }
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return "rig mode refuses an unparseable webhook URL";
  }
  return origin === robot ? null : "rig mode delivers webhooks only to the robot";
}

/**
 * What a messaging profile the rig creates is allowed to cost and reach.
 *
 * The guard refuses any profile above $0.06 a day or outside US and Canada,
 * and the partition budgets $0.03 a day for each tenant profile.
 */
export const RIG_MESSAGING_PROFILE_DAILY_LIMIT = "0.03";
const RIG_MESSAGING_DESTINATIONS = ["US", "CA"];

const MESSAGING_PROFILE_WRITE = /^\/v2\/messaging_profiles(?:\/[^/]+)?$/;

/**
 * A limit the rig may keep: a positive amount below its own. `Number` reads
 * null, "" and false as 0, and a profile sent `daily_spend_limit: null` with
 * the limit enabled may be read by Telnyx as no limit at all.
 */
function isLimitBelow(value: unknown, cap: number): boolean {
  if (typeof value === "string" ? value.trim() === "" : typeof value !== "number") {
    return false;
  }
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount < cap;
}

/**
 * The rig's narrowing of a Telnyx request body, applied by the Telnyx client
 * to every request. Production and local get the same object back.
 *
 * In rig mode a messaging-profile write is capped at the partition's daily
 * limit, and its destination whitelist can only shrink: a country the caller
 * asked for survives only if the rig allows it too.
 */
export function restrictTelnyxBody(
  env: Env,
  request: { method: string; path: string },
  body: unknown,
): unknown {
  if (deployEnv(env) !== "rig") return body;
  if (request.method !== "POST" && request.method !== "PATCH") return body;
  if (!MESSAGING_PROFILE_WRITE.test(request.path)) return body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) return body;

  const next: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  const asked = next.whitelisted_destinations;
  next.whitelisted_destinations = Array.isArray(asked)
    ? asked.filter((country) => RIG_MESSAGING_DESTINATIONS.includes(String(country)))
    : [...RIG_MESSAGING_DESTINATIONS];
  if (!isLimitBelow(next.daily_spend_limit, Number(RIG_MESSAGING_PROFILE_DAILY_LIMIT))) {
    next.daily_spend_limit = RIG_MESSAGING_PROFILE_DAILY_LIMIT;
  }
  next.daily_spend_limit_enabled = true;
  return next;
}
