/**
 * Status pipeline suite (SPEC §8, §9): message.sent transitions, finalized
 * delivered/failed (+40300 surfaced), authoritative parts/encoding/cost
 * stored, and the metering step — usage_events + Stripe meter event exactly
 * once under duplicate webhook delivery. Only global fetch is stubbed; the
 * Stripe meter event goes through the REAL billing contract (stripe-node on
 * fetch).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import {
  messageReceivedEvent,
  pgUniqueViolation,
  restMatch,
  stubRoute,
  type Stub,
} from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";
import { handleStatusEvent } from "./status";
import type { TelnyxEvent } from "./types";

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const MESSAGE_ID = "99999999-0000-4000-8000-000000000099";
const TELNYX_ID = "40385f64-5717-4562-b3fc-2c963f66bbbb";
const USAGE_ID = "77777777-0000-4000-8000-000000000077";

let env: Env;

beforeEach(() => {
  env = completeEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function finalizedEvent(overrides: {
  toStatus?: string;
  parts?: number;
  type?: "SMS" | "MMS";
  errors?: { code: string; title?: string; detail?: string }[];
  cost?: { amount: string; currency: string };
} = {}): TelnyxEvent {
  return {
    data: {
      event_type: "message.finalized",
      id: "f1f1f1f1-0000-4000-8000-000000000001",
      payload: {
        id: TELNYX_ID,
        type: overrides.type ?? "SMS",
        direction: "outbound",
        parts: overrides.parts ?? 2,
        encoding: "GSM-7",
        cost: overrides.cost ?? { amount: "0.0080", currency: "USD" },
        to: [
          {
            phone_number: "+16135551000",
            status: overrides.toStatus ?? "delivered",
          },
        ],
        errors: overrides.errors ?? [],
      },
    },
  } as TelnyxEvent;
}

function stripeMeterStub(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "POST" &&
      url.href === "https://api.stripe.com/v1/billing/meter_events",
    () => ({ object: "billing.meter_event" }),
  );
}

describe("message.sent", () => {
  it("moves queued outbound rows to sent, guarded against regressions", async () => {
    const patch = stubRoute(restMatch(env, "PATCH", "messages"), () =>
      new Response(null, { status: 204 }),
    );
    stubFetch(patch.route);

    await handleStatusEvent(env, {
      data: {
        event_type: "message.sent",
        id: "s1",
        payload: { id: TELNYX_ID },
      },
    });

    expect(patch.calls).toHaveLength(1);
    const url = patch.calls[0].url;
    expect(url.searchParams.get("telnyx_message_id")).toBe(`eq.${TELNYX_ID}`);
    expect(url.searchParams.get("status")).toBe("eq.queued"); // no regressions
    expect(url.searchParams.get("direction")).toBe("eq.outbound");
    expect(patch.calls[0].body).toEqual({ status: "sent" });
  });
});

describe("message.finalized", () => {
  function baseStubs(options: {
    direction?: string;
    usageInsert?: (call: unknown) => Response | unknown;
  } = {}) {
    const lookup = stubRoute(restMatch(env, "GET", "messages"), () => [
      {
        id: MESSAGE_ID,
        company_id: COMPANY_ID,
        direction: options.direction ?? "outbound",
      },
    ]);
    const update = stubRoute(restMatch(env, "PATCH", "messages"), () =>
      new Response(null, { status: 204 }),
    );
    const usageInsert = stubRoute(
      restMatch(env, "POST", "usage_events"),
      options.usageInsert ?? (() => [{ id: USAGE_ID }]),
    );
    const companyLookup = stubRoute(restMatch(env, "GET", "companies"), () => [
      { stripe_customer_id: "cus_123" },
    ]);
    const usageStamp = stubRoute(restMatch(env, "PATCH", "usage_events"), () =>
      new Response(null, { status: 204 }),
    );
    const meter = stripeMeterStub();
    return { lookup, update, usageInsert, companyLookup, usageStamp, meter };
  }

  it("stores authoritative parts/encoding/cost, meters, and stamps", async () => {
    const stubs = baseStubs();
    stubFetch(
      stubs.lookup.route,
      stubs.update.route,
      stubs.usageInsert.route,
      stubs.companyLookup.route,
      stubs.usageStamp.route,
      stubs.meter.route,
    );

    await handleStatusEvent(env, finalizedEvent({ parts: 2 }));

    expect(stubs.update.calls[0].body).toMatchObject({
      status: "delivered",
      segments: 2,
      encoding: "GSM-7",
      provider_cost: 0.008,
      error_code: null,
      error_detail: null,
    });

    // §9 metering: usage_events row keyed to the message.
    expect(stubs.usageInsert.calls).toHaveLength(1);
    expect(stubs.usageInsert.calls[0].body).toMatchObject({
      company_id: COMPANY_ID,
      message_id: MESSAGE_ID,
      type: "sms_outbound",
      quantity: 2,
      meter_identifier: TELNYX_ID,
    });

    // Stripe meter event with identifier = telnyx_message_id.
    expect(stubs.meter.calls).toHaveLength(1);
    const form = new URLSearchParams(String(stubs.meter.calls[0].body));
    expect(form.get("event_name")).toBe(env.STRIPE_SMS_METER_EVENT_NAME);
    expect(form.get("identifier")).toBe(TELNYX_ID);
    expect(form.get("payload[stripe_customer_id]")).toBe("cus_123");
    expect(form.get("payload[value]")).toBe("2");

    // Local stamp gates the hourly re-reporter.
    expect(stubs.usageStamp.calls).toHaveLength(1);
    expect(stubs.usageStamp.calls[0].body).toMatchObject({
      stripe_reported_at: expect.any(String),
    });
  });

  it("meters MMS as 3 segments regardless of parts (§2)", async () => {
    const stubs = baseStubs();
    stubFetch(
      stubs.lookup.route,
      stubs.update.route,
      stubs.usageInsert.route,
      stubs.companyLookup.route,
      stubs.usageStamp.route,
      stubs.meter.route,
    );

    await handleStatusEvent(env, finalizedEvent({ type: "MMS", parts: 1 }));

    expect(stubs.usageInsert.calls[0].body).toMatchObject({
      type: "mms_outbound",
      quantity: 3,
    });
    const form = new URLSearchParams(String(stubs.meter.calls[0].body));
    expect(form.get("payload[value]")).toBe("3");
  });

  it("surfaces a 40300 carrier block: status failed + error_code stored (never silent)", async () => {
    const stubs = baseStubs();
    stubFetch(
      stubs.lookup.route,
      stubs.update.route,
      stubs.usageInsert.route,
      stubs.companyLookup.route,
      stubs.usageStamp.route,
      stubs.meter.route,
    );

    await handleStatusEvent(
      env,
      finalizedEvent({
        toStatus: "delivery_failed",
        errors: [
          {
            code: "40300",
            title: "Blocked as spam",
            detail: "The recipient has opted out on the carrier side.",
          },
        ],
      }),
    );

    expect(stubs.update.calls[0].body).toMatchObject({
      status: "failed",
      error_code: "40300",
      error_detail: "The recipient has opted out on the carrier side.",
    });
  });

  it("meters exactly once under duplicate finalized delivery (unique conflict)", async () => {
    const stubs = baseStubs({ usageInsert: () => pgUniqueViolation() });
    stubFetch(
      stubs.lookup.route,
      stubs.update.route,
      stubs.usageInsert.route,
      stubs.companyLookup.route,
      stubs.usageStamp.route,
      stubs.meter.route,
    );

    await handleStatusEvent(env, finalizedEvent());

    expect(stubs.usageInsert.calls).toHaveLength(1); // attempted...
    expect(stubs.meter.calls).toHaveLength(0); // ...but never re-metered
    expect(stubs.usageStamp.calls).toHaveLength(0);
  });

  it("never meters inbound rows", async () => {
    const stubs = baseStubs({ direction: "inbound" });
    stubFetch(
      stubs.lookup.route,
      stubs.update.route,
      stubs.usageInsert.route,
      stubs.companyLookup.route,
      stubs.usageStamp.route,
      stubs.meter.route,
    );

    await handleStatusEvent(env, finalizedEvent());
    expect(stubs.usageInsert.calls).toHaveLength(0);
    expect(stubs.meter.calls).toHaveLength(0);
  });

  it("acks an unknown telnyx_message_id as a no-op (§8)", async () => {
    const lookup = stubRoute(restMatch(env, "GET", "messages"), () => []);
    const update = stubRoute(restMatch(env, "PATCH", "messages"));
    stubFetch(lookup.route, update.route);

    await handleStatusEvent(env, finalizedEvent());
    expect(update.calls).toHaveLength(0);
  });

  it("leaves stripe_reported_at NULL when the meter call fails (cron re-reports)", async () => {
    const stubs = baseStubs();
    const failingMeter = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.stripe.com/v1/billing/meter_events",
      () => Response.json({ error: { message: "nope" } }, { status: 500 }),
    );
    stubFetch(
      stubs.lookup.route,
      stubs.update.route,
      stubs.usageInsert.route,
      stubs.companyLookup.route,
      stubs.usageStamp.route,
      failingMeter.route,
    );

    await handleStatusEvent(env, finalizedEvent());
    expect(stubs.usageInsert.calls).toHaveLength(1);
    expect(stubs.usageStamp.calls).toHaveLength(0); // unstamped → re-reported
  });

  it("ignores message.received payloads routed here by mistake", async () => {
    const lookup = stubRoute(restMatch(env, "GET", "messages"), () => []);
    stubFetch(lookup.route);
    await handleStatusEvent(env, messageReceivedEvent() as TelnyxEvent);
    // no throw, nothing updated — dispatch guards on event_type anyway
  });
});
