/**
 * #642: the pre-cap alert, the cap-hit signal and the weekly drift check.
 *
 * Driven through the real Telnyx client and env schema with only the network
 * edge stubbed, so "read only" is a fact about the requests actually made.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEnv, type Env } from "../env";
import { rigEnv } from "../test/rig-env";
import { opsCaptures, resetSentryCaptures } from "../test/sentry-mock";
import { completeEnv, stubFetch } from "../test/support";
import {
  alertMessagingSpendCap,
  handleSpendLimitReachedEvent,
  resetSpendCapThrottle,
  runTelnyxSpendLimitDriftWatch,
  runTelnyxSpendWatch,
} from "./telnyx-spend";

vi.mock("@sentry/cloudflare", async () =>
  (await import("../test/sentry-mock")).sentryModuleMock(),
);

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
  /** Spend rows for a read that ends at `until`. */
  spend?: (until: Date) => { kind: string; company_id: string | null; spend_usd: number }[];
}

let requests: string[];

function account(overrides: Account = {}) {
  const state: Required<Account> = {
    ovp: { id: OVP, ...LIMITED },
    profiles: { "mp-1": { id: "mp-1", ...LIMITED } },
    companies: [{ id: COMPANY, telnyx_messaging_profile_id: "mp-1" }],
    spend: () => [],
    ...overrides,
  };
  stubFetch(async (url, request) => {
    requests.push(`${request.method} ${url.href}`);
    if (url.host === "api.resend.com") return Response.json({ id: "email-1" });
    if (url.pathname === "/rest/v1/rpc/api_telnyx_spend_since") {
      const body = (await request.json()) as { p_until: string };
      return Response.json(state.spend(new Date(body.p_until)));
    }
    if (url.pathname === "/rest/v1/companies") {
      return Response.json(state.companies);
    }
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

/** 2026-11-01 15:00 UTC: not a reminder hour, fifteen hours into the day. */
const NOW = new Date("2026-11-01T15:00:00Z");
const DAY_START = new Date("2026-11-01T00:00:00Z");

beforeEach(() => {
  resetSentryCaptures();
  resetSpendCapThrottle();
  requests = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Voice spend of `now` dollars at the current read and `earlier` an hour ago. */
const voiceSpend = (now: number, earlier: number) => (until: Date) => [
  { kind: "voice", company_id: null, spend_usd: until.getTime() === NOW.getTime() ? now : earlier },
];

describe("the pre-cap alert", () => {
  it("fires once spend crosses 70% of the live limit, with a stable key", async () => {
    account({ spend: voiceSpend(17.6, 3) });

    const report = await runTelnyxSpendWatch(production(), NOW);

    expect(report?.findings).toMatchObject([{ scope: "voice", spent: 17.6, limit: 25, fresh: true }]);
    const [alert] = opsCaptures("telnyx-spend-precap-voice");
    expect(alert.fingerprint).toEqual(["ops", "telnyx-spend-precap-voice"]);
    expect(alert.level).toBe("warning");
    expect(String(alert.extra.detail)).toContain("USD 17.60 of USD 25.00 today (70%)");
  });

  it("stays quiet below 70%, and a quiet hour makes no Telnyx request", async () => {
    account({ spend: voiceSpend(17.4, 0) });

    await runTelnyxSpendWatch(production(), NOW);

    expect(opsCaptures()).toEqual([]);
    expect(telnyxRequests()).toEqual([]);
  });

  it("judges against a raised limit, not the floor", async () => {
    account({
      ovp: { id: OVP, daily_spend_limit: "100.00", daily_spend_limit_enabled: true },
      spend: voiceSpend(30, 0),
    });

    await runTelnyxSpendWatch(production(), NOW);

    expect(opsCaptures()).toEqual([]);
  });

  it("goes to error level when the limit is reached", async () => {
    account({ spend: voiceSpend(25.5, 10) });

    await runTelnyxSpendWatch(production(), NOW);

    expect(opsCaptures("telnyx-spend-precap-voice")[0].level).toBe("error");
  });

  it("does not repeat a persisting condition outside the reminder hours", async () => {
    account({ spend: voiceSpend(20, 19) });

    await runTelnyxSpendWatch(production(), NOW);
    expect(opsCaptures()).toEqual([]);

    // 18:00 UTC is a reminder hour.
    const reminder = new Date("2026-11-01T18:00:00Z");
    account({ spend: () => [{ kind: "voice", company_id: null, spend_usd: 21 }] });
    await runTelnyxSpendWatch(production(), reminder);
    expect(opsCaptures("telnyx-spend-precap-voice")).toHaveLength(1);
  });

  it("falls back to the floor when no limit is enforced, and says so", async () => {
    account({
      ovp: { id: OVP, daily_spend_limit: "", daily_spend_limit_enabled: null },
      spend: voiceSpend(18, 0),
    });

    const report = await runTelnyxSpendWatch(production(), NOW);

    expect(report?.findings[0]).toMatchObject({ limit: 25, assumed: true });
    expect(String(opsCaptures()[0].extra.detail)).toContain("limit assumed at the floor");
  });

  it("alerts per workspace for messaging, under its own key", async () => {
    account({
      companies: [
        { id: COMPANY, telnyx_messaging_profile_id: "mp-1" },
        { id: OTHER_COMPANY, telnyx_messaging_profile_id: "mp-2" },
      ],
      profiles: { "mp-1": { id: "mp-1", ...LIMITED }, "mp-2": { id: "mp-2", ...LIMITED } },
      // 18 now, 5 an hour ago: it crossed 70% since the last run.
      spend: (until) => [
        { kind: "message", company_id: COMPANY, spend_usd: until.getTime() === NOW.getTime() ? 18 : 5 },
        { kind: "message", company_id: OTHER_COMPANY, spend_usd: 2 },
      ],
    });

    const report = await runTelnyxSpendWatch(production(), NOW);

    expect(report?.findings.map((f) => f.companyId)).toEqual([COMPANY]);
    const [alert] = opsCaptures("telnyx-spend-precap-messaging");
    expect(String(alert.extra.detail)).toContain(`company ${COMPANY}: USD 18.00 of USD 25.00`);
    expect(String(alert.extra.detail)).not.toContain(OTHER_COMPANY);
  });

  it("reads the cost ledger from the start of the UTC day", async () => {
    let since = "";
    stubFetch(async (url, request) => {
      if (url.pathname === "/rest/v1/rpc/api_telnyx_spend_since") {
        since = ((await request.json()) as { p_since: string }).p_since;
        return Response.json([]);
      }
      return undefined;
    });

    await runTelnyxSpendWatch(production(), NOW);

    expect(since).toBe(DAY_START.toISOString());
  });

  it("makes GET requests only", async () => {
    account({ spend: voiceSpend(20, 0) });
    await runTelnyxSpendWatch(production(), NOW);
    expect(telnyxRequests().length).toBeGreaterThan(0);
    expect(telnyxRequests().filter((line) => !line.startsWith("GET "))).toEqual([]);
  });

  it.each([
    ["the rig", () => getEnv(rigEnv())],
    ["a laptop", () => getEnv(completeEnv())],
  ])("does not run on %s", async (_name, build) => {
    account({ spend: voiceSpend(20, 0) });
    expect(await runTelnyxSpendWatch(build(), NOW)).toBeNull();
    expect(requests).toEqual([]);
  });
});

describe("40333, the cap being hit", () => {
  it("is its own ops signal, grouped under one key", async () => {
    account();

    const sent = await alertMessagingSpendCap(production(), {
      source: "send",
      companyId: COMPANY,
      detail: "Spend limit reached",
    });

    expect(sent).toBe(true);
    const [alert] = opsCaptures("telnyx-messaging-spend-cap");
    expect(alert.fingerprint).toEqual(["ops", "telnyx-messaging-spend-cap"]);
    expect(alert.level).toBe("error");
    expect(String(alert.extra.detail)).toContain(`company ${COMPANY}`);
  });

  it("alerts a looping workspace once, not once per refused send", async () => {
    account();
    const t0 = 1_000_000;
    const env = production();
    expect(await alertMessagingSpendCap(env, { source: "send", companyId: COMPANY }, t0)).toBe(true);
    expect(await alertMessagingSpendCap(env, { source: "send", companyId: COMPANY }, t0 + 60_000)).toBe(false);
    expect(await alertMessagingSpendCap(env, { source: "send", companyId: OTHER_COMPANY }, t0 + 60_000)).toBe(true);
    expect(await alertMessagingSpendCap(env, { source: "send", companyId: COMPANY }, t0 + 31 * 60_000)).toBe(true);
    expect(opsCaptures("telnyx-messaging-spend-cap")).toHaveLength(3);
  });

  it("resolves the workspace behind the webhook's profile", async () => {
    account();

    await handleSpendLimitReachedEvent(production(), { messaging_profile_id: "mp-1" });

    const [alert] = opsCaptures("telnyx-messaging-spend-cap");
    expect(String(alert.extra.detail)).toContain(`company ${COMPANY}`);
    expect(String(alert.extra.detail)).toContain("spend-limit-reached");
  });

  it("still alerts on a payload that names no profile", async () => {
    account();
    await handleSpendLimitReachedEvent(production(), {});
    expect(opsCaptures("telnyx-messaging-spend-cap")).toHaveLength(1);
  });
});

describe("the weekly drift check", () => {
  it("passes when every production profile carries its limit, and alerts nothing", async () => {
    account();

    const report = await runTelnyxSpendLimitDriftWatch(production(), NOW);

    expect(report?.drifted).toEqual([]);
    expect(report?.checked).toEqual([
      { resource: "outbound_voice_profile", id: OVP },
      { resource: "messaging_profile", id: "mp-1" },
    ]);
    expect(opsCaptures()).toEqual([]);
  });

  it("does not object to a limit raised above the floor", async () => {
    account({ ovp: { id: OVP, daily_spend_limit: "100.00", daily_spend_limit_enabled: true } });
    expect((await runTelnyxSpendLimitDriftWatch(production(), NOW))?.drifted).toEqual([]);
  });

  it.each([
    ["removed", { daily_spend_limit: "", daily_spend_limit_enabled: null }, "no daily spend limit is enforced"],
    ["disabled", { daily_spend_limit: "25.00", daily_spend_limit_enabled: false }, "no daily spend limit is enforced"],
    ["zeroed", { daily_spend_limit: "0.00", daily_spend_limit_enabled: true }, "the limit is enabled with no usable amount"],
    ["lowered", { daily_spend_limit: "10.00", daily_spend_limit_enabled: true }, "the limit is USD 10.00, below the USD 25.00 floor"],
  ])("flags a voice limit that was %s", async (_name, ovp, problem) => {
    account({ ovp: { id: OVP, ...ovp } });

    const report = await runTelnyxSpendLimitDriftWatch(production(), NOW);

    expect(report?.drifted).toEqual([{ resource: "outbound_voice_profile", id: OVP, problem }]);
    const [alert] = opsCaptures("telnyx-spend-limit-drift");
    expect(alert.fingerprint).toEqual(["ops", "telnyx-spend-limit-drift"]);
    expect(alert.level).toBe("error");
  });

  it("flags a messaging profile that lost its limit, and one Telnyx no longer lists", async () => {
    account({
      companies: [
        { id: COMPANY, telnyx_messaging_profile_id: "mp-1" },
        { id: OTHER_COMPANY, telnyx_messaging_profile_id: "mp-gone" },
      ],
      profiles: { "mp-1": { id: "mp-1", daily_spend_limit: "0.00", daily_spend_limit_enabled: false } },
    });

    const report = await runTelnyxSpendLimitDriftWatch(production(), NOW);

    expect(report?.drifted.map((d) => `${d.id}: ${d.problem}`).sort()).toEqual([
      "mp-1: no daily spend limit is enforced",
      "mp-gone: Telnyx no longer lists the profile",
    ]);
    expect(opsCaptures("telnyx-spend-limit-drift")).toHaveLength(1);
  });

  it("flags a voice profile that is gone", async () => {
    account({ ovp: null });
    const report = await runTelnyxSpendLimitDriftWatch(production(), NOW);
    expect(report?.drifted[0].problem).toBe("Telnyx no longer has the profile");
  });

  it("makes GET requests and nothing else", async () => {
    account({ ovp: { id: OVP, daily_spend_limit: "", daily_spend_limit_enabled: null } });
    await runTelnyxSpendLimitDriftWatch(production(), NOW);
    expect(telnyxRequests().length).toBeGreaterThan(2);
    expect(telnyxRequests().filter((line) => !line.startsWith("GET "))).toEqual([]);
  });

  it.each([
    ["the rig", () => getEnv(rigEnv())],
    ["a laptop", () => getEnv(completeEnv())],
  ])("does not run on %s", async (_name, build) => {
    account();
    expect(await runTelnyxSpendLimitDriftWatch(build(), NOW)).toBeNull();
    expect(requests).toEqual([]);
  });
});
