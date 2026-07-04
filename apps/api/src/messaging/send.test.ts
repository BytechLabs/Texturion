/**
 * dispatchOutbound choke-point suite (SPEC §8, §10 layer 3, §12 step 18):
 * the per-company rate-limiter gate (binding present → allowed/denied paths;
 * absent → skipped, as in local dev and every other suite) and the
 * first_outbound_sent north-star capture (fires only for the company's first
 * Telnyx-accepted outbound, and only when POSTHOG_API_KEY is set). Real
 * product code — supabase-js PostgREST, the Telnyx HTTP call — with only
 * global fetch stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchOutbound } from "./send";
import { POSTHOG_CAPTURE_URL } from "../analytics/posthog";
import { getDb } from "../db";
import type { Env, RateLimiter } from "../env";
import { ApiError } from "../http/errors";
import {
  messageRow,
  restMatch,
  stubRoute,
  type Stub,
} from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const MESSAGE_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const TELNYX_ID = "40385f64-5717-4562-b3fc-2c963f66dddd";

const SEND_ARGS = {
  from: "+16135550100",
  to: "+16135551000",
  text: "On our way!",
  mediaUrls: [] as string[],
};

/** A fake Workers ratelimit binding recording its keys. */
function fakeLimiter(success: boolean): RateLimiter & {
  limit: ReturnType<typeof vi.fn>;
} {
  return { limit: vi.fn(async (_options: { key: string }) => ({ success })) };
}

interface DispatchStubs {
  telnyx: Stub;
  persist: Stub;
  outboundLookup: Stub;
  posthog: Stub;
}

function dispatchStubs(options: { priorOutbound?: boolean } = {}): DispatchStubs {
  const env = completeEnv();
  const telnyx = stubRoute(
    (url, request) =>
      request.method === "POST" &&
      url.href === "https://api.telnyx.com/v2/messages",
    () => ({ data: { id: TELNYX_ID } }),
  );
  const persist = stubRoute(restMatch(env, "PATCH", "messages"), (call) => [
    messageRow({
      id: MESSAGE_ID,
      company_id: COMPANY_ID,
      ...(call.body as Record<string, unknown>),
    }),
  ]);
  // The first-outbound existence probe: any OTHER dispatched outbound row.
  const outboundLookup = stubRoute(
    restMatch(env, "GET", "messages"),
    () => (options.priorOutbound ? [{ id: "some-earlier-outbound" }] : []),
  );
  const posthog = stubRoute(
    (url, request) =>
      request.method === "POST" && url.href === POSTHOG_CAPTURE_URL,
    () => ({ status: 1 }),
  );
  stubFetch(telnyx.route, persist.route, outboundLookup.route, posthog.route);
  return { telnyx, persist, outboundLookup, posthog };
}

function message() {
  return messageRow({ id: MESSAGE_ID, company_id: COMPANY_ID });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dispatchOutbound — §10 layer 3 rate limiter", () => {
  it("without the binding (local dev/tests) the gate is skipped entirely", async () => {
    const env = completeEnv();
    const stubs = dispatchStubs();

    const row = await dispatchOutbound(env, getDb(env), message(), SEND_ARGS);
    expect(row.telnyx_message_id).toBe(TELNYX_ID);
    expect(stubs.telnyx.calls).toHaveLength(1);
  });

  it("checks the limiter keyed on company_id before Telnyx and proceeds when allowed", async () => {
    const limiter = fakeLimiter(true);
    const env: Env = { ...completeEnv(), SEND_RATE_LIMITER: limiter };
    const stubs = dispatchStubs();

    const row = await dispatchOutbound(env, getDb(env), message(), SEND_ARGS);
    expect(limiter.limit).toHaveBeenCalledExactlyOnceWith({ key: COMPANY_ID });
    expect(stubs.telnyx.calls).toHaveLength(1);
    expect(row.telnyx_message_id).toBe(TELNYX_ID);
  });

  it("denial → §7 rate_limited thrown, retryable failure persisted, no Telnyx call", async () => {
    const limiter = fakeLimiter(false);
    const env: Env = { ...completeEnv(), SEND_RATE_LIMITER: limiter };
    const stubs = dispatchStubs();

    const thrown = await dispatchOutbound(
      env,
      getDb(env),
      message(),
      SEND_ARGS,
    ).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe("rate_limited");

    // Never reached Telnyx; the row carries a §7-retryable failure
    // (status failed + telnyx_message_id still NULL).
    expect(stubs.telnyx.calls).toHaveLength(0);
    expect(stubs.persist.calls).toHaveLength(1);
    expect(stubs.persist.calls[0].body).toMatchObject({
      status: "failed",
      error_code: "rate_limited",
    });
    expect(stubs.persist.calls[0].url.searchParams.get("company_id")).toBe(
      `eq.${COMPANY_ID}`,
    );
  });
});

