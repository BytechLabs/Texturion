import type { Ctx } from "../context";
import { FCM_NONPROD_PACKAGE, FCM_PER_DAY } from "../limits";
import { Refusal } from "../refusal";
import { dayOf, giveBack, tryTake } from "../state/counters";

/**
 * FCM (docs/RIG.md). One service account reaches every app in
 * the Firebase project, production's included, so every send is rewritten to
 * reach the nonprod Android package and nothing else: data plus an Android
 * block, any top-level notification moved into it, the iOS and web blocks
 * dropped, and `restricted_package_name` forced. Production's sender puts a
 * notification and an APNs block on every iOS alert
 * (apps/api/src/notifications/fcm.ts), which is why this rewrites rather than
 * refusing.
 *
 * What this cannot do: `restricted_package_name` binds Android deliveries
 * only, and FCM gives the sender no way to tell an iOS or web registration
 * token from an Android one. A token from production's iOS app would still
 * get the `data` block. The guard relies on the rig never holding one: its
 * database is synthetic, and every device that registers with it runs the
 * nonprod Android build.
 */
export const FCM_ORIGIN = "https://fcm.googleapis.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

type Item = Record<string, unknown>;

/** The message the guard sends instead of the one it was given. */
export function rewriteMessage(message: Item): Item {
  if (typeof message.token !== "string" || message.token === "") throw new Refusal("fcm.target_not_token");
  if (message.topic !== undefined || message.condition !== undefined) throw new Refusal("fcm.target_not_token");

  const android: Item =
    message.android && typeof message.android === "object" && !Array.isArray(message.android)
      ? { ...(message.android as Item) }
      : {};
  const notification = message.notification;
  if (notification && typeof notification === "object" && !Array.isArray(notification)) {
    const existing =
      android.notification && typeof android.notification === "object" ? (android.notification as Item) : {};
    android.notification = { ...(notification as Item), ...existing };
  }
  android.restricted_package_name = FCM_NONPROD_PACKAGE;

  const out: Item = { token: message.token, android };
  if (message.data && typeof message.data === "object" && !Array.isArray(message.data)) out.data = message.data;
  if (message.fcm_options && typeof message.fcm_options === "object") out.fcm_options = message.fcm_options;
  return out;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

export function parseServiceAccount(json: string | null): ServiceAccount | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<ServiceAccount>;
    if (
      typeof parsed.client_email !== "string" ||
      typeof parsed.private_key !== "string" ||
      typeof parsed.project_id !== "string" ||
      !/^[a-z0-9-]+$/.test(parsed.project_id)
    ) {
      return null;
    }
    return { client_email: parsed.client_email, private_key: parsed.private_key, project_id: parsed.project_id };
  } catch {
    return null;
  }
}

function base64Url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** A signed JWT-bearer assertion for Google's token endpoint. */
export async function signAssertion(account: ServiceAccount, nowMs: number): Promise<string> {
  const issued = Math.floor(nowMs / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: issued, exp: issued + 3600 }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
}

async function accessToken(ctx: Ctx, account: ServiceAccount): Promise<string> {
  const cached = ctx.memory.fcmToken;
  if (cached && cached.expiresAt > ctx.now() + 60_000) return cached.token;
  const assertion = await signAssertion(account, ctx.now());
  const response = await ctx.fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  const body = (await response.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!response.ok || typeof body?.access_token !== "string") {
    throw new Error(`FCM token exchange answered ${response.status}`);
  }
  const lifetime = typeof body.expires_in === "number" ? body.expires_in : 3600;
  ctx.memory.fcmToken = { token: body.access_token, expiresAt: ctx.now() + lifetime * 1000 };
  return body.access_token;
}

const SEND_PATH = /^\/v1\/projects\/[^/]+\/messages:send$/;

export async function handleFcm(ctx: Ctx, request: Request, path: string): Promise<Response> {
  if (request.method !== "POST" || !SEND_PATH.test(path)) throw new Refusal("fcm.path_refused");
  const account = parseServiceAccount(ctx.config.fcmServiceAccount);
  if (!account) throw new Refusal("fcm.key_missing");

  let body: Item;
  try {
    body = (await request.json()) as Item;
  } catch {
    throw new Refusal("request.body_invalid");
  }
  if (!body || typeof body !== "object" || !body.message || typeof body.message !== "object") {
    throw new Refusal("request.body_invalid");
  }
  const outgoing: Item = { message: rewriteMessage(body.message as Item) };
  if (body.validate_only === true) outgoing.validate_only = true;

  const day = dayOf(ctx.now());
  if (!(await tryTake(ctx, "fcm", day, 1, FCM_PER_DAY))) throw new Refusal("budget.fcm_day");

  const token = await accessToken(ctx, account);
  // The project is the guard's own service account's, whatever path the
  // caller used: the rig's dummy key names a project that is not real.
  const response = await ctx.fetch(`${FCM_ORIGIN}/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(outgoing),
  });
  const text = await response.text();
  if (response.status >= 400 && response.status <= 499 && response.status !== 404) await giveBack(ctx, "fcm", day, 1);
  return new Response(text || null, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}

/** The rig never needs a Google token: its FCM sender sends the guard caller token instead. */
export function handleFcmToken(): Response {
  return new Response(
    JSON.stringify({ access_token: "rig-guard-placeholder", token_type: "Bearer", expires_in: 3600 }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
