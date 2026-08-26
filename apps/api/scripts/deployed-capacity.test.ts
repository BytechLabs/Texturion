import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CAPACITY_RESULT_PREFIX,
  CapacityConfigError,
  CapacityRunError,
  PRODUCTION_SUPABASE_HOST,
  RealtimeCleanupFailure,
  RealtimeJoinFailure,
  assertContentFreeEvidence,
  expectedConfirmation,
  formatCapacityEvidence,
  initialRealtimeTransitionState,
  openSupabaseRealtimeConnection,
  parseRamp,
  performBoundedGet,
  runHostedCapacity,
  transitionRealtimeState,
  validateHostedCapacityInput,
  type CapacityEvidence,
  type HostedCapacityConfig,
  type HostedCapacityInput,
  type OpenRealtimeInput,
  type RealtimeConnection,
  type RealtimeStateSnapshot,
} from "./deployed-capacity-lib.ts";

const NOW_SECONDS = 2_000_000_000;
const COMPANY_ID = "51000000-0000-4000-8000-000000000251";
const API_ORIGIN = "https://api-staging.example.net";
const SUPABASE_ORIGIN = "https://abcdefghijklmnopqrst.supabase.co";
const TARGET_ID = "staging-capacity-251";
const PUBLISHABLE_KEY = `sb_publishable_${"p".repeat(32)}`;

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

function accessToken(
  subject = "51000000-0000-4000-8000-00000000025a",
  issuer = `${SUPABASE_ORIGIN}/auth/v1`,
): string {
  return jwt({
    iss: issuer,
    sub: subject,
    role: "authenticated",
    exp: NOW_SECONDS + 3_600,
  });
}

function input(overrides: Partial<HostedCapacityInput> = {}): HostedCapacityInput {
  const merged: HostedCapacityInput = {
    targetId: TARGET_ID,
    apiOrigin: API_ORIGIN,
    supabaseOrigin: SUPABASE_ORIGIN,
    companyId: COMPANY_ID,
    confirmation: "",
    accessToken: accessToken(),
    supabasePublishableKey: PUBLISHABLE_KEY,
    scenario: "all",
    apiRamp: [2, 4],
    realtimeRamp: [2, 4],
    apiRounds: 1,
    deadlineMs: 1_000,
    dwellMs: 1_000,
    ...overrides,
  };
  merged.confirmation =
    overrides.confirmation ??
    expectedConfirmation({
      targetId: merged.targetId,
      apiOrigin: merged.apiOrigin,
      supabaseOrigin: merged.supabaseOrigin,
    });
  return merged;
}

function config(overrides: Partial<HostedCapacityInput> = {}): HostedCapacityConfig {
  return validateHostedCapacityInput(input(overrides), NOW_SECONDS);
}

function response(status = 200): Response {
  return new Response("discarded body", { status });
}

function subscribedSnapshot(
  overrides: Partial<RealtimeStateSnapshot["postJoinTerminalEvents"]> = {},
): RealtimeStateSnapshot {
  return {
    current: "subscribed",
    postJoinTerminalEvents: {
      channel_error: 0,
      timed_out: 0,
      closed: 0,
      ...overrides,
    },
  };
}

function connection(
  joinedMs: number,
  snapshot: RealtimeConnection["snapshot"] = () => subscribedSnapshot(),
) {
  const close = vi.fn(async () => undefined);
  return { joinedMs, snapshot, close } satisfies RealtimeConnection;
}

