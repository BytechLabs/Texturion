/**
 * Messaging cron suite (SPEC §11): the webhook sweeper replays unprocessed
 * ledger rows (telnyx AND stripe) through the real dispatchers with attempt
 * bookkeeping, and the usage re-reporter re-POSTs meter events for locally
 * unstamped usage_events rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { restMatch, stubRoute } from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";
import { reportUnreportedUsage, sweepWebhookEvents } from "./crons";

const TELNYX_ID = "40385f64-5717-4562-b3fc-2c963f66cccc";

let env: Env;

beforeEach(() => {
  env = completeEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sweepWebhookEvents", () => {
  it("replays an unprocessed telnyx row through the real dispatch and stamps it", async () => {
    const sweepQuery = stubRoute(
      restMatch(env, "GET", "webhook_events"),
      () => [
        {
          provider: "telnyx",
          event_id: "evt-1",
          event_type: "message.sent",
          payload: {
            data: {
              event_type: "message.sent",
              id: "evt-1",
              payload: { id: TELNYX_ID },
            },
          },
          attempts: 0,
        },
      ],
    );
    const messagePatch = stubRoute(restMatch(env, "PATCH", "messages"), () =>
      new Response(null, { status: 204 }),
    );
    const ledgerPatch = stubRoute(restMatch(env, "PATCH", "webhook_events"), () =>
      new Response(null, { status: 204 }),
    );
    stubFetch(sweepQuery.route, messagePatch.route, ledgerPatch.route);

    await sweepWebhookEvents(env);

    // The sweep query selects by state: unprocessed, aged 2 min, < 5 attempts.
    const query = sweepQuery.calls[0].url.searchParams;
    expect(query.get("processed_at")).toBe("is.null");
    expect(query.get("attempts")).toBe("lt.5");
    expect(query.get("received_at")).toMatch(/^lt\./);

    // The row went through the REAL message.sent pipeline...
    expect(messagePatch.calls).toHaveLength(1);
    expect(messagePatch.calls[0].url.searchParams.get("telnyx_message_id")).toBe(
      `eq.${TELNYX_ID}`,
    );
    // ...and was stamped processed.
    expect(ledgerPatch.calls).toHaveLength(1);
    expect(ledgerPatch.calls[0].body).toMatchObject({
      processed_at: expect.any(String),
    });
    expect(ledgerPatch.calls[0].url.searchParams.get("event_id")).toBe("eq.evt-1");
  });

  it("replays stripe rows through the billing dispatcher (unknown type → no-op success)", async () => {
    const sweepQuery = stubRoute(
      restMatch(env, "GET", "webhook_events"),
      () => [
        {
          provider: "stripe",
          event_id: "evt-s-1",
          event_type: "some.unhandled",
          payload: { id: "evt-s-1", type: "some.unhandled", data: { object: {} } },
          attempts: 2,
        },
      ],
    );
    const ledgerPatch = stubRoute(restMatch(env, "PATCH", "webhook_events"), () =>
      new Response(null, { status: 204 }),
    );
    stubFetch(sweepQuery.route, ledgerPatch.route);

    await sweepWebhookEvents(env);
    expect(ledgerPatch.calls).toHaveLength(1);
    expect(ledgerPatch.calls[0].body).toMatchObject({
      processed_at: expect.any(String),
    });
  });

  it("increments attempts and records last_error on failure", async () => {
    const sweepQuery = stubRoute(
      restMatch(env, "GET", "webhook_events"),
      () => [
        {
          provider: "telnyx",
          event_id: "evt-2",
          event_type: "message.sent",
          payload: {
            data: {
              event_type: "message.sent",
              id: "evt-2",
              payload: { id: TELNYX_ID },
            },
          },
          attempts: 1,
        },
      ],
    );
    const messagePatch = stubRoute(restMatch(env, "PATCH", "messages"), () =>
      Response.json({ message: "db down" }, { status: 500 }),
    );
    const ledgerPatch = stubRoute(restMatch(env, "PATCH", "webhook_events"), () =>
      new Response(null, { status: 204 }),
    );
    stubFetch(sweepQuery.route, messagePatch.route, ledgerPatch.route);

    await sweepWebhookEvents(env);

    expect(ledgerPatch.calls).toHaveLength(1);
    expect(ledgerPatch.calls[0].body).toMatchObject({
      attempts: 2,
      last_error: expect.stringContaining("message.sent update failed"),
    });
  });
});

describe("reportUnreportedUsage", () => {
  it("re-reports unstamped rows and stamps them; rows without a customer are skipped", async () => {
    const usageQuery = stubRoute(
      restMatch(env, "GET", "usage_events"),
      () => [
        {
          id: "u-1",
          quantity: 2,
          meter_identifier: TELNYX_ID,
          companies: { stripe_customer_id: "cus_123" },
        },
        {
          id: "u-2",
          quantity: 3,
          meter_identifier: null,
          companies: { stripe_customer_id: null },
        },
      ],
    );
    const meter = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.stripe.com/v1/billing/meter_events",
      () => ({ object: "billing.meter_event" }),
    );
    const stamp = stubRoute(restMatch(env, "PATCH", "usage_events"), () =>
      new Response(null, { status: 204 }),
    );
    stubFetch(usageQuery.route, meter.route, stamp.route);

    await reportUnreportedUsage(env);

    // Selected by the local stamp gate.
    expect(usageQuery.calls[0].url.searchParams.get("stripe_reported_at")).toBe(
      "is.null",
    );

    // One meter event (u-1); u-2 has no customer yet and is skipped.
    expect(meter.calls).toHaveLength(1);
    const form = new URLSearchParams(String(meter.calls[0].body));
    expect(form.get("identifier")).toBe(TELNYX_ID);
    expect(form.get("payload[stripe_customer_id]")).toBe("cus_123");
    expect(form.get("payload[value]")).toBe("2");

    expect(stamp.calls).toHaveLength(1);
    expect(stamp.calls[0].url.searchParams.get("id")).toBe("eq.u-1");
    expect(stamp.calls[0].url.searchParams.get("stripe_reported_at")).toBe(
      "is.null", // guarded stamp — never overwrites a concurrent report
    );
  });

  it("leaves rows unstamped when the meter call fails", async () => {
    const usageQuery = stubRoute(
      restMatch(env, "GET", "usage_events"),
      () => [
        {
          id: "u-3",
          quantity: 1,
          meter_identifier: TELNYX_ID,
          companies: { stripe_customer_id: "cus_123" },
        },
      ],
    );
    const meter = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.stripe.com/v1/billing/meter_events",
      () => Response.json({ error: { message: "nope" } }, { status: 500 }),
    );
    const stamp = stubRoute(restMatch(env, "PATCH", "usage_events"));
    stubFetch(usageQuery.route, meter.route, stamp.route);

    await reportUnreportedUsage(env);
    expect(stamp.calls).toHaveLength(0);
  });
});
