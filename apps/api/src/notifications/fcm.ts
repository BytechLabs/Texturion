/**
 * FCM HTTP v1 sender (#151): native device push for Android (data-only
 * message — the app's own service renders it and high priority wakes Doze for
 * calls) and iOS (alert push via FCM's APNs bridge, with apns headers mapped
 * from our TTL/urgency). Pure WebCrypto + fetch — no dependency — mirroring
 * webpush.ts's contract: `sendFcm()` never throws for delivery outcomes; the
 * caller branches on `{ ok, gone }` (gone → drop the device_push_tokens row,
 * exactly like a Web Push 404/410).
 *
 * Auth is the Google service-account OAuth flow: an RS256 JWT (WebCrypto,
 * PKCS#8 key from the service-account JSON) asserted at
 * https://oauth2.googleapis.com/token for a ~1 h access token, cached in a
 * module-level var (~55 min, keyed by client_email) so an isolate mints one
 * token per hour, not one per push.
 *
 * FCM_SERVICE_ACCOUNT_JSON is OPTIONAL (#151: deploys stay green until the
 * founder provisions Firebase). The three §8 senders gate their native branch
 * on `isFcmConfigured()`; calling `sendFcm()` anyway without the secret is a
 * single-log no-op reported as a skipped success — never a thrown failure.
 */
import { z } from "zod";

import type { Env } from "../env";

import { encodeBase64Url } from "./webpush";

/** The device_push_tokens columns a send needs. */
export interface DevicePushTarget {
  platform: "android" | "ios";
  token: string;
}

export interface FcmResult {
  ok: boolean;
  status: number;
  /**
   * FCM 404 / errorCode UNREGISTERED: the device token is permanently dead
   * (app uninstalled / token rotated) — the caller deletes the row, mirroring
   * the Web Push 404/410 prune.
   */
  gone: boolean;
  /**
   * Bounded snippet of FCM's error body on a NON-OK response (#147 mirror):
   * the v1 API names the rejection (INVALID_ARGUMENT, SENDER_ID_MISMATCH,
   * QUOTA_EXCEEDED…) here — the lead for diagnosing a silent native-push
   * outage. Empty on a successful send.
   */
  errorBody: string;
}

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const OAUTH_JWT_LIFETIME_SECONDS = 3600; // Google's maximum assertion lifetime
/** Cache the access token well under its ~1 h life so a send never races expiry. */
const TOKEN_CACHE_MS = 55 * 60 * 1000;

/**
 * Cheap configuration probe for the §8 senders: `true` only when the Worker
 * carries the Firebase service-account secret, so callers can skip the
 * device_push_tokens query entirely (and log the no-op once) before Firebase
 * is provisioned.
 */
export function isFcmConfigured(env: Env): boolean {
  return (
    typeof env.FCM_SERVICE_ACCOUNT_JSON === "string" &&
    env.FCM_SERVICE_ACCOUNT_JSON.trim().length > 0
  );
}

/**
 * The subset of a Firebase service-account key file sendFcm needs. Unknown
 * keys in the JSON are ignored (the downloaded file carries ~10 more).
 */
const serviceAccountSchema = z.object({
  project_id: z.string().min(1),
  client_email: z.string().min(1),
  private_key: z.string().min(1), // PEM PKCS#8 ("-----BEGIN PRIVATE KEY-----")
});

type ServiceAccount = z.infer<typeof serviceAccountSchema>;

function parseServiceAccount(raw: string): ServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  const result = serviceAccountSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      "FCM_SERVICE_ACCOUNT_JSON is not a Firebase service-account key " +
        "(project_id/client_email/private_key missing)",
    );
  }
  return result.data;
}

/** PEM PKCS#8 → DER bytes (strip armor + whitespace, standard base64 decode). */
function pemToPkcs8(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----(?:BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error("FCM service-account private_key is not a PEM PKCS#8 key");
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const encoder = new TextEncoder();

/** Google OAuth service-account assertion: RS256 JWT over iss/scope/aud/exp. */
async function signOauthJwt(account: ServiceAccount): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(account.private_key) as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(
    encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const claims = encodeBase64Url(
    encoder.encode(
      JSON.stringify({
        iss: account.client_email,
        scope: FCM_SCOPE,
        aud: OAUTH_TOKEN_URL,
        iat: now,
        exp: now + OAUTH_JWT_LIFETIME_SECONDS,
      }),
    ),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      encoder.encode(`${header}.${claims}`),
    ),
  );
  return `${header}.${claims}.${encodeBase64Url(signature)}`;
}

interface CachedAccessToken {
  clientEmail: string;
  token: string;
  expiresAt: number;
}

/**
 * Module-level access-token cache, keyed by client_email (a rotated service
 * account invalidates it naturally). Isolate-lifetime, like env validation.
 */
let cachedAccessToken: CachedAccessToken | null = null;

async function getAccessToken(account: ServiceAccount): Promise<string> {
  const now = Date.now();
  if (
    cachedAccessToken !== null &&
    cachedAccessToken.clientEmail === account.client_email &&
    now < cachedAccessToken.expiresAt
  ) {
    return cachedAccessToken.token;
  }

  const assertion = await signOauthJwt(account);
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => ""))
      .slice(0, 300)
      .trim();
    throw new Error(
      `FCM OAuth token exchange failed with HTTP ${response.status}` +
        (detail ? ` — ${detail}` : ""),
    );
  }
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (typeof body.access_token !== "string" || body.access_token.length === 0) {
    throw new Error("FCM OAuth token exchange returned no access_token");
  }
  // Honor a shorter-than-usual grant (minus a safety margin), cap at ~55 min.
  const grantedMs =
    typeof body.expires_in === "number"
      ? body.expires_in * 1000 - 5 * 60 * 1000
      : TOKEN_CACHE_MS;
  cachedAccessToken = {
    clientEmail: account.client_email,
    token: body.access_token,
    expiresAt: now + Math.min(Math.max(grantedMs, 0), TOKEN_CACHE_MS),
  };
  return body.access_token;
}

