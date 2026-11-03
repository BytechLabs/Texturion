/**
 * #642: the hourly spend gauges and the notice when the cap is hit.
 *
 * Driven through the real Telnyx client and env schema with only the network
 * edge stubbed, so "read only" is a fact about the requests actually made.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { getEnv, type Env } from "../env";
import { captured, eventsCaptured, noticesCaptured, resetCaptures } from "../test/capture-mock";
import { rigEnv } from "../test/rig-env";
import { completeEnv, stubFetch } from "../test/support";
import { noticeMessagingSpendCap, runTelnyxSpendGauges } from "./telnyx-spend";

vi.mock("./capture", async () => (await import("../test/capture-mock")).captureModuleMock());

const VOICE_ID = completeEnv().TELNYX_VOICE_CONNECTION_ID;
const WEBRTC_ID = completeEnv().TELNYX_WEBRTC_CONNECTION_ID as string;
const OVP = "ovp-prod";
const COMPANY = "cccccccc-0000-4000-8000-0000000000c1";
const OTHER_COMPANY = "cccccccc-0000-4000-8000-0000000000c2";

const production = (): Env => getEnv({ ...completeEnv(), DEPLOY_ENV: "production" });

const LIMITED = { daily_spend_limit: "25.00", daily_spend_limit_enabled: true };

interface Account {
  /** Voice profile as Telnyx reports it, or null for a 404. */
  ovp?: Record<string, unknown> | null;
  /** Messaging profiles Telnyx lists. */
  profiles?: Record<string, Record<string, unknown>>;
  /** Companies the database maps to a profile id. */
  companies?: { id: string; telnyx_messaging_profile_id: string }[];
  /** Spend rows the cost ledger returns. */
  spend?: { kind: string; company_id: string | null; spend_usd: number }[];
  /** Messages already refused by the cap today, for the notice's lookup. */
  refusedToday?: { id: string }[];
}

let requests: string[];
let spendSince: string | null;

function account(overrides: Account = {}) {
  const state: Required<Account> = {
    ovp: { id: OVP, ...LIMITED },
    profiles: { "mp-1": { id: "mp-1", ...LIMITED } },
    companies: [{ id: COMPANY, telnyx_messaging_profile_id: "mp-1" }],
    spend: [],
    refusedToday: [],
    ...overrides,
  };
  stubFetch(async (url, request) => {
    requests.push(`${request.method} ${url.href}`);
    if (url.pathname === "/rest/v1/rpc/api_telnyx_spend_since") {
      spendSince = ((await request.json()) as { p_since: string }).p_since;
      return Response.json(state.spend);
    }
    if (url.pathname === "/rest/v1/companies") return Response.json(state.companies);
    if (url.pathname === "/rest/v1/messages") return Response.json(state.refusedToday);
    if (url.host !== "api.telnyx.com") return undefined;
    if (url.pathname === `/v2/call_control_applications/${VOICE_ID}`) {
      return Response.json({ data: { outbound: { outbound_voice_profile_id: OVP } } });
    }
    if (url.pathname === `/v2/credential_connections/${WEBRTC_ID}`) {
      return Response.json({ data: { outbound: { outbound_voice_profile_id: OVP } } });
    }
    if (url.pathname === `/v2/outbound_voice_profiles/${OVP}`) {
      return state.ovp === null
        ? Response.json({ errors: [{ code: "10005" }] }, { status: 404 })
        : Response.json({ data: state.ovp });
    }
    if (url.pathname === "/v2/messaging_profiles") {
      return Response.json({
        data: Object.values(state.profiles),
        meta: { page_number: 1, total_pages: 1 },
      });
    }
    return undefined;
  });
}

const telnyxRequests = () => requests.filter((line) => line.includes("//api.telnyx.com/"));

const gauge = (key: string) =>
  eventsCaptured("ops_gauge").find((event) => event.properties.key === key)?.properties;

/** 2026-11-01 15:00 UTC, fifteen hours into the day. */
const NOW = new Date("2026-11-01T15:00:00Z");
const DAY_START = new Date("2026-11-01T00:00:00Z");

