/**
 * dispatchOutbound choke-point suite (SPEC §8, §10 layer 3, §12 step 18; #12
 * mms cap): the per-company rate-limiter gate (binding present → allowed/denied
 * paths; absent → skipped, as in local dev and every other suite), the
 * first_outbound_sent north-star capture (fires only for the company's first
 * Telnyx-accepted outbound, and only when POSTHOG_API_KEY is set), and the #12
 * MMS cap-and-drop (over the plan's included picture messages → the media is
 * stripped and the send goes out text-only). Real product code — supabase-js
 * PostgREST, the Telnyx HTTP call — with only global fetch stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  claimMessageRetry,
  dispatchOutbound,
  persistSendInterruption,
  STUCK_SEND_SECONDS,
} from "./send";
import { POSTHOG_CAPTURE_URL } from "../analytics/posthog";
import { getDb } from "../db";
import type { Env, RateLimiter } from "../env";
import { ApiError } from "../http/errors";
import {
  messageRow,
  rpcMatch,
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

describe("dispatchOutbound — #12 MMS cap-and-drop", () => {
  const PERIOD_START = "2026-07-01T00:00:00.000Z";
  const MMS_ARGS = { ...SEND_ARGS, mediaUrls: ["https://signed/pic.jpg"] };

  interface MmsStubs {
    telnyx: Stub;
    persist: Stub;
    modules: Stub;
    company: Stub;
    mmsCount: Stub;
  }

  /** Telnyx + the three reads companyOverMmsCap makes (module → company → RPC). */
  function mmsStubs(options: { moduleOn?: boolean; used?: number } = {}): MmsStubs {
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
    const modules = stubRoute(restMatch(env, "GET", "company_modules"), () =>
      options.moduleOn === false ? [] : [{ module: "mms" }],
    );
    const company = stubRoute(restMatch(env, "GET", "companies"), () => [
      { plan: "starter", current_period_start: PERIOD_START },
    ]);
    const mmsCount = stubRoute(
      rpcMatch(env, "api_period_outbound_mms"),
      () => options.used ?? 0,
    );
    stubFetch(
      telnyx.route,
      persist.route,
      modules.route,
      company.route,
      mmsCount.route,
    );
    return { telnyx, persist, modules, company, mmsCount };
  }

  /** The media_urls the Telnyx call actually carried (undefined when stripped). */
  function sentMediaUrls(stubs: MmsStubs): unknown {
    return (stubs.telnyx.calls[0].body as { media_urls?: unknown }).media_urls;
  }

  it("under the cap forwards the media untouched", async () => {
    const env = completeEnv();
    const stubs = mmsStubs({ used: 149 }); // 149 of 150 included (starter)

    const row = await dispatchOutbound(env, getDb(env), message(), MMS_ARGS);

    expect(row.telnyx_message_id).toBe(TELNYX_ID);
    expect(sentMediaUrls(stubs)).toEqual(MMS_ARGS.mediaUrls);
    expect(stubs.mmsCount.calls[0].body).toEqual({
      p_company_id: COMPANY_ID,
      p_since: PERIOD_START,
    });
  });

  it("at the cap strips the media but still sends the text", async () => {
    const env = completeEnv();
    const stubs = mmsStubs({ used: 150 }); // exactly at the 150 allowance

    const row = await dispatchOutbound(env, getDb(env), message(), MMS_ARGS);

    // Cap-and-drop the PHOTO, keep the TEXT: the customer's message still sends.
    expect(row.telnyx_message_id).toBe(TELNYX_ID);
    expect(sentMediaUrls(stubs)).toBeUndefined();
    expect((stubs.telnyx.calls[0].body as { text?: string }).text).toBe(
      MMS_ARGS.text,
    );
  });

  it("well over the cap also strips the media", async () => {
    const env = completeEnv();
    const stubs = mmsStubs({ used: 400 });

    await dispatchOutbound(env, getDb(env), message(), MMS_ARGS);
    expect(sentMediaUrls(stubs)).toBeUndefined();
  });

  it("without the mms module the media is stripped fail-safe (no plan read)", async () => {
    const env = completeEnv();
    const stubs = mmsStubs({ moduleOn: false, used: 999 });

    const row = await dispatchOutbound(env, getDb(env), message(), MMS_ARGS);

    // Module off short-circuits AS over-cap (a future caller can't slip an
    // uncapped MMS past the routes' 409 gates): media stripped, text still
    // sends, and neither the company row nor the count RPC is read.
    expect(row.telnyx_message_id).toBe(TELNYX_ID);
    expect(sentMediaUrls(stubs)).toBeUndefined();
    expect((stubs.telnyx.calls[0].body as { text?: string }).text).toBe(
      MMS_ARGS.text,
    );
    expect(stubs.company.calls).toHaveLength(0);
    expect(stubs.mmsCount.calls).toHaveLength(0);
  });

  it("a media-only send at the cap fails fast instead of posting empty text", async () => {
    const env = completeEnv();
    const stubs = mmsStubs({ used: 150 });

    const thrown = await dispatchOutbound(env, getDb(env), message(), {
      ...MMS_ARGS,
      text: "",
    }).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe("conflict");

    // The media-only TOCTOU edge: never an empty-text Telnyx post; the row
    // carries a §7-retryable failure (status failed + telnyx_message_id NULL).
    expect(stubs.telnyx.calls).toHaveLength(0);
    expect(stubs.persist.calls).toHaveLength(1);
    expect(stubs.persist.calls[0].body).toMatchObject({
      status: "failed",
      error_code: "conflict",
    });
  });

  it("text-only sends skip the cap lookups entirely", async () => {
    const env = completeEnv();
    const stubs = mmsStubs({ used: 999 });

    await dispatchOutbound(env, getDb(env), message(), SEND_ARGS);

    // No media → the whole cap check is short-circuited before any read.
    expect(stubs.modules.calls).toHaveLength(0);
    expect(stubs.company.calls).toHaveLength(0);
    expect(stubs.mmsCount.calls).toHaveLength(0);
  });
});