/**
 * One FCM v1 message per platform, from the §8/#135 payload contracts
 * ({title, body, url} (+ kind:'call' for ringing calls) — the SAME JSON string
 * handed to sendWebPush):
 *
 *   android — DATA-ONLY message (the app's FirebaseMessagingService renders
 *             it; a `notification` field would let the OS auto-display and rob
 *             the app of the call-wake path), priority HIGH only for urgent
 *             sends (Doze wake is a budgeted resource), ttl from ttlSeconds.
 *   ios     — notification (alert) + data via the APNs bridge; TTL maps to
 *             apns-expiration (absolute epoch seconds), urgency to
 *             apns-priority (10 immediate / 5 power-considerate), and the
 *             caller's coalescing tag to apns-collapse-id (#162: repeats for
 *             one thread/call REPLACE in Notification Center instead of
 *             stacking — the iOS client can't retag a remote alert push, so
 *             coalescing is server-side by contract; Android coalesces
 *             client-side via notification tags and takes no collapse key).
 */
function buildMessage(
  target: DevicePushTarget,
  payload: string,
  ttlSeconds: number,
  urgency: "normal" | "high",
  collapseId?: string,
): Record<string, unknown> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    throw new Error("FCM payload is not a JSON object");
  }
  // FCM `data` values must be strings; the payload contracts already are.
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") data[key] = value;
  }

  if (target.platform === "android") {
    return {
      token: target.token,
      data,
      android: {
        priority: urgency === "high" ? "HIGH" : "NORMAL",
        ttl: `${ttlSeconds}s`,
      },
    };
  }
  const apnsHeaders: Record<string, string> = {
    "apns-priority": urgency === "high" ? "10" : "5",
    "apns-expiration": String(Math.floor(Date.now() / 1000) + ttlSeconds),
  };
  if (collapseId !== undefined && collapseId.length > 0) {
    // APNs rejects a collapse id over 64 bytes (our ids are ASCII, so
    // chars == bytes) — bound it rather than fail the whole send.
    apnsHeaders["apns-collapse-id"] = collapseId.slice(0, 64);
  }
  return {
    token: target.token,
    notification: {
      title: data.title ?? "",
      body: data.body ?? "",
    },
    data,
    apns: { headers: apnsHeaders },
  };
}

/**
 * Deliver one native device push. Never throws for delivery outcomes — the
 * caller branches on `{ ok, gone }` (gone → drop the device_push_tokens row);
 * only a malformed service account / payload or the OAuth exchange throws.
 * Unconfigured env (no Firebase yet) is a logged no-op success.
 */
export async function sendFcm(
  env: Env,
  target: DevicePushTarget,
  payload: string,
  ttlSeconds = 24 * 60 * 60,
  urgency: "normal" | "high" = "normal",
  /** iOS coalescing tag (#162): apns-collapse-id, e.g. `conversation:<id>`. */
  collapseId?: string,
): Promise<FcmResult> {
  if (!isFcmConfigured(env)) {
    console.log(
      "fcm: FCM_SERVICE_ACCOUNT_JSON unset — native device push skipped",
    );
    return { ok: true, status: 0, gone: false, errorBody: "" };
  }
  const account = parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON as string);
  const message = buildMessage(target, payload, ttlSeconds, urgency, collapseId);
  const accessToken = await getAccessToken(account);

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    },
  );
  // Success needs no body — drain to release the socket. On failure keep a
  // bounded diagnostic snippet (mirrors webpush.ts #147).
  let errorBody = "";
  if (response.ok) {
    await response.body?.cancel();
  } else {
    try {
      errorBody = (await response.text()).slice(0, 300).trim();
    } catch {
      /* body unreadable — status alone still tells the story */
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    // FCM signals a dead token as HTTP 404 with errorCode UNREGISTERED; check
    // both (belt-and-braces if the snippet clipped or the status ever shifts).
    gone: response.status === 404 || errorBody.includes("UNREGISTERED"),
    errorBody,
  };
}
