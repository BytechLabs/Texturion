/**
 * Test-only helpers for the messaging-track suites (D13): REAL Ed25519
 * keypairs + request signing for webhook tests, a tiny fetch-route builder
 * for asserting the PostgREST/Storage/Telnyx HTTP layer, and row factories.
 * As everywhere, the ONLY thing stubbed is the network edge (global fetch).
 */
import type { MessageRow } from "../messaging/types";
import type { Env } from "../env";
import type { FetchRoute } from "./support";

/** A real Ed25519 keypair; the base64 raw public key goes in the env. */
export async function telnyxSigningKeys(): Promise<{
  privateKey: CryptoKey;
  publicKeyB64: string;
}> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
  );
  return {
    privateKey: pair.privateKey,
    publicKeyB64: btoa(String.fromCharCode(...raw)),
  };
}

/** A Telnyx webhook delivery: Ed25519 over `${timestamp}|${raw_body}`. */
export async function signedTelnyxRequest(
  privateKey: CryptoKey,
  event: unknown,
  options: { timestamp?: number; tamper?: boolean } = {},
): Promise<Request> {
  const body = JSON.stringify(event);
  const timestamp = String(
    options.timestamp ?? Math.floor(Date.now() / 1000),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      new TextEncoder().encode(`${timestamp}|${body}`),
    ),
  );
  if (options.tamper) signature[0] ^= 0xff;
  return new Request("https://api.jobtext.app/webhooks/telnyx", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "telnyx-signature-ed25519": btoa(String.fromCharCode(...signature)),
      "telnyx-timestamp": timestamp,
    },
    body,
  });
}

/** ExecutionContext capturing waitUntil promises so tests can flush them. */
export function testExecutionContext(): {
  ctx: ExecutionContext;
  flush: () => Promise<unknown>;
} {
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      tasks.push(promise);
    },
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
  return { ctx, flush: () => Promise.allSettled(tasks) };
}

export interface StubCall {
  url: URL;
  method: string;
  headers: Headers;
  body: unknown;
}

export interface Stub {
  route: FetchRoute;
  calls: StubCall[];
}

/**
 * A capturing fetch route: matched requests are recorded (with parsed JSON
 * body) and answered by `respond` (a Response, or a value JSON-encoded).
 */
export function stubRoute(
  match: (url: URL, request: Request) => boolean,
  respond: (call: StubCall) => Response | unknown = () => [],
): Stub {
  const calls: StubCall[] = [];
  const route: FetchRoute = async (url, request) => {
    if (!match(url, request)) return undefined;
    let body: unknown;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const text = await request.clone().text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
    }
    const call: StubCall = { url, method: request.method, headers: request.headers, body };
    calls.push(call);
    const result = respond(call);
    return result instanceof Response ? result : Response.json(result);
  };
  return { route, calls };
}

/** Matcher for a PostgREST table endpoint. */
export function restMatch(
  env: Env,
  method: string,
  table: string,
  extra?: (url: URL) => boolean,
): (url: URL, request: Request) => boolean {
  const origin = new URL(env.SUPABASE_URL).origin;
  return (url, request) =>
    request.method === method &&
    url.origin === origin &&
    url.pathname === `/rest/v1/${table}` &&
    (!extra || extra(url));
}

/** Matcher for a PostgREST RPC endpoint. */
export function rpcMatch(
  env: Env,
  fn: string,
): (url: URL, request: Request) => boolean {
  const origin = new URL(env.SUPABASE_URL).origin;
  return (url, request) =>
    request.method === "POST" &&
    url.origin === origin &&
    url.pathname === `/rest/v1/rpc/${fn}`;
}

/** Matcher for a Storage object upload into the mms-media bucket. */
export function storageUploadMatch(
  env: Env,
): (url: URL, request: Request) => boolean {
  const origin = new URL(env.SUPABASE_URL).origin;
  return (url, request) =>
    request.method === "POST" &&
    url.origin === origin &&
    url.pathname.startsWith("/storage/v1/object/mms-media/");
}

/** Matcher for a Storage signed-URL mint for the mms-media bucket. */
export function storageSignMatch(
  env: Env,
): (url: URL, request: Request) => boolean {
  const origin = new URL(env.SUPABASE_URL).origin;
  return (url, request) =>
    request.method === "POST" &&
    url.origin === origin &&
    url.pathname.startsWith("/storage/v1/object/sign/mms-media/");
}

/** PostgREST unique-violation (23505) response — the §7 conflict trigger. */
export function pgUniqueViolation(): Response {
  return Response.json(
    {
      code: "23505",
      message: "duplicate key value violates unique constraint",
      details: null,
      hint: null,
    },
    { status: 409 },
  );
}

/** A messages row as the RPC/PostgREST layer would return it. */
export function messageRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "aaaaaaaa-0000-4000-8000-00000000000a",
    company_id: "cccccccc-0000-4000-8000-00000000000c",
    conversation_id: "bbbbbbbb-0000-4000-8000-00000000000b",
    direction: "outbound",
    body: "hello",
    telnyx_message_id: null,
    status: "queued",
    segments: 1,
    encoding: null,
    sent_by_user_id: "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01",
    error_code: null,
    error_detail: null,
    idempotency_key: "11111111-2222-4333-8444-555555555555",
    provider_cost: null,
    done_at: null,
    done_by_user_id: null,
    created_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

/** A realistic Telnyx `message.received` webhook event (SPEC §7). */
export function messageReceivedEvent(overrides: {
  eventId?: string;
  telnyxMessageId?: string;
  from?: string;
  to?: string;
  text?: string;
  media?: { url: string; content_type?: string; size?: number }[];
} = {}): Record<string, unknown> {
  return {
    data: {
      event_type: "message.received",
      id: overrides.eventId ?? "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      occurred_at: "2026-07-01T12:00:00.000+00:00",
      payload: {
        id: overrides.telnyxMessageId ?? "40385f64-5717-4562-b3fc-2c963f66aaaa",
        type: (overrides.media?.length ?? 0) > 0 ? "MMS" : "SMS",
        direction: "inbound",
        from: {
          phone_number: overrides.from ?? "+16135551000",
          carrier: "Verizon",
          line_type: "Wireless",
        },
        to: [
          {
            phone_number: overrides.to ?? "+16135550100",
            status: "webhook_delivered",
          },
        ],
        text: overrides.text ?? "Hi, do you do gutters?",
        media: overrides.media ?? [],
        received_at: "2026-07-01T12:00:00.000+00:00",
        encoding: "GSM-7",
        parts: 1,
      },
    },
    meta: { attempt: 1, delivered_to: "https://api.jobtext.app/webhooks/telnyx" },
  };
}
