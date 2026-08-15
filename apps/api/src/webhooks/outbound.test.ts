/**
 * #243 — the outbound webhook path, from enqueue to signature to backoff.
 *
 * Only the network edge is stubbed, as everywhere else in this suite, so these
 * go through real supabase-js encoding and real WebCrypto: a column renamed in
 * the migration and not here shows up as a wrong request body rather than a
 * passing mock, and the signature assertions verify an HMAC that was actually
 * computed rather than one that was described.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import type { Env } from "../env";
import { restMatch, rpcMatch, stubRoute } from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";
import { deliverWebhookBatch } from "./outbound-deliver";
import { enqueueWebhookEvent } from "./outbound";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const ENDPOINT = "22222222-2222-4222-8222-222222222222";
const DELIVERY = "33333333-3333-4333-8333-333333333333";
const SECRET = "whsec_test_secret";
const URL_OK = "https://hooks.example.com/loonext";

let env: Env;

beforeEach(() => {
  env = completeEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Recompute the signature the way a receiver would, and compare. */
async function verifySignature(
  header: string,
  body: string,
  secret: string,
): Promise<boolean> {
  const match = /t=(\d+),v1=([0-9a-f]+)/.exec(header);
  if (!match) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${match[1]}.${body}`),
  );
  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return hex === match[2];
}

describe("enqueueWebhookEvent", () => {
  it("writes one delivery per subscribed endpoint, and the envelope carries the row's own id", async () => {
    const select = stubRoute(restMatch(env, "GET", "webhook_endpoints"), () => [
      { id: ENDPOINT },
      { id: "44444444-4444-4444-8444-444444444444" },
    ]);
    const insert = stubRoute(restMatch(env, "POST", "webhook_deliveries"), () => []);
    stubFetch(select.route, insert.route);

    const written = await enqueueWebhookEvent(getDb(env), {
      companyId: COMPANY,
      type: "message.received",
      data: { message_id: "m1" },
    });

    expect(written).toBe(2);
    const rows = insert.calls[0]?.body as {
      id: string;
      company_id: string;
      endpoint_id: string;
      event_type: string;
      payload: { id: string; type: string; company_id: string; data: unknown };
    }[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // The property that gives every integrator deduplication for free: the
      // id a receiver reads out of the body is the id of the row that will be
      // retried, so the same event arriving twice is recognisably the same.
      expect(row.payload.id).toBe(row.id);
      expect(row.company_id).toBe(COMPANY);
      expect(row.event_type).toBe("message.received");
      expect(row.payload.type).toBe("message.received");
      expect(row.payload.data).toEqual({ message_id: "m1" });
    }
    expect(new Set(rows.map((r) => r.endpoint_id)).size).toBe(2);
  });

  it("asks only for active endpoints subscribed to this event, scoped to the workspace", async () => {
    const select = stubRoute(restMatch(env, "GET", "webhook_endpoints"), () => []);
    stubFetch(select.route);

    await enqueueWebhookEvent(getDb(env), {
      companyId: COMPANY,
      type: "task.completed",
      data: {},
    });

    const query = select.calls[0]?.url.searchParams;
    expect(query?.get("company_id")).toBe(`eq.${COMPANY}`);
    expect(query?.get("active")).toBe("eq.true");
    // `cs` is PostgREST's `@>`. Asking for `eq` here would match only an
    // endpoint subscribed to exactly one event, which is the shape of bug that
    // passes every unit test written against a mock.
    expect(query?.get("events")).toBe("cs.{task.completed}");
  });

  it("writes nothing, and never throws, when nobody is listening", async () => {
    const select = stubRoute(restMatch(env, "GET", "webhook_endpoints"), () => []);
    const insert = stubRoute(restMatch(env, "POST", "webhook_deliveries"), () => []);
    stubFetch(select.route, insert.route);

    await expect(
      enqueueWebhookEvent(getDb(env), {
        companyId: COMPANY,
        type: "contact.created",
        data: {},
      }),
    ).resolves.toBe(0);
    expect(insert.calls).toHaveLength(0);
  });
});

/** One claimed delivery, with the knobs a test wants to turn. */
function claimed(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: DELIVERY,
    company_id: COMPANY,
    endpoint_id: ENDPOINT,
    event_type: "message.received",
    payload: { id: DELIVERY, type: "message.received", data: { message_id: "m1" } },
    attempts: 1,
    ...overrides,
  };
}

function endpointRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ENDPOINT,
    url: URL_OK,
    secret: SECRET,
    consecutive_failures: 0,
    ...overrides,
  };
}

describe("deliverWebhookBatch", () => {
  it("signs the exact bytes it sends, with the timestamp inside the signature", async () => {
    const claim = stubRoute(rpcMatch(env, "api_claim_webhook_deliveries"), () => [claimed()]);
    const endpoints = stubRoute(restMatch(env, "GET", "webhook_endpoints"), () => [endpointRow()]);
    const update = stubRoute(restMatch(env, "PATCH", "webhook_deliveries"), () => []);
    const endpointUpdate = stubRoute(restMatch(env, "PATCH", "webhook_endpoints"), () => []);
    let sent: { body: string; signature: string; event: string; delivery: string } | null = null;
    const receiver = stubRoute(
      (url) => url.origin === "https://hooks.example.com",
      () => new Response("ok", { status: 200 }),
    );
    const capturing = async (url: URL, request: Request) => {
      if (url.origin !== "https://hooks.example.com") return undefined;
      sent = {
        body: await request.clone().text(),
        signature: request.headers.get("loonext-signature") ?? "",
        event: request.headers.get("loonext-event") ?? "",
        delivery: request.headers.get("loonext-delivery") ?? "",
      };
      return receiver.route(url, request);
    };
    stubFetch(claim.route, endpoints.route, update.route, endpointUpdate.route, capturing);

    const result = await deliverWebhookBatch(getDb(env));

    expect(result).toMatchObject({ claimed: 1, delivered: 1, failed: 0 });
    expect(sent).not.toBeNull();
    const request = sent as unknown as { body: string; signature: string; event: string; delivery: string };
    expect(request.event).toBe("message.received");
    expect(request.delivery).toBe(DELIVERY);
    await expect(verifySignature(request.signature, request.body, SECRET)).resolves.toBe(true);
    // A different secret must NOT verify — otherwise the assertion above would
    // pass against any implementation that emitted a well-formed header.
    await expect(verifySignature(request.signature, request.body, "wrong")).resolves.toBe(false);
    // And the body is the stored payload verbatim, because that is what a
    // redelivery has to be able to reproduce.
    expect(JSON.parse(request.body)).toEqual(claimed().payload);
  });

  it("marks a 2xx succeeded and clears the endpoint's failure streak", async () => {
    const claim = stubRoute(rpcMatch(env, "api_claim_webhook_deliveries"), () => [claimed()]);
    const endpoints = stubRoute(restMatch(env, "GET", "webhook_endpoints"), () => [
      endpointRow({ consecutive_failures: 7 }),
    ]);
    const update = stubRoute(restMatch(env, "PATCH", "webhook_deliveries"), () => []);
    const endpointUpdate = stubRoute(restMatch(env, "PATCH", "webhook_endpoints"), () => []);
    const receiver = stubRoute(
      (url) => url.origin === "https://hooks.example.com",
      // `null`, not `""` — a 204 is a null-body status and constructing one
      // with any body at all throws, which is a stub bug that reads exactly
      // like a delivery bug.
      () => new Response(null, { status: 204 }),
    );
    stubFetch(claim.route, endpoints.route, update.route, endpointUpdate.route, receiver.route);

    await deliverWebhookBatch(getDb(env));

    expect(update.calls[0]?.body).toMatchObject({ status: "succeeded", response_status: 204 });
    // An endpoint that is up but rejected one event is not a dead endpoint.
    expect(endpointUpdate.calls[0]?.body).toMatchObject({ consecutive_failures: 0 });
  });

  it("puts a failure back on the queue at the scheduled gap, not immediately", async () => {
    const claim = stubRoute(rpcMatch(env, "api_claim_webhook_deliveries"), () => [
      claimed({ attempts: 1 }),
    ]);
    const endpoints = stubRoute(restMatch(env, "GET", "webhook_endpoints"), () => [endpointRow()]);
    const update = stubRoute(restMatch(env, "PATCH", "webhook_deliveries"), () => []);
    const endpointUpdate = stubRoute(restMatch(env, "PATCH", "webhook_endpoints"), () => []);
    const receiver = stubRoute(
      (url) => url.origin === "https://hooks.example.com",
      () => new Response("boom", { status: 500 }),
    );
    stubFetch(claim.route, endpoints.route, update.route, endpointUpdate.route, receiver.route);

    const before = Date.now();
    await deliverWebhookBatch(getDb(env));

    const body = update.calls[0]?.body as {
      status: string;
      response_status: number;
      last_error: string;
      next_attempt_at: string;
    };
    expect(body.status).toBe("pending");
    expect(body.response_status).toBe(500);
    // The receiver's own response is safe to keep; nothing from our payload is.
    expect(body.last_error).toContain("500");
    expect(body.last_error).not.toContain("message_id");
    const gap = new Date(body.next_attempt_at).getTime() - before;
    expect(gap).toBeGreaterThanOrEqual(29_000);
    expect(gap).toBeLessThan(45_000);
  });

  it("stops retrying once the schedule is exhausted", async () => {
    const claim = stubRoute(rpcMatch(env, "api_claim_webhook_deliveries"), () => [
      // Six attempts is the whole schedule; there is no seventh gap.
      claimed({ attempts: 6 }),
    ]);
    const endpoints = stubRoute(restMatch(env, "GET", "webhook_endpoints"), () => [endpointRow()]);
    const update = stubRoute(restMatch(env, "PATCH", "webhook_deliveries"), () => []);
    const endpointUpdate = stubRoute(restMatch(env, "PATCH", "webhook_endpoints"), () => []);
    const receiver = stubRoute(
      (url) => url.origin === "https://hooks.example.com",
      () => new Response("nope", { status: 502 }),
    );
    stubFetch(claim.route, endpoints.route, update.route, endpointUpdate.route, receiver.route);

    await deliverWebhookBatch(getDb(env));

    const body = update.calls[0]?.body as { status: string; next_attempt_at?: string };
    expect(body.status).toBe("failed");
    expect(body.next_attempt_at).toBeUndefined();
  });

  it("disables an endpoint that has been failing long enough, with a key the phones can translate", async () => {
    const claim = stubRoute(rpcMatch(env, "api_claim_webhook_deliveries"), () => [claimed()]);
    const endpoints = stubRoute(restMatch(env, "GET", "webhook_endpoints"), () => [
      // One short of the threshold, so this batch's single failure crosses it.
      endpointRow({ consecutive_failures: 19 }),
    ]);
    const update = stubRoute(restMatch(env, "PATCH", "webhook_deliveries"), () => []);
    const endpointUpdate = stubRoute(restMatch(env, "PATCH", "webhook_endpoints"), () => []);
    const receiver = stubRoute(
      (url) => url.origin === "https://hooks.example.com",
      () => new Response("gone", { status: 410 }),
    );
    stubFetch(claim.route, endpoints.route, update.route, endpointUpdate.route, receiver.route);

    const result = await deliverWebhookBatch(getDb(env));

    expect(result.disabled).toBe(1);
    const body = endpointUpdate.calls[0]?.body as {
      active: boolean;
      consecutive_failures: number;
      disabled_reason: string;
    };
    expect(body.active).toBe(false);
    expect(body.consecutive_failures).toBe(20);
    // A stored English sentence is one no French phone can translate, so what
    // goes in the column is a catalogue key.
    expect(body.disabled_reason).toBe("webhooks.disabled.tooManyFailures");
  });

  it("does not disable an endpoint one failure short of the threshold", async () => {
    const claim = stubRoute(rpcMatch(env, "api_claim_webhook_deliveries"), () => [claimed()]);
    const endpoints = stubRoute(restMatch(env, "GET", "webhook_endpoints"), () => [
      endpointRow({ consecutive_failures: 18 }),
    ]);
    const update = stubRoute(restMatch(env, "PATCH", "webhook_deliveries"), () => []);
    const endpointUpdate = stubRoute(restMatch(env, "PATCH", "webhook_endpoints"), () => []);
    const receiver = stubRoute(
      (url) => url.origin === "https://hooks.example.com",
      () => new Response("gone", { status: 410 }),
    );
    stubFetch(claim.route, endpoints.route, update.route, endpointUpdate.route, receiver.route);

    const result = await deliverWebhookBatch(getDb(env));

    expect(result.disabled).toBe(0);
    const body = endpointUpdate.calls[0]?.body as Record<string, unknown>;
    expect(body.consecutive_failures).toBe(19);
    expect(body.active).toBeUndefined();
  });

  it("fails a delivery whose endpoint was removed between enqueue and now", async () => {
    const claim = stubRoute(rpcMatch(env, "api_claim_webhook_deliveries"), () => [claimed()]);
    const endpoints = stubRoute(restMatch(env, "GET", "webhook_endpoints"), () => []);
    const update = stubRoute(restMatch(env, "PATCH", "webhook_deliveries"), () => []);
    let posted = 0;
    const receiver = stubRoute((url) => {
      if (url.origin === "https://hooks.example.com") posted += 1;
      return url.origin === "https://hooks.example.com";
    }, () => new Response("", { status: 200 }));
    stubFetch(claim.route, endpoints.route, update.route, receiver.route);

    const result = await deliverWebhookBatch(getDb(env));

    expect(posted).toBe(0);
    expect(result).toMatchObject({ delivered: 0, failed: 1 });
    expect(update.calls[0]?.body).toMatchObject({
      status: "failed",
      last_error: "endpoint removed",
    });
  });

  it("does nothing at all when the queue is empty", async () => {
    const claim = stubRoute(rpcMatch(env, "api_claim_webhook_deliveries"), () => []);
    stubFetch(claim.route);

    await expect(deliverWebhookBatch(getDb(env))).resolves.toEqual({
      claimed: 0,
      delivered: 0,
      failed: 0,
      disabled: 0,
    });
  });
});
