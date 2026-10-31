/**
 * D142 PW01: the daily read of production's Telnyx wiring.
 *
 * Driven through the real Telnyx client and the real env schema, with only
 * the network edge stubbed, so "read only" and "nothing left" are facts about
 * the requests that were actually made.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEnv, type Env } from "../env";
import { rigEnv } from "../test/rig-env";
import { completeEnv, stubFetch } from "../test/support";
import { opsCaptures, resetSentryCaptures } from "../test/sentry-mock";
import { runTelnyxWiringWatch } from "./telnyx-wiring";

vi.mock("@sentry/cloudflare", async () =>
  (await import("../test/sentry-mock")).sentryModuleMock(),
);

const WEBHOOK = "https://api.loonext.com/webhooks/telnyx";
const EDGE = "https://edge-acct.workers.dev/t/v";
const VOICE_ID = completeEnv().TELNYX_VOICE_CONNECTION_ID;
const WEBRTC_ID = completeEnv().TELNYX_WEBRTC_CONNECTION_ID as string;
/** What a credential connection returns and nothing here may repeat. */
const PASSWORD = "do-not-repeat-this-password";
/** What a delivery's payload carries and nothing here may repeat. */
const CUSTOMER_NUMBER = "+14165550123";
const CUSTOMER_TEXT = "the gate code is 4471";

const production = (): Env => getEnv({ ...completeEnv(), DEPLOY_ENV: "production" });

interface Account {
  voice?: Record<string, unknown> | null;
  webrtc?: Record<string, unknown> | null;
  profilePages?: Record<string, unknown>[][];
  deliveries?: Record<string, unknown>[];
  ownProfiles?: string[];
}

function wired(): Required<Account> {
  return {
    voice: {
      webhook_event_url: WEBHOOK,
      webhook_event_failover_url: WEBHOOK,
      webhook_api_version: "2",
    },
    webrtc: {
      webhook_event_url: WEBHOOK,
      webhook_event_failover_url: null,
      webhook_api_version: "2",
      password: PASSWORD,
    },
    profilePages: [
      [
        { id: "mp-1", webhook_url: WEBHOOK, webhook_failover_url: WEBHOOK, webhook_api_version: "2" },
        { id: "mp-2", webhook_url: WEBHOOK, webhook_failover_url: WEBHOOK },
        // The rig's, in the same account. Not production's to judge.
        { id: "mp-rig", webhook_url: EDGE, webhook_failover_url: null },
      ],
    ],
    deliveries: [],
    ownProfiles: ["mp-1", "mp-2"],
  };
}

function delivery(eventType: string, urls: string[], status: number | null) {
  return {
    status: "failed",
    webhook: {
      event_type: eventType,
      payload: { from: { phone_number: CUSTOMER_NUMBER }, text: CUSTOMER_TEXT },
    },
    attempts: urls.map((url) => ({
      status: "failed",
      http: {
        request: { url },
        response: status === null ? null : { status, body: CUSTOMER_TEXT },
      },
    })),
  };
}

/** Every request made, as `METHOD url`. */
let requests: string[];
let logged: string[];

function account(overrides: Account = {}) {
  const state = { ...wired(), ...overrides };
  stubFetch((url, request) => {
    requests.push(`${request.method} ${url.href}`);
    if (url.host === "api.resend.com") return Response.json({ id: "email-1" });
    if (url.pathname === "/rest/v1/companies") {
      return Response.json(state.ownProfiles.map((id) => ({ telnyx_messaging_profile_id: id })));
    }
    if (url.host !== "api.telnyx.com") return undefined;
    if (url.pathname === `/v2/call_control_applications/${VOICE_ID}`) {
      return state.voice === null
        ? Response.json({ errors: [{ code: "10005", title: "Resource not found" }] }, { status: 404 })
        : Response.json({ data: state.voice });
    }
    if (url.pathname === `/v2/credential_connections/${WEBRTC_ID}`) {
      return state.webrtc === null
        ? Response.json({ errors: [{ code: "10005" }] }, { status: 404 })
        : Response.json({ data: state.webrtc });
    }
    if (url.pathname === "/v2/messaging_profiles") {
      const page = Number(url.searchParams.get("page[number]"));
      const pages = state.profilePages;
      return Response.json({
        data: pages[page - 1] ?? [],
        meta: { page_number: page, total_pages: pages.length },
      });
    }
    if (url.pathname === "/v2/webhook_deliveries") {
      return Response.json({
        data: state.deliveries,
        meta: { page_number: 1, total_pages: 1, total_results: state.deliveries.length },
      });
    }
    return undefined;
  });
}

const NOW = new Date("2026-10-31T13:00:00Z");

