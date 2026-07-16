/**
 * Test-only FCM doubles (#151): a REAL RSA-2048 key pair exported as the PEM
 * PKCS#8 `private_key` a downloaded Firebase service-account JSON carries — so
 * fcm.ts's WebCrypto import/sign paths run for real in tests — plus fetch
 * routes playing Google's OAuth token endpoint and the FCM v1 send endpoint
 * (capturing every assertion/message for assertions). Only the network edge
 * is ever stubbed (D13).
 */
import type { Env } from "../env";
import { completeEnv, type FetchRoute } from "./support";

export interface TestServiceAccount {
  /** The FCM_SERVICE_ACCOUNT_JSON secret value (key file shape). */
  json: string;
  projectId: string;
  clientEmail: string;
  /** Verifies the RS256 OAuth assertion fcm.ts signs. */
  publicKey: CryptoKey;
}

/**
 * A fresh service account per call: the default unique client_email keeps
 * fcm.ts's module-level access-token cache (keyed by client_email) from
 * bleeding one test's token into the next.
 */
export async function makeServiceAccount(
  clientEmail = `fcm-${crypto.randomUUID()}@loonext-test.iam.gserviceaccount.com`,
  projectId = "loonext-test",
): Promise<TestServiceAccount> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = new Uint8Array(
    (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer,
  );
  const base64 = btoa(String.fromCharCode(...der));
  const pem =
    "-----BEGIN PRIVATE KEY-----\n" +
    `${base64.match(/.{1,64}/g)!.join("\n")}\n` +
    "-----END PRIVATE KEY-----\n";
  return {
    json: JSON.stringify({
      type: "service_account",
      project_id: projectId,
      client_email: clientEmail,
      private_key: pem,
    }),
    projectId,
    clientEmail,
    publicKey: pair.publicKey,
  };
}

/** completeEnv with the account installed as FCM_SERVICE_ACCOUNT_JSON. */
export function fcmEnv(account: TestServiceAccount): Env {
  return { ...completeEnv(), FCM_SERVICE_ACCOUNT_JSON: account.json };
}

export interface FcmSendCapture {
  url: URL;
  authorization: string | null;
  /** The FCM v1 `message` object posted to messages:send. */
  message: Record<string, unknown>;
}

export interface FcmServiceDouble {
  /** Raw `assertion` JWTs posted to the OAuth token endpoint, in order. */
  assertions: string[];
  sends: FcmSendCapture[];
  routes: FetchRoute[];
}

/**
 * Google-side double: the OAuth token endpoint answers with `accessToken`
 * (default `ya29.test-token`), the FCM send endpoint with `sendStatus`
 * (default 200) and `sendBody`.
 */
export function fcmService(
  options: {
    sendStatus?: number;
    sendBody?: string;
    accessToken?: string;
  } = {},
): FcmServiceDouble {
  const assertions: string[] = [];
  const sends: FcmSendCapture[] = [];

  const oauthRoute: FetchRoute = async (url, request) => {
    if (url.href !== "https://oauth2.googleapis.com/token") return undefined;
    const params = new URLSearchParams(await request.clone().text());
    assertions.push(params.get("assertion") ?? "");
    return Response.json({
      access_token: options.accessToken ?? "ya29.test-token",
      expires_in: 3599,
      token_type: "Bearer",
    });
  };

  const sendRoute: FetchRoute = async (url, request) => {
    if (url.hostname !== "fcm.googleapis.com") return undefined;
    const body = (await request.clone().json()) as {
      message: Record<string, unknown>;
    };
    sends.push({
      url,
      authorization: request.headers.get("authorization"),
      message: body.message,
    });
    const status = options.sendStatus ?? 200;
    const responseBody =
      options.sendBody ??
      (status < 300
        ? JSON.stringify({ name: "projects/loonext-test/messages/1" })
        : JSON.stringify({ error: { code: status, status: "UNAVAILABLE" } }));
    return new Response(responseBody, { status });
  };

  return { assertions, sends, routes: [oauthRoute, sendRoute] };
}
