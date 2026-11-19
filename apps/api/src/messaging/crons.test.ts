/**
 * Messaging cron suite (SPEC §11): the webhook sweeper replays unprocessed
 * ledger rows (telnyx AND stripe) through the real dispatchers behind a
 * per-row atomic claim (#22), the stuck-send sweeper fails out queued
 * outbound rows that crashed before the Telnyx call (#20), and the usage
 * re-reporter re-POSTs meter events for locally unstamped usage_events —
 * treating Stripe's duplicate-identifier rejection as success (#53).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { restMatch, rpcMatch, stubRoute } from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";
import { exceptionsCaptured, resetCaptures } from "../test/capture-mock";
import { nextWebhookAttempt } from "../webhooks/retry";
import {
  failStuckOutboundSends,
  isDuplicateMeterIdentifierError,
  pruneWebhookEvents,
  reportUnreportedUsage,
  reportUnreportedVoiceUsage,
  sweepStaleCalls,
  sweepWebhookEvents,
} from "./crons";
import { STUCK_SEND_SECONDS } from "./send";

vi.mock(import("../observability/capture"), async () =>
  (await import("../test/capture-mock")).captureModuleMock(),
);

const TELNYX_ID = "40385f64-5717-4562-b3fc-2c963f66cccc";

const METER_CREATED_AT = "2026-11-01T12:00:00.000Z";

let env: Env;

beforeEach(() => {
  env = completeEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A webhook_events PATCH stub speaking the #22 claim protocol: a claim
 * UPDATE (body carries `attempts`) answers with the claimed row when
 * `claimWins`, else an empty set (another run owns it); every other UPDATE
 * (processed_at stamp, last_error record) answers 204.
 */
function ledgerPatchStub(options: { claimWins?: boolean } = {}) {
  return stubRoute(restMatch(env, "PATCH", "webhook_events"), (call) => {
    const body = call.body as Record<string, unknown>;
    if (typeof body.attempts === "number") {
      return options.claimWins === false
        ? []
        : [{ event_id: call.url.searchParams.get("event_id")?.slice(3) }];
    }
    return new Response(null, { status: 204 });
  });
}

