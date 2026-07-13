/**
 * Web Push protocol client (SPEC §8: email + Web Push are BOTH MVP channels;
 * the VAPID key pair lives in Worker secrets). Pure WebCrypto + fetch — no
 * dependency — implementing:
 *
 *   RFC 8291  Message Encryption for Web Push (`aes128gcm`: ECDH P-256 +
 *             HKDF-SHA-256 + AES-128-GCM, single record).
 *   RFC 8292  VAPID (`Authorization: vapid t=<ES256 JWT>, k=<public key>`).
 *
 * Key encodings are the ecosystem standard (what `web-push
 * generate-vapid-keys` and `PushSubscription.toJSON()` produce): base64url
 * uncompressed P-256 points (65 bytes, 0x04-prefixed), a base64url 32-byte
 * private scalar, and a base64url 16-byte auth secret.
 */
import type { Env } from "../env";

/** The §6 push_subscriptions columns a send needs. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushResult {
  ok: boolean;
  status: number;
  /**
   * HTTP 404/410 from the push service: the subscription is permanently dead
   * (browser unsubscribed / expired) — the caller deletes the row.
   */
  gone: boolean;
  /**
   * A bounded snippet of the push service's error body on a NON-OK response
   * (#147): FCM/Mozilla explain the rejection here (e.g. a VAPID key mismatch),
   * which is the lead for diagnosing a silent push-to-wake outage. Empty on a
   * successful send (we never read the body then). Never contains our payload —
   * it's the service's own diagnostic text.
   */
  errorBody: string;
}

const UNCOMPRESSED_POINT_BYTES = 65;
const AUTH_SECRET_BYTES = 16;
const RECORD_SIZE = 4096; // single-record payloads are far below this
const JWT_TTL_SECONDS = 12 * 60 * 60; // RFC 8292 caps `exp` at 24 h

export function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decode + shape-check a subscriber `p256dh` key (65-byte 0x04 point). */
export function decodeSubscriberKey(p256dh: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Url(p256dh);
  } catch {
    throw new Error("p256dh is not base64url");
  }
  if (bytes.length !== UNCOMPRESSED_POINT_BYTES || bytes[0] !== 0x04) {
    throw new Error("p256dh is not an uncompressed P-256 public key");
  }
  return bytes;
}

/** Decode + shape-check a subscriber `auth` secret (16 bytes). */
export function decodeAuthSecret(auth: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Url(auth);
  } catch {
    throw new Error("auth is not base64url");
  }
  if (bytes.length !== AUTH_SECRET_BYTES) {
    throw new Error("auth is not a 16-byte Web Push auth secret");
  }
  return bytes;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** HKDF-SHA-256 (extract + expand) via WebCrypto. */
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

const encoder = new TextEncoder();

/**
 * RFC 8291 `aes128gcm` encryption: one record, the application-server ECDH
 * key pair is ephemeral per message (forward secrecy as specified).
 */
export async function encryptPushPayload(
  target: PushTarget,
  payload: string,
): Promise<Uint8Array> {
  const subscriberKeyBytes = decodeSubscriberKey(target.p256dh);
  const authSecret = decodeAuthSecret(target.auth);

  const subscriberKey = await crypto.subtle.importKey(
    "raw",
    subscriberKeyBytes as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ephemeral = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const serverKeyBytes = new Uint8Array(
    (await crypto.subtle.exportKey("raw", ephemeral.publicKey)) as ArrayBuffer,
  );

  // Standard EcdhKeyDeriveParams: the field is `public` at runtime (workerd
  // and Node agree); workers-types spells it `$public` in its declarations.
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: subscriberKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      ephemeral.privateKey,
      256,
    ),
  );

  // RFC 8291 §3.3–3.4: IKM ← HKDF(auth_secret, ecdh_secret, key_info);
  // CEK/NONCE ← HKDF(salt, IKM, aes128gcm/nonce info).
  const keyInfo = concatBytes(
    encoder.encode("WebPush: info\0"),
    subscriberKeyBytes,
    serverKeyBytes,
  );
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(
    salt,
    ikm,
    encoder.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await hkdf(
    salt,
    ikm,
    encoder.encode("Content-Encoding: nonce\0"),
    12,
  );

  // RFC 8188 §2: single (final) record = plaintext || 0x02 delimiter.
  const record = concatBytes(encoder.encode(payload), new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey(
    "raw",
    contentKey as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, record as BufferSource),
  );

  // RFC 8188 header: salt(16) | rs(4, big-endian) | idlen(1) | keyid(65).
  const header = new Uint8Array(16 + 4 + 1 + serverKeyBytes.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = serverKeyBytes.length;
  header.set(serverKeyBytes, 21);
  return concatBytes(header, ciphertext);
}

/** Import the VAPID signing key from the env's standard-encoded pair. */
async function importVapidKey(env: Env): Promise<CryptoKey> {
  const publicBytes = decodeSubscriberKey(env.VAPID_PUBLIC_KEY);
  const privateBytes = decodeBase64Url(env.VAPID_PRIVATE_KEY);
  if (privateBytes.length !== 32) {
    throw new Error("VAPID_PRIVATE_KEY is not a 32-byte P-256 scalar");
  }
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: encodeBase64Url(publicBytes.slice(1, 33)),
      y: encodeBase64Url(publicBytes.slice(33, 65)),
      d: encodeBase64Url(privateBytes),
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/**
 * RFC 8292 VAPID JWT: ES256 over `{ aud: <push service origin>, exp, sub }`.
 * WebCrypto ECDSA emits the raw 64-byte r||s signature JWS requires.
 */
export async function vapidAuthorization(
  env: Env,
  endpoint: string,
): Promise<string> {
  const key = await importVapidKey(env);
  const header = encodeBase64Url(
    encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })),
  );
  const claims = encodeBase64Url(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS,
        sub: env.APP_ORIGIN, // RFC 8292 §2.1 contact URI (https form)
      }),
    ),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      encoder.encode(`${header}.${claims}`),
    ),
  );
  const jwt = `${header}.${claims}.${encodeBase64Url(signature)}`;
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`;
}

/**
 * Deliver one push message. Never throws for delivery outcomes — the caller
 * branches on `{ ok, gone }` (410/404 → drop the subscription, SPEC §8);
 * only malformed subscription keys / local crypto failures throw.
 */
export async function sendWebPush(
  env: Env,
  target: PushTarget,
  payload: string,
  ttlSeconds = 24 * 60 * 60,
  urgency: "normal" | "high" = "normal",
): Promise<PushResult> {
  const [authorization, body] = await Promise.all([
    vapidAuthorization(env, target.endpoint),
    encryptPushPayload(target, payload),
  ]);
  const response = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      TTL: String(ttlSeconds),
      // A ringing call needs immediate delivery + device wake; a message push
      // is normal. (Web Push urgency, RFC 8030 §5.3.)
      Urgency: urgency,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
    },
    body: body as BodyInit,
  });
  // On success there's no body we need — drain to release the socket. On a
  // NON-OK response, keep a bounded snippet of the service's error text (#147):
  // it's the diagnostic lead for a silent push outage (a VAPID mismatch etc.).
  let errorBody = "";
  if (response.ok) {
    await response.body?.cancel();
  } else {
    try {
      errorBody = (await response.text()).slice(0, 300).trim();
    } catch {
      /* body already consumed / not text — status alone still tells the story */
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    gone: response.status === 404 || response.status === 410,
    errorBody,
  };
}