function realtimeInput(deadlineMs = 1_000): OpenRealtimeInput {
  return {
    supabaseOrigin: SUPABASE_ORIGIN,
    publishableKey: PUBLISHABLE_KEY,
    accessToken: accessToken(),
    topic: `company:${COMPANY_ID}`,
    deadlineMs,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("deployed capacity target safety", () => {
  it.each([
    "https://loonext.com",
    "https://api.loonext.com",
    "https://app.loonext.com",
    "https://loonext-api.hayaturehmanahmadzai.workers.dev",
    "https://loonext-web.hayaturehmanahmadzai.workers.dev",
  ])("permanently refuses the live Loonext host %s", (apiOrigin) => {
    expect(() => config({ apiOrigin })).toThrow(/live Loonext/);
  });

  it("permanently refuses the public production Supabase project", () => {
    expect(() =>
      config({ supabaseOrigin: `https://${PRODUCTION_SUPABASE_HOST}` }),
    ).toThrow(/live Loonext Supabase/);
  });

  it.each([
    ["http://api-staging.example.net", SUPABASE_ORIGIN, /HTTPS/],
    ["https://127.0.0.1", SUPABASE_ORIGIN, /deployed non-production/],
    ["https://[fe80::1]", SUPABASE_ORIGIN, /deployed non-production/],
    ["https://[::ffff:127.0.0.1]", SUPABASE_ORIGIN, /deployed non-production/],
    ["https://[::ffff:10.0.0.1]", SUPABASE_ORIGIN, /deployed non-production/],
    ["https://api.loonext.com.", SUPABASE_ORIGIN, /canonical hostname/],
    [API_ORIGIN, `https://${PRODUCTION_SUPABASE_HOST}.`, /canonical hostname/],
    ["https://api-staging.example.net/path", SUPABASE_ORIGIN, /origin with no path/],
    ["https://api.other.loonext.com", SUPABASE_ORIGIN, /non-production marker/],
  ])("refuses an accidental target configuration", (apiOrigin, supabaseOrigin, message) => {
    expect(() => config({ apiOrigin, supabaseOrigin })).toThrow(message);
  });

  it("requires a target label that says non-production", () => {
    expect(() => config({ targetId: "customer-primary" })).toThrow(/safe slug containing/);
  });

  it("requires the exact target-bound authorization phrase", () => {
    expect(() => config({ confirmation: "yes" })).toThrow(
      `I_AUTHORIZE_NONPRODUCTION_CAPACITY_LOAD:${TARGET_ID}:api-staging.example.net:abcdefghijklmnopqrst.supabase.co`,
    );
  });

  it("binds every user credential to the supplied project and rejects privileged keys", () => {
    expect(() =>
      config({ accessToken: accessToken(undefined, "https://other.supabase.co/auth/v1") }),
    ).toThrow(/issuer/);

    expect(() => config({ supabasePublishableKey: "sb_secret_do-not-use" })).toThrow(
      /secret key is forbidden/,
    );

    const serviceKey = jwt({ role: "service_role" });
    expect(() => config({ supabasePublishableKey: serviceKey })).toThrow(/never service_role/);
  });

  it("rejects stale user tokens before making a request", () => {
    const stale = jwt({
      iss: `${SUPABASE_ORIGIN}/auth/v1`,
      sub: "51000000-0000-4000-8000-00000000025a",
      role: "authenticated",
      exp: NOW_SECONDS + 30,
    });
    expect(() => config({ accessToken: stale })).toThrow(/at least 10 minutes/);
  });

  it("requires token validity for the selected worst-case ramp, not a fixed window", () => {
    const apiRamp = Array.from({ length: 12 }, (_, index) => (index + 1) * 10);
    const oneHour = jwt({
      iss: `${SUPABASE_ORIGIN}/auth/v1`,
      sub: "51000000-0000-4000-8000-00000000025a",
      role: "authenticated",
      exp: NOW_SECONDS + 3_600,
    });
    expect(() =>
      config({
        scenario: "api",
        apiRamp,
        apiRounds: 10,
        deadlineMs: 60_000,
        accessToken: oneHour,
      }),
    ).toThrow(/for the selected ramp/);

    const longEnough = jwt({
      iss: `${SUPABASE_ORIGIN}/auth/v1`,
      sub: "51000000-0000-4000-8000-00000000025a",
      role: "authenticated",
      exp: NOW_SECONDS + 9_000,
    });
    expect(() =>
      config({
        scenario: "api",
        apiRamp,
        apiRounds: 10,
        deadlineMs: 60_000,
        accessToken: longEnough,
      }),
    ).not.toThrow();
  });

  it("budgets both API and Realtime confirmation controls into token validity", () => {
    const tokenExpiringIn = (seconds: number) =>
      jwt({
        iss: `${SUPABASE_ORIGIN}/auth/v1`,
        sub: "51000000-0000-4000-8000-00000000025a",
        role: "authenticated",
        exp: NOW_SECONDS + seconds,
      });
    const apiConfirmationConfig = {
      scenario: "api" as const,
      apiRamp: [1, 2, 3, 4, 5, 6],
      apiRounds: 2,
      deadlineMs: 60_000,
      dwellMs: 30_000,
    };
    expect(() =>
      config({ ...apiConfirmationConfig, accessToken: tokenExpiringIn(1_100) }),
    ).toThrow(/selected ramp/);
    expect(() =>
      config({ ...apiConfirmationConfig, accessToken: tokenExpiringIn(1_300) }),
    ).not.toThrow();

    const realtimeConfirmationConfig = {
      scenario: "realtime" as const,
      realtimeRamp: Array.from({ length: 12 }, (_, index) => index + 1),
      deadlineMs: 60_000,
      dwellMs: 30_000,
    };
    expect(() =>
      config({ ...realtimeConfirmationConfig, accessToken: tokenExpiringIn(1_800) }),
    ).toThrow(/selected ramp/);
    expect(() =>
      config({ ...realtimeConfirmationConfig, accessToken: tokenExpiringIn(2_000) }),
    ).not.toThrow();
  });

  it("requires a meaningful observation/cooldown dwell", () => {
    expect(() => config({ dwellMs: 0 })).toThrow(/--dwell-ms must be between 1000/);
  });

  it("parses only bounded increasing ramps", () => {
    expect(parseRamp("5,10,40", "--api-ramp")).toEqual([5, 10, 40]);
    expect(() => parseRamp("5,5", "--api-ramp")).toThrow(/strictly increasing/);
    expect(() => parseRamp("0,5", "--api-ramp")).toThrow(/increasing integers/);
  });
});

describe("bounded API ramp", () => {
  it("aborts a request that never settles and labels it only as a deadline", async () => {
    const never = vi.fn(
      async () => await new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch;
    const outcome = await performBoundedGet(
      never,
      "https://api-staging.example.net/v1/for-you",
      accessToken(),
      COMPANY_ID,
      5,
    );
    expect(outcome.status).toBe("deadline");
    expect(outcome.ms).toBeGreaterThanOrEqual(0);
  });

  it("uses GET with no body and inspects rather than follows redirects", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
      expect(init?.redirect).toBe("manual");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-company-id")).toBe(COMPANY_ID);
      expect(headers.get("authorization")).toBe(`Bearer ${accessToken()}`);
      return response();
    }) as unknown as typeof fetch;
    await expect(
      performBoundedGet(
        fetcher,
        `${API_ORIGIN}/v1/for-you`,
        accessToken(),
        COMPANY_ID,
        1_000,
      ),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("confirms a server ceiling only after cooldown, a healthy control, and an exact repeat", async () => {
    const statuses = [
      200, // /health preflight
      200, // authenticated /v1/for-you preflight
      200,
      200, // concurrency 2
      503,
      503,
      503,
      503, // concurrency 4 suspect
      200, // serialized recovery baseline
      503,
      503,
      503,
      503, // exact repeat confirms
    ];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (String(url).endsWith("/health")) {
        expect(headers.has("x-company-id")).toBe(false);
        expect(headers.has("authorization")).toBe(false);
      } else {
        expect(headers.get("x-company-id")).toBe(COMPANY_ID);
        expect(headers.get("authorization")).toBe(`Bearer ${accessToken()}`);
      }
      return response(statuses.shift() ?? 500);
    }) as unknown as typeof fetch;
    let tick = 0;
    const evidence = await runHostedCapacity(config({ scenario: "api" }), {
      fetch: fetcher,
      nowMs: () => tick++,
      sleep: vi.fn(async () => undefined),
    });

    expect(fetcher).toHaveBeenCalledTimes(13);
    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({
      scenario: "hosted-api-pooler-ramp",
      ceiling_reached: false,
      tested_bound: { concurrency: 2, requests: 2 },
      measurements: { statuses: { "200": 2 }, deadline_timeouts: 0 },
    });
    expect(evidence[1]).toMatchObject({
      ceiling_reached: true,
      tested_bound: {
        concurrency: 4,
        load_requests: 8,
        serialized_control_requests: 1,
      },
      measurements: {
        classification: "confirmed_capacity_ceiling",
        initial_wave: { statuses: { "503": 4 } },
        recovery_baseline: { statuses: { "200": 1 } },
        confirmation_wave: { statuses: { "503": 4 } },
      },
    });
  });

  it("aborts ordinary client errors and redirects before emitting the level", async () => {
    for (const badStatus of [401, 403, 422, 302]) {
      const emitted: CapacityEvidence[] = [];
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(response(200))
        .mockResolvedValueOnce(response(200))
        .mockResolvedValueOnce(response(badStatus)) as unknown as typeof fetch;
      await expect(
        runHostedCapacity(config({ scenario: "api", apiRamp: [1] }), {
          fetch: fetcher,
          onEvidence: (record) => emitted.push(record),
        }),
      ).rejects.toThrow(badStatus === 302 ? /target is invalid/ : /ordinary client error/);
      expect(emitted).toEqual([]);
    }
  });

  it("records but exits inconclusive for repeated network-only failures", async () => {
    const emitted: CapacityEvidence[] = [];
    const sequence: Array<number | "network"> = [200, 200, "network", 200, "network"];
    const fetcher = vi.fn(async () => {
      const next = sequence.shift();
      if (next === "network") throw new TypeError("unreviewed network detail");
      return response(next ?? 500);
    }) as unknown as typeof fetch;

    await expect(
      runHostedCapacity(config({ scenario: "api", apiRamp: [1] }), {
        fetch: fetcher,
        sleep: async () => undefined,
        onEvidence: (record) => emitted.push(record),
      }),
    ).rejects.toThrow(/network-only/);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      ceiling_reached: false,
      measurements: {
        classification: "inconclusive_network_candidate",
        initial_wave: { network_errors: 1 },
        confirmation_wave: { network_errors: 1 },
      },
    });
  });

  it("records but exits inconclusive when a server candidate does not reproduce", async () => {
    const emitted: CapacityEvidence[] = [];
    const statuses = [200, 200, 503, 200, 200];
    await expect(
      runHostedCapacity(config({ scenario: "api", apiRamp: [1] }), {
        fetch: vi.fn(async () => response(statuses.shift() ?? 500)) as unknown as typeof fetch,
        sleep: async () => undefined,
        onEvidence: (record) => emitted.push(record),
      }),
    ).rejects.toThrow(/transient or network-only/);
    expect(emitted[0]).toMatchObject({
      ceiling_reached: false,
      measurements: { classification: "transient_candidate_not_reproduced" },
    });
  });

  it("can confirm a repeated server signal while preserving mixed network counts", async () => {
    const sequence: Array<number | "network"> = [
      200,
      200,
      503,
      "network",
      200,
      503,
      "network",
    ];
    const fetcher = vi.fn(async () => {
      const next = sequence.shift();
      if (next === "network") throw new TypeError("unreviewed network detail");
      return response(next ?? 500);
    }) as unknown as typeof fetch;
    const [evidence] = await runHostedCapacity(
      config({ scenario: "api", apiRamp: [2] }),
      { fetch: fetcher, sleep: async () => undefined },
    );
    expect(evidence).toMatchObject({
      ceiling_reached: true,
      measurements: {
        classification: "confirmed_capacity_ceiling",
        initial_wave: { statuses: { "503": 1, network_error: 1 } },
        confirmation_wave: { statuses: { "503": 1, network_error: 1 } },
      },
    });
  });

  it("invalidates a suspect level when the serialized recovery control fails", async () => {
    const emitted: CapacityEvidence[] = [];
    const statuses = [200, 200, 503, 503];
    await expect(
      runHostedCapacity(config({ scenario: "api", apiRamp: [1] }), {
        fetch: vi.fn(async () => response(statuses.shift() ?? 500)) as unknown as typeof fetch,
        sleep: async () => undefined,
        onEvidence: (record) => emitted.push(record),
      }),
    ).rejects.toThrow(/recovery baseline failed/);
    expect(emitted).toEqual([]);
  });

  it("generates no load when either preflight fails", async () => {
    const unhealthy = vi.fn(async () => response(503)) as unknown as typeof fetch;
    await expect(
      runHostedCapacity(config({ scenario: "api" }), { fetch: unhealthy }),
    ).rejects.toThrow(/health preflight failed/);
    expect(unhealthy).toHaveBeenCalledTimes(1);

    const unauthorized = vi
      .fn()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(401)) as unknown as typeof fetch;
    await expect(
      runHostedCapacity(config({ scenario: "api" }), { fetch: unauthorized }),
    ).rejects.toThrow(/hot-path preflight failed/);
    expect(unauthorized).toHaveBeenCalledTimes(2);
  });
});