describe(sweepWebhookEvents, () => {
  it("claims, replays an unprocessed telnyx row through the real dispatch, and stamps it", async () => {
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
    const ledgerPatch = ledgerPatchStub();
    stubFetch(sweepQuery.route, messagePatch.route, ledgerPatch.route);

    await sweepWebhookEvents(env);

    const query = sweepQuery.calls[0].url.searchParams;
    expect(query.get("processed_at")).toBe("is.null");
    expect(query.get("abandoned_at")).toBe("is.null");
    expect(query.get("attempts")).toBe("lte.9");
    expect(query.get("received_at")).toMatch(/^lt\./);
    expect(query.get("or")).toMatch(/claimed_at\.is\.null,claimed_at\.lt\./);
    expect(query.get("or")).toContain("next_attempt_at.is.null,next_attempt_at.lte.");
    expect(query.get("or")).toContain("attempts.lte.5,provider.in.(stripe,resend),event_type.like.message.*");
    expect(query.get("order")).toBe("next_attempt_at.asc.nullsfirst,received_at.asc");

    // The row went through the REAL message.sent pipeline...
    expect(messagePatch.calls).toHaveLength(1);
    expect(messagePatch.calls[0].url.searchParams.get("telnyx_message_id")).toBe(
      `eq.${TELNYX_ID}`,
    );

    // ...after an atomic claim (CAS on attempts + claimed_at lease)...
    expect(ledgerPatch.calls).toHaveLength(2);
    const [claim] = ledgerPatch.calls;
    expect(claim.body).toMatchObject({
      attempts: 1,
      claimed_at: expect.any(String),
    });
    expect(claim.url.searchParams.get("event_id")).toBe("eq.evt-1");
    expect(claim.url.searchParams.get("attempts")).toBe("eq.0"); // the CAS token
    expect(claim.url.searchParams.get("processed_at")).toBe("is.null");
    expect(claim.url.searchParams.get("or")).toMatch(
      /claimed_at\.is\.null,claimed_at\.lt\./,
    );

    // ...and was stamped processed.
    expect(ledgerPatch.calls[1].body).toMatchObject({
      processed_at: expect.any(String),
    });
    expect(ledgerPatch.calls[1].url.searchParams.get("event_id")).toBe("eq.evt-1");
  });

  it("#216 replays a call.cost row: records the leg cost (recovery), never routes it to the DO", async () => {
    const COMPANY = "cccccccc-0000-4000-8000-00000000000c";
    // base64 of "op|<sessionId>|<userId>" — the real prod client_state.
    const clientState =
      "b3B8NzI0ZTZjODgtYzk2Ny00NmM0LWEzM2QtMWFlMDU3MzM2NTg0fDQxMjFkNmViLWEyZmMtNDJlNS1hNWYzLThlNDE0YTM4MjRmMQ==";
    const sweepQuery = stubRoute(restMatch(env, "GET", "webhook_events"), () => [
      {
        provider: "telnyx",
        event_id: "evt-cost-1",
        event_type: "call.cost",
        payload: {
          data: {
            event_type: "call.cost",
            id: "evt-cost-1",
            occurred_at: "2026-07-24T03:54:31Z",
            payload: {
              call_leg_id: "leg-sweep-1",
              client_state: clientState,
              total_cost: "0.0180",
            },
          },
        },
        attempts: 0,
      },
    ]);
    const callsLookup = stubRoute(restMatch(env, "GET", "calls"), () => [
      { company_id: COMPANY },
    ]);
    const costUpsert = stubRoute(restMatch(env, "POST", "provider_costs"));
    const ledgerPatch = ledgerPatchStub();
    stubFetch(
      sweepQuery.route,
      callsLookup.route,
      costUpsert.route,
      ledgerPatch.route,
    );

    await sweepWebhookEvents(env);

    // The sweep RECORDED the leg cost (the recovery path) rather than routing the
    // billing event into the Durable Object.
    expect(costUpsert.calls).toHaveLength(1);
    const body = costUpsert.calls[0].body as
      | Record<string, unknown>
      | Record<string, unknown>[];
    const row = Array.isArray(body) ? body[0] : body;
    expect(row.kind).toBe("voice");
    expect(row.ref).toBe("leg-sweep-1");
    expect(row.company_id).toBe(COMPANY);
    // ...and was stamped processed after its atomic claim.
    expect(ledgerPatch.calls[ledgerPatch.calls.length - 1].body).toMatchObject({
      processed_at: expect.any(String),
    });
  });

  it("skips a row whose claim it loses — no dispatch, no stamp (#22)", async () => {
    const sweepQuery = stubRoute(
      restMatch(env, "GET", "webhook_events"),
      () => [
        {
          provider: "telnyx",
          event_id: "evt-raced",
          event_type: "message.sent",
          payload: {
            data: {
              event_type: "message.sent",
              id: "evt-raced",
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
    // A concurrent run bumped attempts first: the CAS UPDATE matches 0 rows.
    const ledgerPatch = ledgerPatchStub({ claimWins: false });
    stubFetch(sweepQuery.route, messagePatch.route, ledgerPatch.route);

    await sweepWebhookEvents(env);

    expect(ledgerPatch.calls).toHaveLength(1); // the losing claim only
    expect(messagePatch.calls).toHaveLength(0); // never dispatched
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
    const ledgerPatch = ledgerPatchStub();
    stubFetch(sweepQuery.route, ledgerPatch.route);

    await sweepWebhookEvents(env);
    // Claim, then the processed stamp.
    expect(ledgerPatch.calls).toHaveLength(2);
    expect(ledgerPatch.calls[0].body).toMatchObject({ attempts: 3 });
    expect(ledgerPatch.calls[1].body).toMatchObject({
      processed_at: expect.any(String),
    });
  });

  it("releases a failed claim and schedules the next attempt", async () => {
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
    const ledgerPatch = ledgerPatchStub();
    stubFetch(sweepQuery.route, messagePatch.route, ledgerPatch.route);

    await sweepWebhookEvents(env);

    expect(ledgerPatch.calls).toHaveLength(2);
    // The claim carried the attempt bump...
    expect(ledgerPatch.calls[0].body).toMatchObject({
      attempts: 2,
      claimed_at: expect.any(String),
    });
    expect(ledgerPatch.calls[1].body).toMatchObject({
      attempts: 2,
      claimed_at: null,
      next_attempt_at: expect.any(String),
      abandoned_at: null,
      last_error: expect.stringContaining("message.sent update failed"),
    });
    expect(ledgerPatch.calls[1].url.searchParams.get("attempts")).toBe("eq.2");
  });

  it("abandons a call whose fifth claim expired without dispatching again", async () => {
    const query = stubRoute(restMatch(env, "GET", "webhook_events"), () => [{
      provider: "telnyx",
      event_id: "expired-call",
      event_type: "call.hangup",
      payload: {},
      attempts: 5,
    }]);
    const patch = ledgerPatchStub();
    stubFetch(query.route, patch.route);

    await sweepWebhookEvents(env);

    expect(patch.calls).toHaveLength(1);
    expect(patch.calls[0].body).toMatchObject({
      attempts: 5,
      claimed_at: null,
      next_attempt_at: null,
      abandoned_at: expect.any(String),
    });
    expect(patch.calls[0].url.searchParams.get("attempts")).toBe("eq.5");
    expect(patch.calls[0].url.searchParams.get("abandoned_at")).toBe("is.null");
  });
});

describe(nextWebhookAttempt, () => {
  const now = Date.UTC(2026, 10, 19, 12);
  const minutes = [2, 5, 15, 60, 180, 360, 720, 1440];

  it.each([
    { provider: "telnyx", eventType: "message.received" },
    { provider: "telnyx", eventType: "10dlc.brand.updated" },
    { provider: "telnyx", eventType: "porting_order.status_changed" },
    { provider: "telnyx", eventType: "portout.status_changed" },
    { provider: "stripe", eventType: "invoice.paid" },
    { provider: "resend", eventType: "email.bounced" },
  ] as const)("backs off $provider $eventType through 24 hours", (event) => {
    expect(minutes.map((_, index) => nextWebhookAttempt(event, index + 1, now)))
      .toEqual(minutes.map((delay) => new Date(now + delay * 60_000).toISOString()));
    expect(nextWebhookAttempt(event, 9, now)).toBeNull();
  });

  it("keeps call delivery on five attempts", () => {
    const event = { provider: "telnyx", eventType: "call.hangup" } as const;
    expect(nextWebhookAttempt(event, 4, now)).toBe(new Date(now + 10 * 60_000).toISOString());
    expect(nextWebhookAttempt(event, 5, now)).toBeNull();
  });
});

describe("pruneWebhookEvents (ledger retention)", () => {
  it("prunes at the 30-day dedupe window, oldest-first and batched", async () => {
    const rpc = stubRoute(rpcMatch(env, "api_prune_webhook_events"), () => 12);
    stubFetch(rpc.route);
    const now = new Date("2026-07-24T15:30:00.000Z");

    await pruneWebhookEvents(env, now);

    expect(rpc.calls).toHaveLength(1);
    const body = rpc.calls[0].body as Record<string, unknown>;
    // 30 days before the injected clock — the window must stay strictly wider
    // than any provider redelivery (Stripe ~3d, re-sendable for 30).
    expect(body.p_before).toBe("2026-06-24T15:30:00.000Z");
    expect(body.p_limit).toBe(5000);
  });

  it("stays quiet on a normal run, but reports when the batch ceiling is hit", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const under = stubRoute(rpcMatch(env, "api_prune_webhook_events"), () => 4);
    stubFetch(under.route);
    await pruneWebhookEvents(env, new Date());
    expect(consoleLog).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    const atCeiling = stubRoute(
      rpcMatch(env, "api_prune_webhook_events"),
      () => 5000,
    );
    stubFetch(atCeiling.route);
    await pruneWebhookEvents(env, new Date());
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining("batch ceiling"),
    );

    consoleLog.mockRestore();
  });

  it("throws on an RPC failure so the cron run is recorded as failed", async () => {
    const rpc = stubRoute(rpcMatch(env, "api_prune_webhook_events"), () =>
      Response.json({ message: "boom" }, { status: 500 }),
    );
    stubFetch(rpc.route);

    await expect(pruneWebhookEvents(env, new Date())).rejects.toThrow(
      /webhook_events prune failed/,
    );
  });
});

describe("failStuckOutboundSends (#20)", () => {
  it("invokes the fail-out RPC with the shared stuck threshold", async () => {
    const rpc = stubRoute(rpcMatch(env, "fail_stuck_outbound_sends"), () => 0);
    stubFetch(rpc.route);

    await failStuckOutboundSends(env);

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].body).toEqual({
      p_stuck_after_seconds: STUCK_SEND_SECONDS,
    });
  });

  it("surfaces a flipped count loudly (a customer message was silently unsent)", async () => {
    const rpc = stubRoute(rpcMatch(env, "fail_stuck_outbound_sends"), () => 2);
    stubFetch(rpc.route);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await failStuckOutboundSends(env);

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("failed out 2 stuck queued outbound message(s)"),
    );
    consoleError.mockRestore();
  });

  it("throws on an RPC failure so the cron run is recorded as failed", async () => {
    const rpc = stubRoute(rpcMatch(env, "fail_stuck_outbound_sends"), () =>
      Response.json({ message: "boom" }, { status: 500 }),
    );
    stubFetch(rpc.route);

    await expect(failStuckOutboundSends(env)).rejects.toThrow(
      /fail_stuck_outbound_sends failed/,
    );
  });
});

