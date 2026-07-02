/**
 * Meter event suite (SPEC §9 metering pipeline): asserts the exact wire shape
 * of `POST /v1/billing/meter_events`. Real stripe-node client over the stubbed
 * fetch edge.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { reportSegmentUsage } from "./meter";
import { endpoint, makeHarness } from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";

const env = completeEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reportSegmentUsage", () => {
  it("posts the meter event with env event_name, identifier, and payload mapping", async () => {
    const harness = makeHarness([
      endpoint("POST", /api\.stripe\.com\/v1\/billing\/meter_events/, () => ({
        object: "billing.meter_event",
        event_name: env.STRIPE_SMS_METER_EVENT_NAME,
      })),
    ]);
    stubFetch(harness.route);

    await reportSegmentUsage(env, {
      stripeCustomerId: "cus_1",
      value: 3,
      identifier: "telnyx_msg_40017abc",
    });

    const calls = harness.callsTo("POST", /meter_events/);
    expect(calls).toHaveLength(1);
    const form = calls[0].form();
    expect(form.get("event_name")).toBe("sms_segments");
    expect(form.get("identifier")).toBe("telnyx_msg_40017abc");
    expect(form.get("payload[stripe_customer_id]")).toBe("cus_1");
    expect(form.get("payload[value]")).toBe("3");
  });

  it.each([0, -2, 1.5, Number.NaN])(
    "rejects non-positive/non-integer value %s without touching the network",
    async (value) => {
      const harness = makeHarness([]);
      stubFetch(harness.route);
      await expect(
        reportSegmentUsage(env, {
          stripeCustomerId: "cus_1",
          value,
          identifier: "telnyx_msg_1",
        }),
      ).rejects.toThrow(/positive integer/);
      expect(harness.calls).toHaveLength(0);
    },
  );

  it("propagates Stripe failures so the caller leaves stripe_reported_at NULL", async () => {
    const harness = makeHarness([
      endpoint(
        "POST",
        /api\.stripe\.com\/v1\/billing\/meter_events/,
        () =>
          new Response(
            JSON.stringify({ error: { message: "rate limited", type: "invalid_request_error" } }),
            { status: 429 },
          ),
      ),
    ]);
    stubFetch(harness.route);
    await expect(
      reportSegmentUsage(env, {
        stripeCustomerId: "cus_1",
        value: 1,
        identifier: "telnyx_msg_2",
      }),
    ).rejects.toThrow();
  });
});