describe("claimMessageRetry — the atomic retry arbiter (#19/#20/#47)", () => {
  function claimStubs(respond: () => unknown) {
    const env = completeEnv();
    const rpc = stubRoute(rpcMatch(env, "claim_message_retry"), respond);
    stubFetch(rpc.route);
    return { env, rpc };
  }

  const ARGS = {
    companyId: COMPANY_ID,
    messageId: MESSAGE_ID,
    stuckAfterSeconds: STUCK_SEND_SECONDS,
  };

  it("returns the requeued row and passes the RPC args through", async () => {
    const requeued = messageRow({
      id: MESSAGE_ID,
      company_id: COMPANY_ID,
      status: "queued",
      error_code: null,
      error_detail: null,
    });
    const { env, rpc } = claimStubs(() => ({ message: requeued }));

    const row = await claimMessageRetry(getDb(env), ARGS);
    expect(row).toEqual(requeued);
    expect(rpc.calls[0].body).toEqual({
      p_company_id: COMPANY_ID,
      p_message_id: MESSAGE_ID,
      p_stuck_after_seconds: STUCK_SEND_SECONDS,
    });
  });

  it.each([
    ["conflict", "conflict"],
    ["not_found", "not_found"],
    ["rate_limited", "rate_limited"],
    ["usage_cap_reached", "usage_cap_reached"],
    ["recipient_opted_out", "recipient_opted_out"],
    ["subscription_inactive", "subscription_inactive"],
  ] as const)("maps RPC error %s to the typed ApiError", async (rpcError, code) => {
    const { env } = claimStubs(() => ({ error: rpcError }));

    const thrown = await claimMessageRetry(getDb(env), ARGS).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe(code);
  });

  it("throws (500 path) on an unknown RPC error code", async () => {
    const { env } = claimStubs(() => ({ error: "space_weather" }));
    await expect(claimMessageRetry(getDb(env), ARGS)).rejects.toThrow(
      /unknown error: space_weather/,
    );
  });

  it("throws (500 path) when the RPC returns no message row", async () => {
    const { env } = claimStubs(() => ({}));
    await expect(claimMessageRetry(getDb(env), ARGS)).rejects.toThrow(
      /returned no message row/,
    );
  });
});

describe("persistSendInterruption (#20)", () => {
  it("fails the row out as retryable: failed + send_interrupted", async () => {
    const env = completeEnv();
    const persist = stubRoute(restMatch(env, "PATCH", "messages"), (call) => [
      messageRow({
        id: MESSAGE_ID,
        company_id: COMPANY_ID,
        ...(call.body as Record<string, unknown>),
      }),
    ]);
    stubFetch(persist.route);

    await persistSendInterruption(getDb(env), message(), "upload died");

    expect(persist.calls).toHaveLength(1);
    expect(persist.calls[0].body).toEqual({
      status: "failed",
      error_code: "send_interrupted",
      error_detail: "upload died",
    });
    expect(persist.calls[0].url.searchParams.get("id")).toBe(`eq.${MESSAGE_ID}`);
    expect(persist.calls[0].url.searchParams.get("company_id")).toBe(
      `eq.${COMPANY_ID}`,
    );
  });

  it("swallows a persist failure (logged) so the ORIGINAL error propagates", async () => {
    const env = completeEnv();
    const persist = stubRoute(restMatch(env, "PATCH", "messages"), () =>
      Response.json({ message: "db down" }, { status: 500 }),
    );
    stubFetch(persist.route);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // Must not throw — the caller rethrows the original interruption cause;
    // the fail-stuck sweeper cron is the durable backstop.
    await persistSendInterruption(getDb(env), message(), "upload died");
    expect(consoleError).toHaveBeenCalled();
  });
});
