/**
 * D31 launch-pass harness — fake Telnyx server.
 *
 * A real node:http server that speaks the Telnyx v2 REST contract the
 * provisioning / registration / send / voice / porting sagas call. The Worker's
 * telnyx client is retargeted here via `env.TELNYX_API_BASE`. Canned response
 * shapes are ported from src/telnyx/test-support.ts (TelnyxMock) and the unit
 * suites (provisioning.test.ts, registration.test.ts, ...).
 *
 * It ALSO owns the harness's Ed25519 signing keypair: the base64 raw public key
 * goes in `env.TELNYX_PUBLIC_KEY` so the harness can sign the inbound Telnyx
 * webhooks the Worker verifies (Ed25519 over `${timestamp}|${body}`).
 *
 * State transitions (10DLC brand/campaign approval, number-order confirmation)
 * are NOT invented here — production drives them by signed webhooks, so the
 * harness advances them the same way (D31). This server returns stable "in
 * flight" shapes and records every call for assertions.
 *
 * Lives under apps/api/e2e/ ONLY; never imported by src/.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { AddressInfo } from "node:net";

export interface TelnyxCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  /** Raw request body text (multipart uploads are not JSON). */
  raw: string;
}

export interface FakeTelnyx {
  origin: string;
  /** base64 raw Ed25519 public key → env.TELNYX_PUBLIC_KEY. */
  publicKeyB64: string;
  /** Ed25519 private key the harness signs inbound webhooks with. */
  privateKey: CryptoKey;
  calls: TelnyxCall[];
  callsTo(method: string, pattern: RegExp): TelnyxCall[];
  reset(): void;
  close(): Promise<void>;
}

interface Handler {
  method: string;
  pattern: RegExp;
  respond: (
    call: TelnyxCall,
    match: RegExpMatchArray,
  ) => { status?: number; body: unknown };
}

let orderSeq = 0;
let numberSeq = 0;
let profileSeq = 0;
let documentSeq = 0;
let messageSeq = 0;
let brandSeq = 0;
let campaignSeq = 0;
let hostedSeq = 0;

/** Deterministic-ish unique DID for each search/order, in NANP shape. */
function mintDid(): string {
  numberSeq += 1;
  const tail = String(1_000_000 + numberSeq).slice(-7);
  return `+1613${tail}`;
}

/**
 * The handler table — ported from TelnyxMock canned shapes. Ordering matters:
 * more specific patterns first. A catch-all 200 `{data:{}}` closes the list so
 * a missing shape is visible in `calls`, not a hang.
 */
