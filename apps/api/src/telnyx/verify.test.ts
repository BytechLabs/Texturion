import { beforeAll, describe, expect, it } from "vitest";

import { verifyTelnyxWebhook } from "./verify";
import { completeEnv } from "../test/support";
import type { Env } from "../env";

/**
 * Ed25519 verification against a REAL keypair generated in the test (D13):
 * the signatures are produced by WebCrypto exactly the way Telnyx produces
 * them — over the bytes of `"{timestamp}|{raw_body}"`.
 */

let keyPair: CryptoKeyPair;
let env: Env;
let foreignKeyPair: CryptoKeyPair;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function exportPublicKeyBase64(pair: CryptoKeyPair): Promise<string> {
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
  );
  return toBase64(raw);
}

async function sign(
  pair: CryptoKeyPair,
  timestamp: string,
  body: string,
): Promise<string> {
  const payload = new TextEncoder().encode(`${timestamp}|${body}`);
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    pair.privateKey,
    payload,
  );
  return toBase64(new Uint8Array(signature));
}

function webhookRequest(
  body: string,
  headers: Record<string, string>,
): Request {
  return new Request("https://api.loonext.app/webhooks/telnyx", {
    method: "POST",
    headers,
    body,
  });
}

const PAYLOAD = JSON.stringify({
  data: {
    event_type: "message.received",
    id: "evt_1",
    payload: { text: "hello" },
  },
});

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

beforeAll(async () => {
  keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  foreignKeyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  env = { ...completeEnv(), TELNYX_PUBLIC_KEY: await exportPublicKeyBase64(keyPair) };
});

describe("verifyTelnyxWebhook", () => {
  it("returns the parsed payload for a valid signature", async () => {
    const timestamp = nowSeconds();
    const signature = await sign(keyPair, timestamp, PAYLOAD);
    const result = await verifyTelnyxWebhook(
      env,
      webhookRequest(PAYLOAD, {
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": timestamp,
      }),
    );
    expect(result).toEqual(JSON.parse(PAYLOAD));
  });

  it("leaves the request body readable for the caller", async () => {
    const timestamp = nowSeconds();
    const signature = await sign(keyPair, timestamp, PAYLOAD);
    const request = webhookRequest(PAYLOAD, {
      "telnyx-signature-ed25519": signature,
      "telnyx-timestamp": timestamp,
    });
    await verifyTelnyxWebhook(env, request);
    expect(await request.text()).toBe(PAYLOAD);
  });

  it("rejects a timestamp older than 5 minutes", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 301);
    const signature = await sign(keyPair, timestamp, PAYLOAD);
    const result = await verifyTelnyxWebhook(
      env,
      webhookRequest(PAYLOAD, {
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": timestamp,
      }),
    );
    expect(result).toBeNull();
  });

  it("rejects a timestamp more than 5 minutes in the future", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000) + 301);
    const signature = await sign(keyPair, timestamp, PAYLOAD);
    const result = await verifyTelnyxWebhook(
      env,
      webhookRequest(PAYLOAD, {
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": timestamp,
      }),
    );
    expect(result).toBeNull();
  });

  it("accepts a timestamp just inside the tolerance window", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 295);
    const signature = await sign(keyPair, timestamp, PAYLOAD);
    const result = await verifyTelnyxWebhook(
      env,
      webhookRequest(PAYLOAD, {
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": timestamp,
      }),
    );
    expect(result).not.toBeNull();
  });

  it("rejects a tampered body (signature no longer matches)", async () => {
    const timestamp = nowSeconds();
    const signature = await sign(keyPair, timestamp, PAYLOAD);
    const tampered = PAYLOAD.replace("hello", "hacked");
    const result = await verifyTelnyxWebhook(
      env,
      webhookRequest(tampered, {
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": timestamp,
      }),
    );
    expect(result).toBeNull();
  });

  it("rejects a signature minted with a different key", async () => {
    const timestamp = nowSeconds();
    const signature = await sign(foreignKeyPair, timestamp, PAYLOAD);
    const result = await verifyTelnyxWebhook(
      env,
      webhookRequest(PAYLOAD, {
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": timestamp,
      }),
    );
    expect(result).toBeNull();
  });

  it("rejects a timestamp the signature was not minted for (replay)", async () => {
    const signedTimestamp = nowSeconds();
    const signature = await sign(keyPair, signedTimestamp, PAYLOAD);
    const otherTimestamp = String(Number(signedTimestamp) - 60);
    const result = await verifyTelnyxWebhook(
      env,
      webhookRequest(PAYLOAD, {
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": otherTimestamp,
      }),
    );
    expect(result).toBeNull();
  });

  it("rejects garbage in the signature header", async () => {
    const timestamp = nowSeconds();
    for (const garbage of ["not-base64!!!", "", "AAAA", toBase64(new Uint8Array(64))]) {
      const result = await verifyTelnyxWebhook(
        env,
        webhookRequest(PAYLOAD, {
          "telnyx-signature-ed25519": garbage,
          "telnyx-timestamp": timestamp,
        }),
      );
      expect(result).toBeNull();
    }
  });

  it("rejects missing headers", async () => {
    const timestamp = nowSeconds();
    const signature = await sign(keyPair, timestamp, PAYLOAD);
    expect(
      await verifyTelnyxWebhook(
        env,
        webhookRequest(PAYLOAD, { "telnyx-timestamp": timestamp }),
      ),
    ).toBeNull();
    expect(
      await verifyTelnyxWebhook(
        env,
        webhookRequest(PAYLOAD, { "telnyx-signature-ed25519": signature }),
      ),
    ).toBeNull();
  });

  it("rejects a non-numeric timestamp header", async () => {
    const signature = await sign(keyPair, "soon", PAYLOAD);
    const result = await verifyTelnyxWebhook(
      env,
      webhookRequest(PAYLOAD, {
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": "soon",
      }),
    );
    expect(result).toBeNull();
  });

  it("rejects a validly-signed body that is not a JSON object", async () => {
    for (const body of ["[1,2,3]", '"just a string"', "not json at all"]) {
      const timestamp = nowSeconds();
      const signature = await sign(keyPair, timestamp, body);
      const result = await verifyTelnyxWebhook(
        env,
        webhookRequest(body, {
          "telnyx-signature-ed25519": signature,
          "telnyx-timestamp": timestamp,
        }),
      );
      expect(result).toBeNull();
    }
  });

  it("returns null (not a throw) when TELNYX_PUBLIC_KEY is malformed", async () => {
    const timestamp = nowSeconds();
    const signature = await sign(keyPair, timestamp, PAYLOAD);
    const badEnv = { ...env, TELNYX_PUBLIC_KEY: "definitely-not-a-key" };
    const result = await verifyTelnyxWebhook(
      badEnv,
      webhookRequest(PAYLOAD, {
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": timestamp,
      }),
    );
    expect(result).toBeNull();
  });
});
