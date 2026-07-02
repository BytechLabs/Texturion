/**
 * Web Push client suite (SPEC §8): REAL RFC 8291 crypto round-tripped — the
 * test plays the browser (generates a genuine subscription key pair + auth
 * secret) and the push service (captures the POST), then decrypts the
 * aes128gcm body with the receiver-side algorithm and verifies the RFC 8292
 * VAPID JWT against the env's public key. Only the network edge is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import {
  decodeBase64Url,
  encodeBase64Url,
  encryptPushPayload,
  sendWebPush,
  vapidAuthorization,
} from "./webpush";

const env = completeEnv();
const ENDPOINT = "https://push.example.net/send/abc123";

afterEach(() => {
  vi.unstubAllGlobals();
});

const encoder = new TextEncoder();

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    ikm as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: salt as BufferSource,
        info: info as BufferSource,
      },
      key,
      length * 8,
    ),
  );
}

/** A real browser-side subscription (what PushSubscription.toJSON carries). */
async function makeSubscription() {
  const uaKeys = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const uaPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", uaKeys.publicKey)) as ArrayBuffer,
  );
  return {
    uaKeys,
    authSecret,
    uaPublic,
    target: {
      endpoint: ENDPOINT,
      p256dh: encodeBase64Url(uaPublic),
      auth: encodeBase64Url(authSecret),
    },
  };
}

/** RFC 8291 receiver: exactly what the browser's push stack does. */
async function decryptPush(
  body: Uint8Array,
  uaKeys: CryptoKeyPair,
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
): Promise<string> {
  const salt = body.slice(0, 16);
  const recordSize = new DataView(
    body.buffer,
    body.byteOffset,
    body.byteLength,
  ).getUint32(16);
  expect(recordSize).toBe(4096);
  const keyIdLength = body[20];
  expect(keyIdLength).toBe(65); // uncompressed P-256 point
  const serverPublic = body.slice(21, 21 + keyIdLength);
  const ciphertext = body.slice(21 + keyIdLength);

  const serverKey = await crypto.subtle.importKey(
    "raw",
    serverPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      // Standard EcdhKeyDeriveParams (`public` at runtime; workers-types
      // spells the declaration `$public`).
      { name: "ECDH", public: serverKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      uaKeys.privateKey,
      256,
    ),
  );
  const keyInfo = concatBytes(
    encoder.encode("WebPush: info\0"),
    uaPublic,
    serverPublic,
  );
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(
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
  const aesKey = await crypto.subtle.importKey(
    "raw",
    cek as BufferSource,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const record = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      aesKey,
      ciphertext as BufferSource,
    ),
  );
  // Strip the RFC 8188 last-record delimiter (0x02) + any zero padding.
  let end = record.length - 1;
  while (end >= 0 && record[end] === 0) end -= 1;
  expect(record[end]).toBe(0x02);
  return new TextDecoder().decode(record.slice(0, end));
}

/** Push-service double: captures the request and answers with `status`. */
function pushServiceRoute(status: number) {
  const captured: { headers?: Headers; body?: Uint8Array } = {};
  const route: FetchRoute = async (url, request) => {
    if (!url.href.startsWith(ENDPOINT)) return undefined;
    captured.headers = request.headers;
    captured.body = new Uint8Array(await request.clone().arrayBuffer());
    return new Response(null, { status });
  };
  return { route, captured };
}

describe("sendWebPush (RFC 8291 + RFC 8292)", () => {
  it("posts an aes128gcm body the subscriber can decrypt back to the payload", async () => {
    const subscription = await makeSubscription();
    const service = pushServiceRoute(201);
    stubFetch(service.route);

    const payload = JSON.stringify({
      title: "Dana Smith",
      body: "Hi, do you do gutters? We're on Elm St and the last storm wrecked ours…",
      url: `${env.APP_ORIGIN}/conversations/bbbbbbbb-0000-4000-8000-00000000000b`,
    });
    const result = await sendWebPush(env, subscription.target, payload);
    expect(result).toEqual({ ok: true, status: 201, gone: false });

    expect(service.captured.headers?.get("content-encoding")).toBe("aes128gcm");
    expect(service.captured.headers?.get("ttl")).toBe(String(24 * 60 * 60));
    expect(service.captured.headers?.get("content-type")).toBe(
      "application/octet-stream",
    );

    const decrypted = await decryptPush(
      service.captured.body!,
      subscription.uaKeys,
      subscription.uaPublic,
      subscription.authSecret,
    );
    expect(decrypted).toBe(payload);
  });

  it("carries a VAPID authorization the push service can verify", async () => {
    const subscription = await makeSubscription();
    const service = pushServiceRoute(201);
    stubFetch(service.route);

    await sendWebPush(env, subscription.target, "hello");

    const authorization = service.captured.headers?.get("authorization") ?? "";
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(authorization);
    expect(match).not.toBeNull();
    const [, jwt, publicKey] = match!;
    expect(publicKey).toBe(env.VAPID_PUBLIC_KEY);

    const [header, claims, signature] = jwt.split(".");
    const verifyKey = await crypto.subtle.importKey(
      "raw",
      decodeBase64Url(publicKey) as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifyKey,
      decodeBase64Url(signature) as BufferSource,
      encoder.encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);

    const decodedHeader = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(header)),
    );
    expect(decodedHeader).toEqual({ typ: "JWT", alg: "ES256" });
    const decodedClaims = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(claims)),
    );
    expect(decodedClaims.aud).toBe("https://push.example.net");
    expect(decodedClaims.sub).toBe(env.APP_ORIGIN);
    const now = Math.floor(Date.now() / 1000);
    expect(decodedClaims.exp).toBeGreaterThan(now);
    expect(decodedClaims.exp).toBeLessThanOrEqual(now + 24 * 60 * 60); // RFC 8292 cap
  });

  it("uses a fresh ephemeral server key per message (forward secrecy)", async () => {
    const subscription = await makeSubscription();
    const first = await encryptPushPayload(subscription.target, "one");
    const second = await encryptPushPayload(subscription.target, "one");
    expect(encodeBase64Url(first.slice(21, 86))).not.toBe(
      encodeBase64Url(second.slice(21, 86)),
    );
  });

  it("reports gone for 404/410 and ok:false for other failures", async () => {
    const subscription = await makeSubscription();
    for (const [status, gone] of [
      [410, true],
      [404, true],
      [500, false],
      [429, false],
    ] as const) {
      const service = pushServiceRoute(status);
      stubFetch(service.route);
      const result = await sendWebPush(env, subscription.target, "x");
      expect(result).toEqual({ ok: false, status, gone });
      vi.unstubAllGlobals();
    }
  });

  it("rejects malformed subscription keys before touching the network", async () => {
    stubFetch(); // any fetch would fail the test loudly
    await expect(
      sendWebPush(
        env,
        { endpoint: ENDPOINT, p256dh: "not-a-key", auth: "bm9wZQ" },
        "x",
      ),
    ).rejects.toThrow(/p256dh/);
  });

  it("vapidAuthorization scopes the JWT audience to the endpoint origin", async () => {
    const authorization = await vapidAuthorization(
      env,
      "https://fcm.googleapis.com/fcm/send/xyz",
    );
    const jwt = /t=([^,]+),/.exec(authorization)![1];
    const claims = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(jwt.split(".")[1])),
    );
    expect(claims.aud).toBe("https://fcm.googleapis.com");
  });
});
