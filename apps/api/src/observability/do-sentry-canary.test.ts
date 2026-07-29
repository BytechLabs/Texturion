/**
 * #375 — the canary that proves the alert channel, tested for the two ways it
 * would lie.
 *
 * A canary is only worth having if its silence is trustworthy, so the cases
 * that matter most here are the FALSE PASSES: a probe that records a heartbeat
 * when Sentry rejected the event, or when no client exists in the isolate,
 * would be worse than no canary at all — it would convert "we don't know" into
 * a positive claim that everything is fine.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import {
  CANARY_SESSION_NAME,
  channelIsHealthy,
  parseDsn,
  probeSentryChannel,
  runDoSentryCanaryJob,
  type SentryChannelProbe,
} from "./do-sentry-canary";

const DSN = "https://abc123@o42.ingest.sentry.io/4507";

function env(overrides: Partial<Env> = {}): Env {
  return { SENTRY_DSN: DSN, ...overrides } as unknown as Env;
}

/** A fetch that records the call and answers with the given status. */
function stubFetch(status: number) {
  const calls: { url: string; body: string }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return new Response(status === 200 ? '{"id":"deadbeef"}' : "nope", { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("parseDsn", () => {
  it("splits a DSN into the parts the envelope endpoint needs", () => {
    expect(parseDsn(DSN)).toEqual({
      origin: "https://o42.ingest.sentry.io",
      publicKey: "abc123",
      projectId: "4507",
    });
  });

  it("refuses a DSN with no public key or no project, rather than building a 404", () => {
    // A malformed DSN that produced a 404 would report as a channel outage,
    // sending somebody to look at Sentry's status page over a typo of ours.
    expect(parseDsn("https://o42.ingest.sentry.io/4507")).toBeNull();
    expect(parseDsn("https://abc123@o42.ingest.sentry.io/")).toBeNull();
    expect(parseDsn("not-a-url")).toBeNull();
  });
});

describe("probeSentryChannel", () => {
  it("posts a debug-level envelope to the DSN's ingest endpoint and passes on 200", async () => {
    const { impl, calls } = stubFetch(200);
    const probe = await probeSentryChannel(env(), () => ({}), new Date(0), impl);

    expect(channelIsHealthy(probe)).toBe(true);
    expect(probe.ingestStatus).toBe(200);
    expect(probe.detail).toBeNull();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/api/4507/envelope/");
    expect(calls[0].url).toContain("sentry_key=abc123");

    // The event must be debug-level: it arrives four times a day forever, and
    // a canary that pages anyone is a canary somebody eventually mutes.
    const [, , item] = calls[0].body.split("\n");
    const event = JSON.parse(item);
    expect(event.level).toBe("debug");
    expect(event.tags).toEqual({ canary: "do-sentry", runtime: "durable-object" });
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("fails when Sentry rejects the event, and says so", async () => {
    const { impl } = stubFetch(403);
    const probe = await probeSentryChannel(env(), () => ({}), new Date(0), impl);

    expect(channelIsHealthy(probe)).toBe(false);
    expect(probe.ingestStatus).toBe(403);
    expect(probe.detail).toContain("403");
  });

  it("treats rate-limiting as a failure and names it, because dropped alerts are no alerts", async () => {
    const { impl } = stubFetch(429);
    const probe = await probeSentryChannel(env(), () => ({}), new Date(0), impl);

    expect(channelIsHealthy(probe)).toBe(false);
    expect(probe.detail).toContain("rate-limiting");
  });

  it("fails when the isolate has no Sentry client, even though the channel is fine", async () => {
    // THE regression #375 exists for: ingest is perfectly healthy, and nothing
    // is wired to speak into it. A probe that only checked the network would
    // report this as green forever.
    const { impl } = stubFetch(200);
    const probe = await probeSentryChannel(env(), () => undefined, new Date(0), impl);

    expect(probe.ingestOk).toBe(true);
    expect(probe.clientPresent).toBe(false);
    expect(channelIsHealthy(probe)).toBe(false);
    expect(probe.detail).toContain("§2.1");
  });

  it("does not attempt a request when no DSN is configured", async () => {
    const { impl, calls } = stubFetch(200);
    const probe = await probeSentryChannel(
      env({ SENTRY_DSN: undefined as unknown as string }),
      () => ({}),
      new Date(0),
      impl,
    );

    expect(channelIsHealthy(probe)).toBe(false);
    expect(probe.detail).toContain("SENTRY_DSN");
    expect(calls).toHaveLength(0);
  });

  it("reports a network failure rather than throwing into the cron", async () => {
    const impl = vi.fn(async () => {
      throw new Error("connection reset");
    }) as unknown as typeof fetch;
    const probe = await probeSentryChannel(env(), () => ({}), new Date(0), impl);

    expect(channelIsHealthy(probe)).toBe(false);
    expect(probe.ingestStatus).toBeNull();
    expect(probe.detail).toContain("connection reset");
  });
});

describe("runDoSentryCanaryJob", () => {
  function namespace(probe: SentryChannelProbe | Error) {
    const stub = {
      probeAlertChannel: vi.fn(async () => {
        if (probe instanceof Error) throw probe;
        return probe;
      }),
    };
    const names: string[] = [];
    return {
      stub,
      names,
      binding: {
        idFromName: (name: string) => {
          names.push(name);
          return { name };
        },
        get: () => stub,
      },
    };
  }

  const healthy: SentryChannelProbe = {
    clientPresent: true,
    ingestOk: true,
    ingestStatus: 200,
    detail: null,
  };

  /** A db whose only job is to remember which heartbeats were written. */
  function heartbeatDb() {
    const written: string[] = [];
    const rpc = vi.fn(async (_fn: string, args: { p_key: string }) => {
      written.push(args.p_key);
      return { data: { recovered: false }, error: null };
    });
    return { written, db: { rpc } as unknown as SupabaseClient };
  }

  it("records the heartbeat when both assertions pass", async () => {
    const ns = namespace(healthy);
    const { written, db } = heartbeatDb();
    const testEnv = env({ CALL_SESSIONS: ns.binding } as unknown as Partial<Env>);

    await runDoSentryCanaryJob(testEnv, new Date(0), db);

    expect(ns.stub.probeAlertChannel).toHaveBeenCalledOnce();
    expect(written).toEqual(["channel:do-sentry"]);
  });

  it("writes no heartbeat when the channel is unhealthy", async () => {
    // The false pass this whole file exists to prevent: a green ledger while
    // Sentry is rejecting every event.
    const ns = namespace({ ...healthy, ingestOk: false, ingestStatus: 403 });
    const { written, db } = heartbeatDb();
    const testEnv = env({ CALL_SESSIONS: ns.binding } as unknown as Partial<Env>);

    const probe = await runDoSentryCanaryJob(testEnv, new Date(0), db);

    // Returned for the log, but the ledger stays silent — and that silence is
    // what the checker turns into an email one grace window later.
    expect(probe?.ingestOk).toBe(false);
    expect(written).toEqual([]);
  });

  it("writes no heartbeat when the client is missing but ingest is fine", async () => {
    const ns = namespace({ ...healthy, clientPresent: false });
    const { written, db } = heartbeatDb();
    const testEnv = env({ CALL_SESSIONS: ns.binding } as unknown as Partial<Env>);

    await runDoSentryCanaryJob(testEnv, new Date(0), db);

    expect(written).toEqual([]);
  });

  it("writes no heartbeat when the Durable Object will not answer", async () => {
    const ns = namespace(new Error("DO unreachable"));
    const { written, db } = heartbeatDb();
    const testEnv = env({ CALL_SESSIONS: ns.binding } as unknown as Partial<Env>);

    await expect(runDoSentryCanaryJob(testEnv, new Date(0), db)).resolves.toBeNull();
    expect(written).toEqual([]);
  });

  it("is a logged no-op when no DO namespace is bound", async () => {
    // Local dev and every existing fixture. Nothing to probe is not a fault,
    // and `channel:do-sentry` is withheld from the expectations to match.
    const { written, db } = heartbeatDb();
    await expect(runDoSentryCanaryJob(env(), new Date(0), db)).resolves.toBeNull();
    expect(written).toEqual([]);
  });

  it("always probes the reserved instance, never a real session id", async () => {
    const ns = namespace(healthy);
    const { db } = heartbeatDb();
    const testEnv = env({ CALL_SESSIONS: ns.binding } as unknown as Partial<Env>);
    await runDoSentryCanaryJob(testEnv, new Date(0), db);

    // CallSessionDO keys on idFromName(sessionId). A canary that collided with
    // a live call's instance would run its probe inside a call in progress.
    expect(ns.names).toEqual([CANARY_SESSION_NAME]);
    expect(CANARY_SESSION_NAME).not.toMatch(/^[0-9a-f-]{36}$/);
  });
});