describe("reportUnreportedUsage — work done, not just execution (#333)", () => {
  const outstanding = () =>
    stubRoute(restMatch(env, "GET", "usage_events"), () => [
      {
        id: "u-1",
        quantity: 2,
        meter_identifier: TELNYX_ID,
        company_id: "c-1",
        created_at: METER_CREATED_AT,
        report_attempts: 0,
        companies: { stripe_customer_id: "cus_123" },
      },
    ]).route;

  beforeEach(() => {
    resetCaptures();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reports nothing when there was nothing outstanding", async () => {
    stubFetch(stubRoute(restMatch(env, "GET", "usage_events"), () => []).route);

    await reportUnreportedUsage(env);

    expect(exceptionsCaptured()).toEqual([]);
  });

  it("reports one exception, with counts, when rows were outstanding and none got through", async () => {
    // The job runs hourly, succeeds hourly, and every Stripe call errors.
    stubFetch(
      outstanding(),
      stubRoute(restMatch(env, "PATCH", "usage_events"), () => new Response(null, { status: 204 })).route,
      stubRoute(
        (url, request) =>
          request.method === "POST" &&
          url.href === "https://api.stripe.com/v1/billing/meter_events",
        () => new Response("nope", { status: 500 }),
      ).route,
    );

    await reportUnreportedUsage(env);

    const [failure] = exceptionsCaptured();
    expect(exceptionsCaptured()).toHaveLength(1);
    expect(failure.context).toEqual({
      source: "cron",
      job: "job:report-usage",
      extra: { found: 1, failed: 1 },
    });
    expect(failure.error).toBeInstanceOf(Error);
  });
});