describe("hosted Realtime connection ramp", () => {
  it("opens cumulative independent connections, dwells, reports, and closes every handle", async () => {
    const handles: RealtimeConnection[] = [];
    let joinedMs = 1;
    const openRealtime = vi.fn(async (openInput) => {
      expect(openInput.accessToken).toBe(accessToken());
      expect(openInput.topic).toBe(`company:${COMPANY_ID}`);
      const handle = connection(joinedMs++);
      handles.push(handle);
      return handle;
    });
    const fetcher = vi.fn(async () => response()) as unknown as typeof fetch;
    const evidence = await runHostedCapacity(config({ scenario: "realtime" }), {
      fetch: fetcher,
      openRealtime,
      sleep: vi.fn(async () => undefined),
    });

    // One private-topic preflight, then 2 + 2 cumulative connections.
    expect(openRealtime).toHaveBeenCalledTimes(5);
    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({
      scenario: "hosted-realtime-connection-ramp",
      ceiling_reached: false,
      tested_bound: { requested_connections: 2 },
      measurements: {
        classification: "healthy_join_stability_level",
        attempted_connections: 2,
        stable_connections: 2,
        joined_connections: 2,
      },
    });
    expect(evidence[1]).toMatchObject({
      tested_bound: { requested_connections: 4 },
      measurements: {
        attempted_new_connections: 2,
        attempted_connections: 4,
        joined_connections: 4,
        stable_connections: 4,
      },
    });
    for (const handle of handles) expect(handle.close).toHaveBeenCalledOnce();
  });

  it("confirms a concurrent-connection ceiling only after reset, control, and repeat", async () => {
    let calls = 0;
    const handles: RealtimeConnection[] = [];
    const openRealtime = vi.fn(async () => {
      calls += 1;
      if (calls === 5 || calls === 10) throw new RealtimeJoinFailure("channel_error");
      const handle = connection(calls);
      handles.push(handle);
      return handle;
    });
    const evidence = await runHostedCapacity(config({ scenario: "realtime" }), {
      fetch: vi.fn(async () => response()) as unknown as typeof fetch,
      openRealtime,
      sleep: async () => undefined,
    });

    expect(evidence).toHaveLength(2);
    expect(evidence[1]).toMatchObject({
      ceiling_reached: true,
      measurements: {
        classification: "confirmed_join_or_stability_limit",
        repeated_signal_kinds: ["join_channel_error"],
        initial_cumulative_wave: {
          attempted_connections: 4,
          joined_connections: 3,
          stable_connections: 3,
          join_failures: { channel_error: 1 },
        },
        recovery_baseline: { stable_connections: 1 },
        confirmation_full_concurrency_wave: {
          attempted_connections: 4,
          joined_connections: 3,
          join_failures: { channel_error: 1 },
        },
      },
    });
    expect(openRealtime).toHaveBeenCalledTimes(10);
    for (const handle of handles) expect(handle.close).toHaveBeenCalledOnce();
  });

  it("records a non-reproduced join burst as inconclusive and exits nonzero", async () => {
    let calls = 0;
    const handles: RealtimeConnection[] = [];
    const emitted: CapacityEvidence[] = [];
    const openRealtime = vi.fn(async () => {
      calls += 1;
      if (calls === 3) throw new RealtimeJoinFailure("channel_error");
      const handle = connection(calls);
      handles.push(handle);
      return handle;
    });
    await expect(
      runHostedCapacity(config({ scenario: "realtime", realtimeRamp: [2] }), {
        fetch: vi.fn(async () => response()) as unknown as typeof fetch,
        openRealtime,
        sleep: async () => undefined,
        onEvidence: (record) => emitted.push(record),
      }),
    ).rejects.toThrow(/not confirmable/);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      ceiling_reached: false,
      measurements: { classification: "join_burst_candidate_not_reproduced" },
    });
    for (const handle of handles) expect(handle.close).toHaveBeenCalledOnce();
  });

  it("makes sticky post-join terminal events affect confirmation and evidence", async () => {
    let calls = 0;
    const openRealtime = vi.fn(async () => {
      calls += 1;
      const unstable = calls === 2 || calls === 4;
      return connection(calls, () =>
        subscribedSnapshot(unstable ? { channel_error: 1 } : {}),
      );
    });
    const [evidence] = await runHostedCapacity(
      config({ scenario: "realtime", realtimeRamp: [1] }),
      {
        fetch: vi.fn(async () => response()) as unknown as typeof fetch,
        openRealtime,
        sleep: async () => undefined,
      },
    );
    expect(evidence).toMatchObject({
      ceiling_reached: true,
      measurements: {
        classification: "confirmed_join_or_stability_limit",
        repeated_signal_kinds: ["post_join_channel_error"],
        initial_cumulative_wave: {
          stable_connections: 0,
          connections_with_post_join_terminal_event: 1,
          post_join_terminal_events: { channel_error: 1 },
        },
        confirmation_full_concurrency_wave: {
          connections_with_post_join_terminal_event: 1,
        },
      },
    });
  });

  it("bounds a preflight teardown that never settles", async () => {
    const cfg = config({ scenario: "realtime", realtimeRamp: [1] });
    cfg.deadlineMs = 5;
    const hangingProbe: RealtimeConnection = {
      joinedMs: 1,
      snapshot: () => subscribedSnapshot(),
      close: async () => await new Promise<void>(() => undefined),
    };
    await expect(
      runHostedCapacity(cfg, {
        fetch: vi.fn(async () => response()) as unknown as typeof fetch,
        openRealtime: async () => hangingProbe,
      }),
    ).rejects.toThrow(/cleanup exceeded its deadline/);
  });

  it("bounds a Realtime opener that never settles", async () => {
    const cfg = config({ scenario: "realtime", realtimeRamp: [1] });
    cfg.deadlineMs = 5;
    await expect(
      runHostedCapacity(cfg, {
        fetch: vi.fn(async () => response()) as unknown as typeof fetch,
        openRealtime: async () =>
          await new Promise<RealtimeConnection>(() => undefined),
      }),
    ).rejects.toThrow(/topic preflight failed/);
  });

  it("settles and closes successful sibling opens before propagating cleanup failure", async () => {
    const releaseSibling = deferred();
    const sibling = connection(2);
    let calls = 0;
    const openRealtime = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return connection(1); // private-topic preflight
      if (calls === 2) {
        await releaseSibling.promise;
        return sibling;
      }
      throw new RealtimeCleanupFailure();
    });
    const emitted: CapacityEvidence[] = [];
    const run = runHostedCapacity(
      config({ scenario: "realtime", realtimeRamp: [2] }),
      {
        fetch: vi.fn(async () => response()) as unknown as typeof fetch,
        openRealtime,
        sleep: async () => undefined,
        onEvidence: (record) => emitted.push(record),
      },
    );
    let settled = false;
    void run.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const rejection = expect(run).rejects.toBeInstanceOf(RealtimeCleanupFailure);
    await vi.waitFor(() => expect(openRealtime).toHaveBeenCalledTimes(3));
    expect(settled).toBe(false);
    expect(sibling.close).not.toHaveBeenCalled();
    releaseSibling.resolve();
    await rejection;
    expect(sibling.close).toHaveBeenCalledOnce();
    expect(emitted).toEqual([]);
  });

  it("does not emit a healthy Realtime bound before final cleanup succeeds", async () => {
    const cfg = config({ scenario: "realtime", realtimeRamp: [1] });
    cfg.deadlineMs = 5;
    let calls = 0;
    const emitted: CapacityEvidence[] = [];
    await expect(
      runHostedCapacity(cfg, {
        fetch: vi.fn(async () => response()) as unknown as typeof fetch,
        sleep: async () => undefined,
        openRealtime: async () => {
          calls += 1;
          if (calls === 1) return connection(1);
          return {
            joinedMs: 1,
            snapshot: () => subscribedSnapshot(),
            close: async () => await new Promise<void>(() => undefined),
          };
        },
        onEvidence: (record) => emitted.push(record),
      }),
    ).rejects.toThrow(/final Realtime cleanup/);
    expect(emitted).toEqual([]);
  });
});