describe("dispatchOutbound — first_outbound_sent (§12 step 18)", () => {
  it("skips the existence probe entirely when POSTHOG_API_KEY is unset", async () => {
    const env = completeEnv();
    const stubs = dispatchStubs();

    await dispatchOutbound(env, getDb(env), message(), SEND_ARGS);
    expect(stubs.outboundLookup.calls).toHaveLength(0);
    expect(stubs.posthog.calls).toHaveLength(0);
  });

  it("fires exactly for the company's first dispatched outbound (key set)", async () => {
    const env: Env = { ...completeEnv(), POSTHOG_API_KEY: "phc_test_key" };
    const stubs = dispatchStubs();

    await dispatchOutbound(env, getDb(env), message(), SEND_ARGS);

    // The probe: another outbound with a Telnyx id, excluding this row.
    expect(stubs.outboundLookup.calls).toHaveLength(1);
    const probe = stubs.outboundLookup.calls[0].url.searchParams;
    expect(probe.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(probe.get("direction")).toBe("eq.outbound");
    expect(probe.get("telnyx_message_id")).toBe("not.is.null");
    expect(probe.get("id")).toBe(`neq.${MESSAGE_ID}`);

    expect(stubs.posthog.calls).toHaveLength(1);
    expect(stubs.posthog.calls[0].body).toMatchObject({
      event: "first_outbound_sent",
      distinct_id: COMPANY_ID,
    });
  });

  it("stays silent when an earlier dispatched outbound exists", async () => {
    const env: Env = { ...completeEnv(), POSTHOG_API_KEY: "phc_test_key" };
    const stubs = dispatchStubs({ priorOutbound: true });

    await dispatchOutbound(env, getDb(env), message(), SEND_ARGS);
    expect(stubs.outboundLookup.calls).toHaveLength(1);
    expect(stubs.posthog.calls).toHaveLength(0);
  });

  it("does not fire on a Telnyx API failure", async () => {
    const env: Env = { ...completeEnv(), POSTHOG_API_KEY: "phc_test_key" };
    const failingTelnyx = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.telnyx.com/v2/messages",
      () =>
        Response.json(
          { errors: [{ code: "40310", detail: "Unreachable destination" }] },
          { status: 400 },
        ),
    );
    const persist = stubRoute(restMatch(env, "PATCH", "messages"), (call) => [
      messageRow({
        id: MESSAGE_ID,
        company_id: COMPANY_ID,
        ...(call.body as Record<string, unknown>),
      }),
    ]);
    const outboundLookup = stubRoute(restMatch(env, "GET", "messages"), () => []);
    const posthog = stubRoute(
      (url, request) =>
        request.method === "POST" && url.href === POSTHOG_CAPTURE_URL,
      () => ({ status: 1 }),
    );
    stubFetch(failingTelnyx.route, persist.route, outboundLookup.route, posthog.route);

    const row = await dispatchOutbound(env, getDb(env), message(), SEND_ARGS);
    expect(row.status).toBe("failed");
    expect(outboundLookup.calls).toHaveLength(0);
    expect(posthog.calls).toHaveLength(0);
  });

  it("a probe or capture failure never breaks the send", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const env: Env = { ...completeEnv(), POSTHOG_API_KEY: "phc_test_key" };
    const telnyx = stubRoute(
      (url, request) =>
        request.method === "POST" &&
        url.href === "https://api.telnyx.com/v2/messages",
      () => ({ data: { id: TELNYX_ID } }),
    );
    const persist = stubRoute(restMatch(env, "PATCH", "messages"), (call) => [
      messageRow({
        id: MESSAGE_ID,
        company_id: COMPANY_ID,
        ...(call.body as Record<string, unknown>),
      }),
    ]);
    // The probe answers a PostgREST failure (non-retryable 500) → the capture
    // path swallows it and the send still returns the dispatched row.
    const failingLookup = stubRoute(restMatch(env, "GET", "messages"), () =>
      Response.json({ message: "boom" }, { status: 500 }),
    );
    stubFetch(telnyx.route, persist.route, failingLookup.route);

    const row = await dispatchOutbound(env, getDb(env), message(), SEND_ARGS);
    expect(row.telnyx_message_id).toBe(TELNYX_ID);
    expect(consoleError).toHaveBeenCalled();
  });
});