describe(reportUnreportedUsage, () => {
  it("re-reports unstamped rows and stamps them; rows without a customer are skipped", async () => {
    const usageQuery = stubRoute(
      restMatch(env, "GET", "usage_events"),
      () => [
        {
          id: "u-1",
          quantity: 2,
          meter_identifier: TELNYX_ID,
          company_id: "c-1",
          created_at: METER_CREATED_AT,
          report_attempts: 0,
          companies: { stripe_customer_id: "cus_123" },
        },
        {
          id: "u-2",
          quantity: 3,
          meter_identifier: null,
          company_id: "c-1",
          created_at: METER_CREATED_AT,
          report_attempts: 0,
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

    const query = usageQuery.calls[0].url.searchParams;
    expect(query.get("stripe_reported_at")).toBe("is.null");
    expect(query.get("select")).toContain("companies!inner(stripe_customer_id)");
    expect(query.get("companies.stripe_customer_id")).toBe("not.is.null");
    expect(query.get("report_next_at")).toMatch(/^lte\./);
    expect(query.get("order")).toBe("report_next_at.asc,created_at.asc");

    // One meter event (u-1); u-2 has no customer yet and is skipped.
    expect(meter.calls).toHaveLength(1);
    const form = new URLSearchParams(String(meter.calls[0].body));
    expect(form.get("identifier")).toBe(TELNYX_ID);
    expect(form.get("payload[stripe_customer_id]")).toBe("cus_123");
    expect(form.get("payload[value]")).toBe("2");
    expect(form.get("timestamp")).toBe(String(Date.parse(METER_CREATED_AT) / 1000));

    expect(stamp.calls).toHaveLength(1);
    expect(stamp.calls[0].url.searchParams.get("id")).toBe("eq.u-1");
    expect(stamp.calls[0].url.searchParams.get("stripe_reported_at")).toBe(
      "is.null", // guarded stamp — never overwrites a concurrent report
    );
  });

  it("backs off and leaves rows unstamped when the meter call fails", async () => {
    const usageQuery = stubRoute(
      restMatch(env, "GET", "usage_events"),
      () => [
        {
          id: "u-3",
          quantity: 1,
          meter_identifier: TELNYX_ID,
          company_id: "c-1",
          created_at: METER_CREATED_AT,
          report_attempts: 2,
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
    const stamp = stubRoute(restMatch(env, "PATCH", "usage_events"), () =>
      new Response(null, { status: 204 }),
    );
    stubFetch(usageQuery.route, meter.route, stamp.route);

    const startedAt = Date.now();
    await reportUnreportedUsage(env);

    expect(stamp.calls).toHaveLength(1);
    const [update] = stamp.calls;
    expect(update.url.searchParams.get("company_id")).toBe("eq.c-1");
    expect(update.url.searchParams.get("report_attempts")).toBe("eq.2");
    expect(update.url.searchParams.get("stripe_reported_at")).toBe("is.null");
    expect(update.body).toEqual({
      report_attempts: 3,
      report_next_at: expect.any(String),
    });
    const nextAt = Date.parse((update.body as { report_next_at: string }).report_next_at);
    expect(nextAt).toBeGreaterThanOrEqual(startedAt + 4 * 60 * 60 * 1000);
  });

  it("retains a scrubbed meter cause when the retry cannot be scheduled", async () => {
    const usage = stubRoute(restMatch(env, "GET", "usage_events"), () => [
      {
        id: "u-3",
        quantity: 1,
        meter_identifier: TELNYX_ID,
        company_id: "c-1",
        created_at: METER_CREATED_AT,
        report_attempts: 2,
        companies: { stripe_customer_id: "cus_123" },
      },
    ]);
    const meter = stubRoute(
      (url, request) => request.method === "POST" && url.href === "https://api.stripe.com/v1/billing/meter_events",
      () => Response.json(
        { error: { type: "api_error", message: "Meter failed for reader@example.test" } },
        { status: 500 },
      ),
    );
    const retry = stubRoute(restMatch(env, "PATCH", "usage_events"), () =>
      Response.json({ message: "database unavailable" }, { status: 503 }),
    );
    stubFetch(usage.route, meter.route, retry.route);

    await expect(reportUnreportedUsage(env)).rejects.toMatchObject({
      message: "usage_events meter retry scheduling failed: database unavailable",
      cause: { message: "Meter failed for [email redacted]" },
    });
  });

  it("finishes the current row and leaves remaining rows for the next run when the budget expires", async () => {
    const startedAt = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    const usageQuery = stubRoute(restMatch(env, "GET", "usage_events"), () =>
      ["u-1", "u-2"].map((id) => ({
        id,
        quantity: 2,
        meter_identifier: null,
        company_id: "c-1",
        created_at: METER_CREATED_AT,
        report_attempts: 0,
        companies: { stripe_customer_id: "cus_123" },
      })),
    );
    const meter = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.stripe.com/v1/billing/meter_events",
      () => {
        clock.mockReturnValue(startedAt + 60_000);
        return { object: "billing.meter_event" };
      },
    );
    const stamp = stubRoute(restMatch(env, "PATCH", "usage_events"), () =>
      new Response(null, { status: 204 }),
    );
    stubFetch(usageQuery.route, meter.route, stamp.route);

    try {
      await reportUnreportedUsage(env);
    } finally {
      clock.mockRestore();
    }

    expect(meter.calls).toHaveLength(1);
    expect(stamp.calls.map((call) => call.url.searchParams.get("id"))).toEqual(["eq.u-1"]);
  });

  it("treats Stripe's duplicate-identifier rejection as success and stamps (#53)", async () => {
    const usageQuery = stubRoute(
      restMatch(env, "GET", "usage_events"),
      () => [
        {
          id: "u-4",
          quantity: 2,
          meter_identifier: TELNYX_ID,
          company_id: "c-1",
          created_at: METER_CREATED_AT,
          report_attempts: 0,
          companies: { stripe_customer_id: "cus_123" },
        },
      ],
    );
    // The row was reported on an earlier run whose stamp UPDATE failed:
    // Stripe now rejects the identifier reuse with an invalid_request_error
    // (exercised through the REAL stripe-node error parsing).
    const meter = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.stripe.com/v1/billing/meter_events",
      () =>
        Response.json(
          {
            error: {
              type: "invalid_request_error",
              message: `An event already exists with identifier ${TELNYX_ID}.`,
            },
          },
          { status: 400 },
        ),
    );
    const stamp = stubRoute(restMatch(env, "PATCH", "usage_events"), () =>
      new Response(null, { status: 204 }),
    );
    stubFetch(usageQuery.route, meter.route, stamp.route);

    await reportUnreportedUsage(env);

    // Stamped — the row leaves the hourly re-report set for good.
    expect(stamp.calls).toHaveLength(1);
    expect(stamp.calls[0].url.searchParams.get("id")).toBe("eq.u-4");
  });
});

describe("reportUnreportedVoiceUsage (D36)", () => {
  it("re-reports unstamped billed legs as RAW SECONDS and stamps them", async () => {
    const voiceQuery = stubRoute(
      restMatch(env, "GET", "call_records"),
      () => [
        {
          id: "cr-1",
          quantity: 61,
          meter_identifier: "leg-1",
          company_id: "c-1",
          created_at: METER_CREATED_AT,
          report_attempts: 0,
          companies: { stripe_customer_id: "cus_123" },
        },
        {
          id: "cr-2",
          quantity: 30,
          meter_identifier: "leg-2",
          company_id: "c-1",
          created_at: METER_CREATED_AT,
          report_attempts: 0,
          companies: { stripe_customer_id: null }, // no customer yet — skipped
        },
      ],
    );
    const meter = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.stripe.com/v1/billing/meter_events",
      () => ({ object: "billing.meter_event" }),
    );
    const stamp = stubRoute(restMatch(env, "PATCH", "call_records"), () =>
      new Response(null, { status: 204 }),
    );
    stubFetch(voiceQuery.route, meter.route, stamp.route);

    await reportUnreportedVoiceUsage(env);

    // The hygiene sweep stamps non-billable rows first (no id filter, an OR
    // on leg/seconds), then the queue read, then the per-row guarded stamp.
    // #133: the sweep must spare BOTH billed legs — a swept out_customer row
    // whose inline report failed would be silently un-billed forever.
    const sweep = stamp.calls.filter(
      (call) => call.url.searchParams.get("id") === null,
    );
    expect(sweep).toHaveLength(1);
    // D43: in_browser joins the spared billed legs (the #133 bug re-check).
    expect(sweep[0].url.searchParams.get("or")).toContain(
      "and(leg.neq.forward,leg.neq.out_customer,leg.neq.in_browser)",
    );

    // The queue is the local stamp gate, BILLED legs with billable time only
    // (one pool, both directions + D43 browser-answered — D38/D43).
    const query = voiceQuery.calls[0].url.searchParams;
    expect(query.get("stripe_reported_at")).toBe("is.null");
    expect(query.get("leg")).toBe("in.(forward,out_customer,in_browser)");
    expect(query.get("billable_seconds")).toBe("gt.0");
    expect(query.get("companies.stripe_customer_id")).toBe("not.is.null");
    expect(query.get("report_next_at")).toMatch(/^lte\./);

    expect(meter.calls).toHaveLength(1);
    const form = new URLSearchParams(String(meter.calls[0].body));
    expect(form.get("event_name")).toBe("voice_seconds");
    expect(form.get("identifier")).toBe("leg-1");
    expect(form.get("payload[value]")).toBe("61");
    expect(form.get("timestamp")).toBe(String(Date.parse(METER_CREATED_AT) / 1000));

    const rowStamps = stamp.calls.filter(
      (call) => call.url.searchParams.get("id") !== null,
    );
    expect(rowStamps).toHaveLength(1);
    expect(rowStamps[0].url.searchParams.get("id")).toBe("eq.cr-1");
    expect(rowStamps[0].url.searchParams.get("stripe_reported_at")).toBe(
      "is.null",
    );
  });

  it("is a no-op when the voice meter is not configured", async () => {
    const voiceQuery = stubRoute(restMatch(env, "GET", "call_records"));
    stubFetch(voiceQuery.route);
    await reportUnreportedVoiceUsage({
      ...env,
      STRIPE_VOICE_METER_EVENT_NAME: undefined,
    });
    expect(voiceQuery.calls).toHaveLength(0);
  });

  it("treats Stripe's duplicate-identifier rejection as success and stamps (#53)", async () => {
    const voiceQuery = stubRoute(
      restMatch(env, "GET", "call_records"),
      () => [
        {
          id: "cr-3",
          quantity: 120,
          meter_identifier: "leg-3",
          company_id: "c-1",
          created_at: METER_CREATED_AT,
          report_attempts: 0,
          companies: { stripe_customer_id: "cus_123" },
        },
      ],
    );
    const meter = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.stripe.com/v1/billing/meter_events",
      () =>
        Response.json(
          {
            error: {
              type: "invalid_request_error",
              message: "An event already exists with identifier leg-3.",
            },
          },
          { status: 400 },
        ),
    );
    const stamp = stubRoute(restMatch(env, "PATCH", "call_records"), () =>
      new Response(null, { status: 204 }),
    );
    stubFetch(voiceQuery.route, meter.route, stamp.route);

    await reportUnreportedVoiceUsage(env);

    const rowStamps = stamp.calls.filter(
      (call) => call.url.searchParams.get("id") !== null,
    );
    expect(rowStamps).toHaveLength(1);
    expect(rowStamps[0].url.searchParams.get("id")).toBe("eq.cr-3");
  });

  it("leaves rows unstamped when the meter call fails", async () => {
    const voiceQuery = stubRoute(
      restMatch(env, "GET", "call_records"),
      () => [
        {
          id: "cr-4",
          quantity: 90,
          meter_identifier: "leg-4",
          company_id: "c-1",
          created_at: METER_CREATED_AT,
          report_attempts: 0,
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
    const stamp = stubRoute(restMatch(env, "PATCH", "call_records"), () =>
      new Response(null, { status: 204 }),
    );
    stubFetch(voiceQuery.route, meter.route, stamp.route);

    await reportUnreportedVoiceUsage(env);
    const rowUpdates = stamp.calls.filter((call) => call.url.searchParams.has("id"));
    expect(rowUpdates).toHaveLength(1);
    expect(rowUpdates[0].body).toEqual({
      report_attempts: 1,
      report_next_at: expect.any(String),
    });
  });
});

describe("isDuplicateMeterIdentifierError (#53)", () => {
  it("matches the stripe-node duplicate-identifier shape", () => {
    expect(
      isDuplicateMeterIdentifierError({
        type: "StripeInvalidRequestError",
        rawType: "invalid_request_error",
        message: "An event already exists with identifier abc.",
      }),
    ).toBe(true);
  });

  it.each([
    ["a non-Stripe error", new Error("network down")],
    ["a different invalid_request_error", {
      rawType: "invalid_request_error",
      message: "Missing required param: event_name.",
    }],
    ["an identifier-shaped message on a non-Stripe error", {
      message: "identifier already exists",
    }],
    ["null", null],
  ])("stays a retryable failure for %s", (_label, cause) => {
    expect(isDuplicateMeterIdentifierError(cause)).toBe(false);
  });
});

describe("sweepStaleCalls — runaway cost backstop (D43, #145)", () => {
  /** Telnyx customer-leg hangup sink. */
  function hangupStub() {
    return stubRoute(
      (url, request) =>
        request.method === "POST" &&
        /\/v2\/calls\/[^/]+\/actions\/hangup$/.test(url.pathname),
      () => ({ data: { result: "ok" } }),
    );
  }

  function tailStubs() {
    return [
      stubRoute(
        restMatch(env, "DELETE", "outbound_call_authorizations"),
        () => new Response(null, { status: 204 }),
      ),
      stubRoute(rpcMatch(env, "api_sweep_stale_calls"), () => 0),
      stubRoute(restMatch(env, "GET", "calls", (url) => url.searchParams.has("voicemail_pending_since")), () => []),
    ];
  }

  /** Query (a) — the ANSWER-STAMPED arm. Empty unless a test needs it. */
  function answeredQueryStub(rows: unknown[] = []) {
    return stubRoute(
      restMatch(
        env,
        "GET",
        "calls",
        (url) => url.searchParams.get("answered_at") === "not.is.null",
      ),
      () => rows,
    );
  }

  /**
   * Query (b) — the answered_at IS NULL arm — answered from a fixture table
   * that APPLIES the request's `direction` filter the way PostgREST would.
   * Returning the rows regardless would let an inbound fixture pass against a
   * sweep that still filters `direction=eq.outbound` server-side, which is the
   * whole thing under test (#581).
   */
  function unstampedQueryStub(
    rows: {
      call_session_id: string;
      customer_call_control_id: string;
      direction: "inbound" | "outbound";
    }[],
  ) {
    return stubRoute(
      restMatch(
        env,
        "GET",
        "calls",
        (url) => url.searchParams.get("answered_at") === "is.null",
      ),
      (call) => {
        const direction = call.url.searchParams.get("direction");
        return rows
          .filter((row) => direction === null || direction === `eq.${row.direction}`)
          .map(({ call_session_id, customer_call_control_id }) => ({
            call_session_id,
            customer_call_control_id,
          }));
      },
    );
  }

  it("hangs up an OUTBOUND call whose answer stamp was lost — answered_at=null, aged by created_at (#145)", async () => {
    const hangup = hangupStub();
    const answered = answeredQueryStub();
    const unstamped = unstampedQueryStub([
      {
        call_session_id: "sess-unstamped",
        customer_call_control_id: "cust-ccid-unstamped",
        direction: "outbound",
      },
    ]);
    stubFetch(answered.route, unstamped.route, hangup.route, ...tailStubs().map((s) => s.route));

    await sweepStaleCalls(env);

    // Creation age is the bound: nothing stamped an answer on this leg.
    expect(unstamped.calls[0].url.searchParams.get("created_at")).toMatch(/^lt\./);
    expect(hangup.calls).toHaveLength(1);
    expect(hangup.calls[0].url.pathname).toBe(
      "/v2/calls/cust-ccid-unstamped/actions/hangup",
    );
  });

  it("logs no error for a call that already ended, and still logs a hang-up Telnyx failed", async () => {
    const hangup = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        /\/v2\/calls\/[^/]+\/actions\/hangup$/.test(url.pathname),
      (call) =>
        call.url.pathname.includes("cust-ccid-ended")
          ? Response.json(
              { errors: [{ code: "90018", title: "Call has already ended" }] },
              { status: 422 },
            )
          : Response.json({ errors: [{ code: "10007", title: "Unexpected error" }] }, { status: 500 }),
    );
    const unstamped = unstampedQueryStub([
      { call_session_id: "sess-ended", customer_call_control_id: "cust-ccid-ended", direction: "outbound" },
      { call_session_id: "sess-fault", customer_call_control_id: "cust-ccid-fault", direction: "outbound" },
    ]);
    stubFetch(answeredQueryStub().route, unstamped.route, hangup.route, ...tailStubs().map((s) => s.route));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    logged.mockClear();

    await sweepStaleCalls(env);

    expect(hangup.calls).toHaveLength(2);
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      "runaway-call-hangup:",
      expect.stringContaining("TelnyxApiError: Telnyx 500"),
      '{"callControlId":"cust-ccid-fault"}',
    );
  });

  it("hangs up an INBOUND leg WE answered into voicemail — answering to record never stamps answered_at (#581)", async () => {
    // The leg is live and billing on Telnyx: telnyx-answer-vm answered it to
    // play the greeting and record, and the recording webhooks that would have
    // ended the session were lost. answered_at stays null (it is the
    // member-answer billing anchor), and the row is inbound — so BOTH arms of
    // the sweep used to miss it and nothing ever bounded its cost.
    const hangup = hangupStub();
    const answered = answeredQueryStub();
    const unstamped = unstampedQueryStub([
      {
        call_session_id: "sess-vm",
        customer_call_control_id: "cust-ccid-vm",
        direction: "inbound",
      },
    ]);
    stubFetch(answered.route, unstamped.route, hangup.route, ...tailStubs().map((s) => s.route));

    await sweepStaleCalls(env);

    expect(hangup.calls.map((c) => c.url.pathname)).toEqual([
      "/v2/calls/cust-ccid-vm/actions/hangup",
    ]);
  });

  it("hangs up each distinct leg once across both the answered and unstamped sets", async () => {
    const hangup = hangupStub();
    const answered = answeredQueryStub([
      { call_session_id: "sess-a", customer_call_control_id: "ccid-a" },
      // Same leg surfaces in both queries — it must be hung up ONCE.
      { call_session_id: "sess-dup", customer_call_control_id: "ccid-dup" },
    ]);
    const unstamped = unstampedQueryStub([
      {
        call_session_id: "sess-dup",
        customer_call_control_id: "ccid-dup",
        direction: "outbound",
      },
      {
        call_session_id: "sess-b",
        customer_call_control_id: "ccid-b",
        direction: "inbound",
      },
    ]);
    stubFetch(answered.route, unstamped.route, hangup.route, ...tailStubs().map((s) => s.route));

    await sweepStaleCalls(env);

    const hungUp = hangup.calls.map((c) => c.url.pathname).toSorted();
    expect(hungUp).toEqual([
      "/v2/calls/ccid-a/actions/hangup",
      "/v2/calls/ccid-b/actions/hangup",
      "/v2/calls/ccid-dup/actions/hangup",
    ]);
  });

  it("hands BOTH sweep windows to the RPC as null - SQL owns the 4h conservative and 5m mirror-terminal thresholds (#209)", async () => {
    // The two-tier sweep semantics (a mirror-terminal outcome-null row
    // finalizes to the MATCHING outcome on the short window; an answered
    // call is never relabeled missed) live in api_sweep_stale_calls and are
    // pinned by supabase/tests/calls_feature.test.sql C-11. This side pins
    // the caller contract: one RPC call, both thresholds defaulted server-side.
    const calls = stubRoute(restMatch(env, "GET", "calls"), () => []);
    const authSweep = stubRoute(
      restMatch(env, "DELETE", "outbound_call_authorizations"),
      () => new Response(null, { status: 204 }),
    );
    const sweep = stubRoute(rpcMatch(env, "api_sweep_stale_calls"), () => 0);
    stubFetch(calls.route, authSweep.route, sweep.route);

    await sweepStaleCalls(env);

    expect(sweep.calls).toHaveLength(1);
    expect(sweep.calls[0].body).toEqual({
      p_stale_before: null,
      p_terminal_stale_before: null,
    });
  });
});