beforeEach(() => {
  resetCaptures();
  requests = [];
  spendSince = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the spend gauges", () => {
  it("send today's voice and messaging spend against the enforced limits, deciding nothing", async () => {
    account({
      spend: [
        { kind: "voice", company_id: null, spend_usd: 17.604 },
        { kind: "message", company_id: COMPANY, spend_usd: 3 },
      ],
    });

    await runTelnyxSpendGauges(production(), NOW);

    expect(eventsCaptured("ops_gauge").map((event) => event.distinctId)).toEqual([
      "loonext-api",
      "loonext-api",
    ]);
    expect(gauge("telnyx-spend-voice")).toEqual({
      key: "telnyx-spend-voice",
      value: 17.6,
      limit: 25,
      unit: "usd",
      floor: 25,
    });
    expect(gauge("telnyx-spend-messaging")).toEqual({
      key: "telnyx-spend-messaging",
      value: 3,
      limit: 25,
      unit: "usd",
      floor: 25,
    });
    expect(noticesCaptured()).toEqual([]);
  });

  it("read the cost ledger from the start of the UTC day", async () => {
    account();
    await runTelnyxSpendGauges(production(), NOW);
    expect(spendSince).toBe(DAY_START.toISOString());
  });

  it("report a raised limit as it is", async () => {
    account({ ovp: { id: OVP, daily_spend_limit: "100.00", daily_spend_limit_enabled: true } });
    await runTelnyxSpendGauges(production(), NOW);
    expect(gauge("telnyx-spend-voice")).toMatchObject({ limit: 100, floor: 25 });
  });

  it.each([
    ["removed", { daily_spend_limit: "", daily_spend_limit_enabled: null }, null],
    ["disabled", { daily_spend_limit: "25.00", daily_spend_limit_enabled: false }, null],
    ["zeroed", { daily_spend_limit: "0.00", daily_spend_limit_enabled: true }, null],
    ["lowered", { daily_spend_limit: "10.00", daily_spend_limit_enabled: true }, 10],
  ])("report a voice limit that was %s, so the alert can see it", async (_name, ovp, limit) => {
    account({ ovp: { id: OVP, ...ovp }, spend: [{ kind: "voice", company_id: null, spend_usd: 1 }] });
    await runTelnyxSpendGauges(production(), NOW);
    expect(gauge("telnyx-spend-voice")).toMatchObject({ value: 1, limit });
  });

  it("report a voice profile Telnyx no longer has as no limit", async () => {
    account({ ovp: null });
    await runTelnyxSpendGauges(production(), NOW);
    expect(gauge("telnyx-spend-voice")?.limit).toBeNull();
  });

  it("send the messaging profile closest to trouble, one gauge for the fleet", async () => {
    account({
      companies: [
        { id: COMPANY, telnyx_messaging_profile_id: "mp-1" },
        { id: OTHER_COMPANY, telnyx_messaging_profile_id: "mp-2" },
      ],
      profiles: { "mp-1": { id: "mp-1", ...LIMITED }, "mp-2": { id: "mp-2", ...LIMITED } },
      spend: [
        { kind: "message", company_id: COMPANY, spend_usd: 18 },
        { kind: "message", company_id: OTHER_COMPANY, spend_usd: 2 },
      ],
    });

    await runTelnyxSpendGauges(production(), NOW);

    expect(eventsCaptured("ops_gauge")).toHaveLength(2);
    expect(gauge("telnyx-spend-messaging")).toMatchObject({ value: 18, limit: 25 });
  });

  it("put a profile Telnyx no longer lists ahead of any spend", async () => {
    account({
      companies: [
        { id: COMPANY, telnyx_messaging_profile_id: "mp-1" },
        { id: OTHER_COMPANY, telnyx_messaging_profile_id: "mp-gone" },
      ],
      spend: [{ kind: "message", company_id: COMPANY, spend_usd: 24 }],
    });

    await runTelnyxSpendGauges(production(), NOW);

    expect(gauge("telnyx-spend-messaging")).toMatchObject({ value: 0, limit: null });
  });

  it("send no messaging gauge when no workspace has a profile", async () => {
    account({ companies: [] });
    await runTelnyxSpendGauges(production(), NOW);
    expect(gauge("telnyx-spend-messaging")).toBeUndefined();
    expect(gauge("telnyx-spend-voice")).toBeDefined();
  });

  it("make GET requests only", async () => {
    account();
    await runTelnyxSpendGauges(production(), NOW);
    expect(telnyxRequests().length).toBeGreaterThan(0);
    expect(telnyxRequests().filter((line) => !line.startsWith("GET "))).toEqual([]);
  });

  it.each([
    ["the rig", () => getEnv(rigEnv())],
    ["a laptop", () => getEnv(completeEnv())],
  ])("do not run on %s", async (_name, build) => {
    account();
    expect(await runTelnyxSpendGauges(build(), NOW)).toBeNull();
    expect(requests).toEqual([]);
    expect(captured).toEqual([]);
  });
});

describe("40333, the cap being hit", () => {
  const hit = { companyId: COMPANY, messageId: "m-2" };

  it("sends one error notice, naming the workspace, on the day's first refusal", async () => {
    account();
    const env = production();

    expect(await noticeMessagingSpendCap(env, getDb(env), hit, NOW)).toBe(true);

    const [notice] = noticesCaptured("telnyx-messaging-spend-cap");
    expect(notice.level).toBe("error");
    expect(notice.detail).toContain(`company ${COMPANY}`);
    const lookup = requests.find((line) => line.includes("/rest/v1/messages"));
    expect(lookup).toContain("error_code=eq.40333");
    expect(lookup).toContain("id=neq.m-2");
    expect(decodeURIComponent(lookup ?? "")).toContain(`updated_at=gte.${DAY_START.toISOString()}`);
  });

  it("sends nothing for a refusal after the first one today", async () => {
    account({ refusedToday: [{ id: "m-1" }] });
    const env = production();

    expect(await noticeMessagingSpendCap(env, getDb(env), hit, NOW)).toBe(false);
    expect(captured).toEqual([]);
  });
});