beforeEach(() => {
  resetSentryCaptures();
  requests = [];
  logged = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function telnyxRequests(): string[] {
  return requests.filter((line) => line.includes("//api.telnyx.com/"));
}

describe("PW01 reads production's wiring and writes nothing", () => {
  it("passes a correctly wired account without an alert, judging only production's profiles", async () => {
    account();

    const report = await runTelnyxWiringWatch(production(), NOW);

    expect(report?.mismatches).toEqual([]);
    expect(report?.checked.map((c) => `${c.resource}:${c.id}`)).toEqual([
      `call_control_application:${VOICE_ID}`,
      `credential_connection:${WEBRTC_ID}`,
      "messaging_profile:mp-1",
      "messaging_profile:mp-2",
    ]);
    expect(opsCaptures()).toEqual([]);
  });

  it("makes GET requests and nothing else", async () => {
    account({
      voice: { webhook_event_url: EDGE, webhook_event_failover_url: null },
      deliveries: [delivery("message.received", [WEBHOOK], 500)],
    });

    await runTelnyxWiringWatch(production(), NOW);

    const telnyx = telnyxRequests();
    expect(telnyx.length, "the watch read the account").toBeGreaterThanOrEqual(4);
    expect(telnyx.filter((line) => !line.startsWith("GET "))).toEqual([]);
    // The one database write is the email channel's own heartbeat (#387),
    // made by the alert, not by the watch.
    expect(
      requests.filter(
        (line) =>
          line.includes("supabase.co") &&
          !line.startsWith("GET ") &&
          !line.endsWith("/rest/v1/rpc/record_heartbeat"),
      ),
    ).toEqual([]);
  });

  it("reads deliveries from the last 24 hours that failed", async () => {
    account();
    await runTelnyxWiringWatch(production(), NOW);

    const [line] = telnyxRequests().filter((l) => l.includes("/v2/webhook_deliveries"));
    const url = new URL(line.slice("GET ".length));
    expect(url.searchParams.get("filter[status][eq]")).toBe("failed");
    expect(url.searchParams.get("filter[started_at][gte]")).toBe("2026-10-30T13:00:00.000Z");
  });
});

describe("PW01 alerts ['ops','telnyx-wiring']", () => {
  it("names each setting that drifted, without a query string or a secret", async () => {
    account({
      voice: {
        webhook_event_url: WEBHOOK,
        webhook_event_failover_url: "https://old.example.com/hook?token=abc123",
        webhook_api_version: "1",
      },
      webrtc: { webhook_event_url: EDGE, webhook_event_failover_url: null, password: PASSWORD },
    });

    const report = await runTelnyxWiringWatch(production(), NOW);

    expect(report?.mismatches.map((m) => `${m.resource}:${m.field}:${m.actual}`)).toEqual([
      "call_control_application:webhook failover URL:https://old.example.com/hook",
      "call_control_application:webhook API version:1",
      `credential_connection:webhook URL:${EDGE}`,
    ]);
    const [alert] = opsCaptures("telnyx-wiring");
    expect(alert.fingerprint).toEqual(["ops", "telnyx-wiring"]);
    expect(alert.level).toBe("error");
    const everything = JSON.stringify(alert) + logged.join("\n");
    expect(everything).not.toContain("abc123");
    expect(everything).not.toContain(PASSWORD);
  });

  it("accepts the credential connection's failover unset, and nowhere else", async () => {
    account({
      voice: { webhook_event_url: WEBHOOK, webhook_event_failover_url: null },
      webrtc: { webhook_event_url: WEBHOOK, webhook_event_failover_url: "" },
    });

    const report = await runTelnyxWiringWatch(production(), NOW);

    expect(report?.mismatches.map((m) => `${m.resource}:${m.field}`)).toEqual([
      "call_control_application:webhook failover URL",
    ]);
  });

  it("reports a configured resource that no longer exists", async () => {
    account({ voice: null, profilePages: [[wired().profilePages[0][0]]] });

    const report = await runTelnyxWiringWatch(production(), NOW);

    expect(report?.mismatches.map((m) => `${m.resource}:${m.id}:${m.field}`)).toEqual([
      `call_control_application:${VOICE_ID}:existence`,
      "messaging_profile:mp-2:existence",
    ]);
    expect(opsCaptures("telnyx-wiring")).toHaveLength(1);
  });

  it("counts failed deliveries by event and status, and never repeats a payload", async () => {
    account({
      deliveries: [
        delivery("message.received", [WEBHOOK, WEBHOOK], 500),
        delivery("call.initiated", [WEBHOOK], null),
        delivery("call.initiated", ["https://api.loonext.com/webhook/telnyx"], 404),
        delivery("message.finalized", [EDGE], 502),
      ],
    });

    const report = await runTelnyxWiringWatch(production(), NOW);

    expect(report?.deliveries).toEqual({
      failed: 2,
      misrouted: 1,
      elsewhere: 1,
      byEventType: { "call.initiated": 1, "message.received": 1 },
      byStatus: { "500": 1, none: 1 },
      truncated: false,
    });
    const [alert] = opsCaptures("telnyx-wiring");
    expect(alert.level).toBe("warning");
    expect(String(alert.extra.detail)).toContain(
      `2 webhook deliveries to ${WEBHOOK} failed in the last 24 hours ` +
        "(events: call.initiated 1, message.received 1; last status: 500 1, none 1)",
    );
    const everything = JSON.stringify(alert) + logged.join("\n");
    expect(everything).not.toContain(CUSTOMER_NUMBER);
    expect(everything).not.toContain(CUSTOMER_TEXT);
  });

  it("stays quiet about failures that were never production's", async () => {
    account({ deliveries: [delivery("message.finalized", [EDGE], 502)] });

    const report = await runTelnyxWiringWatch(production(), NOW);

    expect(report?.deliveries.elsewhere).toBe(1);
    expect(opsCaptures()).toEqual([]);
  });

  it("reads every page of profiles before calling one missing", async () => {
    const foreign = Array.from({ length: 250 }, (_, n) => ({ id: `mp-other-${n}`, webhook_url: EDGE }));
    account({ profilePages: [foreign, wired().profilePages[0]] });

    const report = await runTelnyxWiringWatch(production(), NOW);

    expect(report?.mismatches).toEqual([]);
    expect(telnyxRequests().filter((l) => l.includes("/v2/messaging_profiles"))).toHaveLength(2);
  });
});

describe("PW01 outside production", () => {
  it.each([
    ["the rig", () => getEnv(rigEnv())],
    ["a laptop", () => getEnv(completeEnv())],
  ])("does not run on %s, and makes no request", async (_name, build) => {
    account();

    expect(await runTelnyxWiringWatch(build(), NOW)).toBeNull();
    expect(requests).toEqual([]);
    expect(opsCaptures()).toEqual([]);
  });
});
