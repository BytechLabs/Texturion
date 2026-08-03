/**
 * #297 — the daily summary.
 *
 * Two rules here fail silently and both do it in the member's favour-looking
 * direction, which is what makes them dangerous: a summary that arrives twice
 * looks like enthusiasm, and one that arrives at 3am looks like a bug in
 * somebody else's code. Neither errors.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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
  summaryAt?: string;
  sentOn?: string | null;
  timezone?: string | null;
  companyTimezone?: string | null;
  waiting?: number;
  tasks?: number;
  claimed?: Record<string, unknown>[];
}

function world(options: Options = {}) {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/notification_prefs", () => [
    {
      user_id: MEMBER,
      company_id: COMPANY,
      summary_at: options.summaryAt ?? "07:30",
      summary_sent_on: options.sentOn ?? null,
      quiet_timezone:
        options.timezone === undefined ? "America/Toronto" : options.timezone,
      companies: {
        timezone:
          options.companyTimezone === undefined
            ? "America/Toronto"
            : options.companyTimezone,
      },
    },
  ]);
  sb.on("PATCH", "/rest/v1/notification_prefs", () =>
    options.claimed ?? [{ user_id: MEMBER }],
  );
  sb.on("GET", "/rest/v1/company_members", () => [{ role: "owner" }]);
  sb.on("POST", "/rest/v1/rpc/api_for_you", () => ({
    totals: {
      waiting_on_you: options.waiting ?? 3,
      my_tasks: options.tasks ?? 2,
    },
  }));
  sb.on("GET", "/rest/v1/push_subscriptions", () => []);
  sb.on("GET", "/rest/v1/device_push_tokens", () => []);
  stubFetch(sb.route);
  return sb;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runDailySummary", () => {
  it("SM-1: goes once the member's own chosen time has passed", async () => {
    const sb = world();

    const summary = await runDailySummary(env, QUARTER_TO_EIGHT);

    expect(summary).toEqual({ considered: 1, sent: 1 });
    expect(
      sb.calls.some((call) => call.path === "/rest/v1/push_subscriptions"),
    ).toBe(true);
  });

  it("SM-2: does NOT go before their time, in their zone", async () => {
    // The failure this prevents arrives at 3am and reads as a bug in somebody
    // else's code. Nothing errors — the summary is simply wrong about what
    // "morning" means for that person.
    const sb = world();

    const summary = await runDailySummary(env, MIDDLE_OF_THE_NIGHT);

    expect(summary).toEqual({ considered: 1, sent: 0 });
    expect(
      sb.calls.some((call) => call.path === "/rest/v1/push_subscriptions"),
    ).toBe(false);
  });

  it("SM-3: once per day, judged on THEIR calendar", async () => {
    // Comparing instants would send a second summary to anybody whose midnight
    // falls differently from the server's, which is most of the customer base.
    const sb = world({ sentOn: "2026-08-05" });

    const summary = await runDailySummary(env, QUARTER_TO_EIGHT);

    expect(summary.sent).toBe(0);
    expect(
      sb.calls.some((call) => call.method === "PATCH"),
    ).toBe(false);
  });

  it("SM-4: yesterday's summary does not stop today's", async () => {
    world({ sentOn: "2026-08-04" });

    const summary = await runDailySummary(env, QUARTER_TO_EIGHT);

    expect(summary.sent).toBe(1);
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

  it("SM-6: falls back to the workspace clock when the member has none", async () => {
    world({ timezone: null });

    expect((await runDailySummary(env, QUARTER_TO_EIGHT)).sent).toBe(1);
  });

  it("SM-7: no clock at all SKIPS rather than guessing", async () => {
    // The opposite bias from the rest of the notification paths, on purpose:
    // this is an optional courtesy on a schedule, and sending it at the wrong
    // hour is worse than not sending it. It will go tomorrow.
    world({ timezone: null, companyTimezone: null });

    expect((await runDailySummary(env, QUARTER_TO_EIGHT)).sent).toBe(0);
  });

  it("SM-11: a STORED zone that no longer resolves also skips", async () => {
    // A different guard from SM-7, and the one that actually bites: a member
    // whose saved timezone has been renamed or was never valid reaches the
    // clock resolver with a non-null string. Testing only the null case left
    // that branch unguarded — found by deleting it and watching nothing fail.
    world({ timezone: "Mars/Olympus" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await runDailySummary(env, QUARTER_TO_EIGHT)).sent).toBe(0);

    // Not sending is only half of it. Without the explicit check the clock
    // resolver returns null, the next line throws, and the per-member catch
    // swallows it — same outcome, but every tick logs an error about a
    // perfectly ordinary condition, which is how a real failure gets lost.
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
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

describe("localClock", () => {
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