describe("Supabase Realtime adapter lifecycle", () => {
  it("retains SUBSCRIBED -> CHANNEL_ERROR -> SUBSCRIBED and awaits shared cleanup", async () => {
    let subscriber: ((status: string) => void) | undefined;
    const remove = deferred();
    const disconnect = deferred();
    const channel = {
      subscribe: vi.fn((callback: (status: string) => void) => {
        subscriber = callback;
        return channel;
      }),
    };
    const fakeClient = {
      realtime: {
        setAuth: vi.fn(async () => undefined),
        disconnect: vi.fn(async () => {
          await disconnect.promise;
          return "ok" as const;
        }),
      },
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => {
        await remove.promise;
        return "ok" as const;
      }),
    } as unknown as SupabaseClient;

    const opening = openSupabaseRealtimeConnection(realtimeInput(), fakeClient);
    await vi.waitFor(() => expect(channel.subscribe).toHaveBeenCalledOnce());
    subscriber?.("SUBSCRIBED");
    const handle = await opening;
    subscriber?.("CHANNEL_ERROR");
    subscriber?.("SUBSCRIBED");
    expect(handle.snapshot()).toEqual({
      current: "subscribed",
      postJoinTerminalEvents: { channel_error: 1, timed_out: 0, closed: 0 },
    });

    let closed = false;
    const closing = handle.close().then(() => {
      closed = true;
    });
    await vi.waitFor(() => expect(fakeClient.removeChannel).toHaveBeenCalledOnce());
    expect(fakeClient.realtime.disconnect).not.toHaveBeenCalled();
    expect(closed).toBe(false);
    remove.resolve();
    await vi.waitFor(() => expect(fakeClient.realtime.disconnect).toHaveBeenCalledOnce());
    expect(closed).toBe(false);
    disconnect.resolve();
    await closing;
    expect(closed).toBe(true);
  });

  it("does not reject an initial terminal callback until bounded cleanup finishes", async () => {
    let subscriber: ((status: string) => void) | undefined;
    const remove = deferred();
    const disconnect = deferred();
    const channel = {
      subscribe: vi.fn((callback: (status: string) => void) => {
        subscriber = callback;
        return channel;
      }),
    };
    const fakeClient = {
      realtime: {
        setAuth: vi.fn(async () => undefined),
        disconnect: vi.fn(async () => {
          await disconnect.promise;
          return "ok" as const;
        }),
      },
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => {
        await remove.promise;
        return "ok" as const;
      }),
    } as unknown as SupabaseClient;
    const opening = openSupabaseRealtimeConnection(realtimeInput(), fakeClient);
    let rejected = false;
    void opening.catch(() => {
      rejected = true;
    });
    await vi.waitFor(() => expect(channel.subscribe).toHaveBeenCalledOnce());
    subscriber?.("CHANNEL_ERROR");
    await vi.waitFor(() => expect(fakeClient.removeChannel).toHaveBeenCalledOnce());
    expect(rejected).toBe(false);
    remove.resolve();
    await vi.waitFor(() => expect(fakeClient.realtime.disconnect).toHaveBeenCalledOnce());
    expect(rejected).toBe(false);
    disconnect.resolve();
    await expect(opening).rejects.toMatchObject({ code: "channel_error" });
    expect(rejected).toBe(true);
  });

  it("orders and bounds both cleanup phases when provider promises hang", async () => {
    let subscriber: ((status: string) => void) | undefined;
    const events: string[] = [];
    const never = new Promise<void>(() => undefined);
    const channel = {
      subscribe: vi.fn((callback: (status: string) => void) => {
        subscriber = callback;
        return channel;
      }),
    };
    const fakeClient = {
      realtime: {
        setAuth: vi.fn(async () => undefined),
        disconnect: vi.fn(() => {
          events.push("disconnect");
          return never;
        }),
      },
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(() => {
        events.push("remove");
        return never;
      }),
    } as unknown as SupabaseClient;
    const opening = openSupabaseRealtimeConnection(realtimeInput(200), fakeClient);
    await vi.waitFor(() => expect(channel.subscribe).toHaveBeenCalledOnce(), {
      interval: 1,
    });
    subscriber?.("SUBSCRIBED");
    const handle = await opening;
    await expect(
      handle.close().finally(() => {
        events.push("settled");
      }),
    ).rejects.toBeInstanceOf(CapacityRunError);
    expect(events).toEqual(["remove", "disconnect", "settled"]);
  });

  it.each(["timed out", "error"] as const)(
    "rejects a fulfilled removeChannel result of %s",
    async (removeResult) => {
      let subscriber: ((status: string) => void) | undefined;
      const channel = {
        subscribe: vi.fn((callback: (status: string) => void) => {
          subscriber = callback;
          return channel;
        }),
      };
      const fakeClient = {
        realtime: {
          setAuth: vi.fn(async () => undefined),
          disconnect: vi.fn(async () => "ok" as const),
        },
        channel: vi.fn(() => channel),
        removeChannel: vi.fn(async () => removeResult),
      } as unknown as SupabaseClient;
      const opening = openSupabaseRealtimeConnection(realtimeInput(), fakeClient);
      await vi.waitFor(() => expect(channel.subscribe).toHaveBeenCalledOnce());
      subscriber?.("SUBSCRIBED");
      const handle = await opening;
      await expect(handle.close()).rejects.toBeInstanceOf(CapacityRunError);
      expect(fakeClient.realtime.disconnect).toHaveBeenCalledOnce();
    },
  );

  it("rejects a fulfilled disconnect timeout", async () => {
    let subscriber: ((status: string) => void) | undefined;
    const channel = {
      subscribe: vi.fn((callback: (status: string) => void) => {
        subscriber = callback;
        return channel;
      }),
    };
    const fakeClient = {
      realtime: {
        setAuth: vi.fn(async () => undefined),
        disconnect: vi.fn(async () => "timeout" as const),
      },
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => "ok" as const),
    } as unknown as SupabaseClient;
    const opening = openSupabaseRealtimeConnection(realtimeInput(), fakeClient);
    await vi.waitFor(() => expect(channel.subscribe).toHaveBeenCalledOnce());
    subscriber?.("SUBSCRIBED");
    const handle = await opening;
    await expect(handle.close()).rejects.toBeInstanceOf(CapacityRunError);
    expect(fakeClient.removeChannel).toHaveBeenCalledOnce();
    expect(fakeClient.realtime.disconnect).toHaveBeenCalledOnce();
  });

  it.each(["remove", "disconnect"] as const)(
    "rejects when the %s cleanup phase rejects",
    async (failingPhase) => {
      let subscriber: ((status: string) => void) | undefined;
      const channel = {
        subscribe: vi.fn((callback: (status: string) => void) => {
          subscriber = callback;
          return channel;
        }),
      };
      const fakeClient = {
        realtime: {
          setAuth: vi.fn(async () => undefined),
          disconnect: vi.fn(async () => {
            if (failingPhase === "disconnect") throw new Error("unreviewed detail");
            return "ok" as const;
          }),
        },
        channel: vi.fn(() => channel),
        removeChannel: vi.fn(async () => {
          if (failingPhase === "remove") throw new Error("unreviewed detail");
          return "ok" as const;
        }),
      } as unknown as SupabaseClient;
      const opening = openSupabaseRealtimeConnection(realtimeInput(), fakeClient);
      await vi.waitFor(() => expect(channel.subscribe).toHaveBeenCalledOnce());
      subscriber?.("SUBSCRIBED");
      const handle = await opening;
      await expect(handle.close()).rejects.toBeInstanceOf(CapacityRunError);
      expect(fakeClient.realtime.disconnect).toHaveBeenCalledOnce();
    },
  );

  it("tracks every post-join terminal transition even after resubscription", () => {
    let state = initialRealtimeTransitionState();
    for (const status of [
      "SUBSCRIBED",
      "CHANNEL_ERROR",
      "SUBSCRIBED",
      "TIMED_OUT",
      "SUBSCRIBED",
      "CLOSED",
      "SUBSCRIBED",
    ]) {
      state = transitionRealtimeState(state, status);
    }
    expect(state).toEqual({
      current: "subscribed",
      subscribedOnce: true,
      postJoinTerminalEvents: { channel_error: 1, timed_out: 1, closed: 1 },
    });
  });
});

