/**
 * #297 — the daily summary.
 *
 * Two rules here fail silently and both do it in the member's favour-looking
 * direction, which is what makes them dangerous: a summary that arrives twice
 * looks like enthusiasm, and one that arrives at 3am looks like a bug in
 * somebody else's code. Neither errors.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { fcmEnv, fcmService, makeServiceAccount } from "../test/fcm-account";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { localClock, runDailySummary } from "./daily-summary";

const env = completeEnv();
const COMPANY = "11111111-1111-4111-8111-111111111111";
const MEMBER = "33333333-3333-4333-8333-333333333333";

/** 07:45 in Toronto on 2026-08-05 (11:45Z in August). */
const QUARTER_TO_EIGHT = new Date("2026-08-05T11:45:00Z");
/** 03:00 Toronto the same day. */
const MIDDLE_OF_THE_NIGHT = new Date("2026-08-05T07:00:00Z");

interface Options {
  due?: boolean;
  waiting?: number;
  tasks?: number;
  claimed?: Record<string, unknown>[];
  held?: Record<string, unknown>[];
  devices?: Record<string, unknown>[];
}

function world(options: Options = {}) {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/notification_prefs", () => []);
  sb.on("POST", "/rest/v1/rpc/api_due_daily_summaries", () =>
    options.due === false ? [] : [{
      user_id: MEMBER,
      company_id: COMPANY,
      timezone: "America/Toronto",
      summary_date: "2026-08-05",
    }],
  );
  sb.on("PATCH", "/rest/v1/notification_prefs", () =>
    options.claimed ?? [{ user_id: MEMBER }],
  );
  sb.on("GET", "/rest/v1/company_members", () => [{ role: "owner" }]);
  sb.on("DELETE", "/rest/v1/pending_notifications", () => options.held ?? []);
  sb.on("POST", "/rest/v1/rpc/api_for_you", () => ({
    totals: {
      waiting_on_you: options.waiting ?? 3,
      my_tasks: options.tasks ?? 2,
    },
    my_tasks: [],
  }));
  sb.on("GET", "/rest/v1/push_subscriptions", () => []);
  sb.on("GET", "/rest/v1/device_push_tokens", () => options.devices ?? []);
  stubFetch(sb.route);
  return sb;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe(runDailySummary, () => {
  it("SM-1: goes once the member's own chosen time has passed", async () => {
    const sb = world();

    const summary = await runDailySummary(env, QUARTER_TO_EIGHT);

    expect(summary).toEqual({ considered: 1, sent: 1 });
    expect(sb.find("POST", "/rest/v1/rpc/api_due_daily_summaries")[0]?.body).toEqual({
      p_now: QUARTER_TO_EIGHT.toISOString(),
      p_limit: 50,
    });
    const [claim] = sb.find("PATCH", "/rest/v1/notification_prefs");
    expect(claim?.body).toEqual({ summary_sent_on: "2026-08-05" });
    expect(claim?.url.searchParams.get("or")).toContain("summary_sent_on.lt.2026-08-05");
    expect(
      sb.calls.some((call) => call.path === "/rest/v1/push_subscriptions"),
    ).toBe(true);
  });

  it("sends nothing when the database returns no due summary", async () => {
    const sb = world({ due: false });

    await expect(runDailySummary(env, MIDDLE_OF_THE_NIGHT)).resolves.toEqual({ considered: 0, sent: 0 });
    expect(sb.calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("consumes due held alerts as part of the only daily push", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    const sb = world({
      held: [{ category: "voicemails", conversation_id: null, conversations: null }],
      devices: [{ id: "summary-device", user_id: MEMBER, platform: "android", token: "tok" }],
    });
    stubFetch(sb.route, ...service.routes);

    expect((await runDailySummary(fcmEnv(account), QUARTER_TO_EIGHT)).sent).toBe(1);
    const [consume] = sb.find("DELETE", "/rest/v1/pending_notifications");
    expect(consume?.url.searchParams.get("delivery_kind")).toBe("eq.summary");
    expect(consume?.url.searchParams.get("deliver_at")).toBe(`lte.${QUARTER_TO_EIGHT.toISOString()}`);
    expect(service.sends).toHaveLength(1);
    expect(service.sends[0].message.data).toMatchObject({
      kind: "summary",
      body: "3 people are waiting on you. 1 voicemail.",
    });
  });

  it("SM-5: the day is claimed BEFORE the push, and losing the claim sends nothing", async () => {
    // Two ticks racing, or two workers. The claim is what stops both from
    // describing the same morning.
    const sb = world({ claimed: [] });

    const summary = await runDailySummary(env, QUARTER_TO_EIGHT);

    expect(summary.sent).toBe(0);
    expect(
      sb.calls.some((call) => call.path === "/rest/v1/rpc/api_for_you"),
    ).toBe(false);
  });

  it("SM-8: the counts exclude numbers this member cannot see", async () => {
    // #106: a summary that reported work on a hidden number would tell them
    // something exists that they are not allowed to know about.
    const sb = world();

    await runDailySummary(env, QUARTER_TO_EIGHT);

    const call = sb.calls.find(
      (entry) => entry.path === "/rest/v1/rpc/api_for_you",
    );
    expect(call?.body).toHaveProperty("p_hidden_number_ids");
  });
});

describe(localClock, () => {
  it("SM-9: reports the member's date, not the server's", async () => {
    // 03:00Z on the 5th is still the EVENING of the 4th in Toronto. A summary
    // keyed on the server's date would think a new day had started.
    const clock = localClock("America/Toronto", new Date("2026-08-05T03:00:00Z"));

    expect(clock?.date).toBe("2026-08-04");
    expect(clock?.minutes).toBe(23 * 60);
  });

  it("SM-10: an unusable zone is null, not a silent fallback to UTC", async () => {
    expect(localClock("Mars/Olympus", QUARTER_TO_EIGHT)).toBeNull();
  });
});