function buildHandlers(): Handler[] {
  return [
    // --- Provisioning (§4.3) ---
    {
      method: "POST",
      pattern: /^\/v2\/messaging_profiles$/,
      respond: () => {
        profileSeq += 1;
        return { body: { data: { id: `profile-e2e-${profileSeq}` } } };
      },
    },
    {
      method: "GET",
      pattern: /^\/v2\/available_phone_numbers$/,
      respond: () => ({ body: { data: [{ phone_number: mintDid() }] } }),
    },
    {
      method: "POST",
      pattern: /^\/v2\/number_orders$/,
      respond: (call) => {
        orderSeq += 1;
        const body = (call.body ?? {}) as {
          phone_numbers?: { phone_number: string }[];
        };
        const numbers = body.phone_numbers ?? [{ phone_number: mintDid() }];
        return {
          body: {
            data: {
              id: `order-e2e-${orderSeq}`,
              status: "success",
              phone_numbers: numbers,
            },
          },
        };
      },
    },
    {
      method: "GET",
      pattern: /^\/v2\/number_orders\/([^/]+)$/,
      respond: (_call, match) => ({
        body: {
          data: { id: match[1], status: "success", phone_numbers: [] },
        },
      }),
    },
    {
      method: "GET",
      pattern: /^\/v2\/phone_numbers$/,
      respond: (call) => {
        // Two distinct reads hit this endpoint, and they must answer
        // differently (matching the real Telnyx contract):
        //
        //  - lookupOwnedNumber filters by `filter[phone_number]` right after a
        //    successful order → return the OWNED row for that exact number so
        //    the saga can resolve its telnyx_phone_number_id.
        //  - the orphan-adoption / reconcile scan filters by
        //    `filter[customer_reference]` (or lists a page) BEFORE ordering →
        //    a fresh company owns nothing, so return an EMPTY list. Returning a
        //    phantom row here would make the saga "adopt" a number it never
        //    bought and skip the order entirely (a real double-provisioning /
        //    cost bug the harness must not paper over).
        const byNumber =
          call.query.get("filter[phone_number]") ??
          call.query.get("filter[phone_number][eq]");
        if (byNumber) {
          numberSeq += 1;
          return {
            body: {
              data: [{ id: `pn-e2e-${numberSeq}`, phone_number: byNumber }],
            },
          };
        }
        return { body: { data: [], meta: { total_pages: 1 } } };
      },
    },
    {
      method: "PATCH",
      pattern: /^\/v2\/phone_numbers\/([^/]+)(\/voice)?$/,
      respond: (_call, match) => ({
        body: { data: { id: match[1] } },
      }),
    },
    {
      method: "DELETE",
      pattern: /^\/v2\/phone_numbers\/([^/]+)$/,
      respond: () => ({ status: 204, body: null }),
    },

    // --- 10DLC registration (§4.4) ---
    {
      method: "POST",
      pattern: /^\/v2\/10dlc\/brand$/,
      respond: () => {
        brandSeq += 1;
        return { body: { brandId: `brand-e2e-${brandSeq}` } };
      },
    },
    {
      method: "PUT",
      pattern: /^\/v2\/10dlc\/brand\/([^/]+)$/,
      respond: (_call, match) => ({ body: { brandId: match[1] } }),
    },
    {
      method: "GET",
      pattern: /^\/v2\/10dlc\/brand\/([^/]+)$/,
      respond: (_call, match) => ({
        // "pending" until an injected webhook flips it (D31).
        body: {
          brandId: match[1],
          identityStatus: "PENDING",
          status: "PENDING",
        },
      }),
    },
    {
      method: "POST",
      pattern: /^\/v2\/10dlc\/brand\/([^/]+)\/smsOtp$/,
      respond: () => ({ body: {} }),
    },
    {
      method: "PUT",
      pattern: /^\/v2\/10dlc\/brand\/([^/]+)\/smsOtp$/,
      respond: () => ({ body: {} }),
    },
    {
      method: "POST",
      pattern: /^\/v2\/10dlc\/campaignBuilder$/,
      respond: () => {
        campaignSeq += 1;
        return { body: { campaignId: `campaign-e2e-${campaignSeq}` } };
      },
    },
    {
      method: "GET",
      pattern: /^\/v2\/10dlc\/campaign\/([^/]+)$/,
      respond: (_call, match) => ({
        body: { campaignId: match[1], status: "PENDING" },
      }),
    },
    {
      method: "PUT",
      pattern: /^\/v2\/10dlc\/campaign\/([^/]+)$/,
      respond: () => ({ body: {} }),
    },
    {
      method: "DELETE",
      pattern: /^\/v2\/10dlc\/campaign\/([^/]+)$/,
      respond: () => ({ body: {} }),
    },
    {
      method: "POST",
      pattern: /^\/v2\/10dlc\/phoneNumberCampaign$/,
      respond: () => ({ body: { data: {} } }),
    },

    // --- Documents / porting (§3.2, PORTING.md) ---
    {
      method: "POST",
      pattern: /^\/v2\/documents$/,
      respond: () => {
        documentSeq += 1;
        return { body: { data: { id: `doc-e2e-${documentSeq}` } } };
      },
    },

    // --- Send (§4.5) ---
    {
      method: "POST",
      pattern: /^\/v2\/messages$/,
      respond: () => {
        messageSeq += 1;
        return {
          body: {
            data: {
              id: `msg-e2e-${messageSeq}`,
              to: [{ phone_number: "" }],
              parts: 1,
            },
          },
        };
      },
    },

    // --- Voice (missed-call text-back) ---
    {
      method: "POST",
      pattern: /^\/v2\/calls\/([^/]+)\/actions\/[^/]+$/,
      respond: () => ({ body: { data: { result: "ok" } } }),
    },

    // --- Hosted messaging (keep-your-number) ---
    {
      method: "POST",
      pattern: /^\/v2\/messaging_hosted_number_orders$/,
      respond: () => {
        hostedSeq += 1;
        return {
          body: {
            data: {
              id: `hosted-e2e-${hostedSeq}`,
              status: "pending",
              phone_numbers: [],
            },
          },
        };
      },
    },
    {
      method: "GET",
      pattern: /^\/v2\/messaging_hosted_number_orders\/([^/]+)$/,
      respond: (_call, match) => ({
        body: { data: { id: match[1], status: "pending", phone_numbers: [] } },
      }),
    },
  ];
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Boot the fake Telnyx server on an ephemeral port. */
export async function startFakeTelnyx(): Promise<FakeTelnyx> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const rawPub = new Uint8Array(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
  );
  const publicKeyB64 = Buffer.from(rawPub).toString("base64");

  const handlers = buildHandlers();
  const calls: TelnyxCall[] = [];

  const server: Server = createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req);
      const url = new URL(req.url ?? "/", "http://telnyx.local");
      let body: unknown;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      const call: TelnyxCall = {
        method: req.method ?? "GET",
        path: url.pathname,
        query: url.searchParams,
        body,
        raw,
      };
      calls.push(call);

      for (const handler of handlers) {
        if (handler.method !== call.method) continue;
        const match = call.path.match(handler.pattern);
        if (!match) continue;
        const { status = 200, body: out } = handler.respond(call, match);
        if (status === 204 || out === null) {
          res.writeHead(status);
          res.end();
          return;
        }
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
        return;
      }

      // Catch-all: 200 {data:{}} + log, so a missing shape is visible.
      console.warn(
        `[fake-telnyx] unhandled ${call.method} ${call.path} — 200 {data:{}}`,
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: {} }));
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    origin: `http://127.0.0.1:${port}`,
    publicKeyB64,
    privateKey: pair.privateKey,
    calls,
    callsTo: (method, pattern) =>
      calls.filter((c) => c.method === method && pattern.test(c.path)),
    reset: () => {
      calls.length = 0;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