describe("CAPACITY_RESULT privacy", () => {
  it("serializes only aggregate evidence and rejects a future raw-value regression", async () => {
    const cfg = config({ scenario: "api", apiRamp: [1] });
    const [evidence] = await runHostedCapacity(cfg, {
      fetch: vi.fn(async () => response()) as unknown as typeof fetch,
    });
    const line = formatCapacityEvidence(evidence);

    expect(line.startsWith(CAPACITY_RESULT_PREFIX)).toBe(true);
    for (const value of cfg.sensitiveValues) {
      if (value.length >= 8) expect(line).not.toContain(value);
    }

    const unsafe: CapacityEvidence = {
      ...evidence,
      notes: [`raw target ${cfg.companyId}`],
    };
    expect(() => assertContentFreeEvidence(unsafe, cfg.sensitiveValues)).toThrow(
      CapacityRunError,
    );
  });

  it("uses curated configuration failures rather than embedding credential values", () => {
    const secret = "not-a-token-that-must-never-be-printed";
    let thrown: unknown;
    try {
      validateHostedCapacityInput(
        input({ accessToken: secret, confirmation: "wrong" }),
        NOW_SECONDS,
      );
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBeInstanceOf(CapacityConfigError);
    expect((thrown as Error).message).not.toContain(secret);
  });
});
