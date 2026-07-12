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
import {
  failStuckOutboundSends,
  isDuplicateMeterIdentifierError,
  reportUnreportedUsage,
  reportUnreportedVoiceUsage,
  sweepWebhookEvents,
} from "./crons";
import { STUCK_SEND_SECONDS } from "./send";

const TELNYX_ID = "40385f64-5717-4562-b3fc-2c963f66cccc";

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

describe("sweepWebhookEvents", () => {
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

    // The sweep query selects by state: unprocessed, aged 2 min, < 5
    // attempts, and not shielded by another run's live claim lease (#22).
    const query = sweepQuery.calls[0].url.searchParams;
    expect(query.get("processed_at")).toBe("is.null");
    expect(query.get("attempts")).toBe("lt.5");
    expect(query.get("received_at")).toMatch(/^lt\./);
    expect(query.get("or")).toMatch(/claimed_at\.is\.null,claimed_at\.lt\./);

    // The row went through the REAL message.sent pipeline...
    expect(messagePatch.calls).toHaveLength(1);
    expect(messagePatch.calls[0].url.searchParams.get("telnyx_message_id")).toBe(
      `eq.${TELNYX_ID}`,
    );

    // ...after an atomic claim (CAS on attempts + claimed_at lease)...
    expect(ledgerPatch.calls).toHaveLength(2);
    const claim = ledgerPatch.calls[0];
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

  it("on failure the claim already counted the attempt — only last_error is recorded", async () => {
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
    // ...so the failure record carries the error ONLY (no double count).
    expect(ledgerPatch.calls[1].body).toEqual({
      last_error: expect.stringContaining("message.sent update failed"),
    });
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

  it("treats Stripe's duplicate-identifier rejection as success and stamps (#53)", async () => {
    const usageQuery = stubRoute(
      restMatch(env, "GET", "usage_events"),
      () => [
        {
          id: "u-4",
          quantity: 2,
          meter_identifier: TELNYX_ID,
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
          billable_seconds: 61, // reported verbatim — the gate's own measure
          call_leg_id: "leg-1",
          companies: { stripe_customer_id: "cus_123" },
        },
        {
          id: "cr-2",
          billable_seconds: 30,
          call_leg_id: "leg-2",
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

    expect(meter.calls).toHaveLength(1);
    const form = new URLSearchParams(String(meter.calls[0].body));
    expect(form.get("event_name")).toBe("voice_seconds");
    expect(form.get("identifier")).toBe("leg-1");
    expect(form.get("payload[value]")).toBe("61");

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
          billable_seconds: 120,
          call_leg_id: "leg-3",
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
          billable_seconds: 90,
          call_leg_id: "leg-4",
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
    // Only the hygiene sweep (no id filter) ran — the failed row keeps its
    // NULL stamp for the next hourly retry.
    expect(
      stamp.calls.filter((call) => call.url.searchParams.get("id") !== null),
    ).toHaveLength(0);
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
