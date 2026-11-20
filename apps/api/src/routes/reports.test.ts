/**
 * GET /v1/reports/response-time (#239).
 *
 * The SQL suite (`supabase/tests/response_time.test.sql`) owns the definition —
 * what starts the clock, what stops it, what is excluded. What this suite owns
 * is everything the Worker adds on top, and every test below is a case where the
 * easy implementation reports something flattering or invented:
 *
 *   - the business-hours split keyed on OUR reply time instead of the customer's
 *     message, which files a 9am answer to a midnight text as an in-hours win;
 *   - an arc drawn for a workspace too young to have one;
 *   - per-member numbers shown without the owner asking;
 *   - a capped row list presented as though it covered everything.
 *
 * Only global fetch is stubbed.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { apiRequest, buildTestApp, membershipResponder, supabaseStub } from '../test/routes-harness';
import type { SupabaseStub } from '../test/routes-harness';
import { completeEnv, createTestAuth, jwksRoute, stubFetch } from '../test/support';
import type { TestAuth } from '../test/support';
import type { ResponseBaselineResult } from "../reports/response-baseline";
import { reportsRoutes } from "./reports";

const env = completeEnv();
const COMPANY_ID = "5c1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "1d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const TECH_ID = "2d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const HIDDEN_NUMBER_ID = "eeeeeeee-9999-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(reportsRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Mon–Fri 09:00–17:00 in Toronto — an ordinary shop. */
const NINE_TO_FIVE = {
  mon: { open: "09:00", close: "17:00" },
  tue: { open: "09:00", close: "17:00" },
  wed: { open: "09:00", close: "17:00" },
  thu: { open: "09:00", close: "17:00" },
  fri: { open: "09:00", close: "17:00" },
};

interface Lead {
  opened_at: string;
  response_seconds: number | null;
  responder_user_id?: string | null;
}

function statsPayload(
  rows: Lead[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const answered = rows
    .map((r) => r.response_seconds)
    .filter((s): s is number => s !== null)
    .toSorted((a, b) => a - b);
  const mid = Math.floor(answered.length / 2);
  return {
    leads: rows.length,
    answered: answered.length,
    unanswered: rows.length - answered.length,
    median_seconds:
      answered.length === 0
        ? null
        : (answered.length % 2 === 0
          ? (answered[mid - 1] + answered[mid]) / 2
          : answered[mid]),
    p90_seconds: answered.at(-1) ?? null,
    by_member: [],
    by_number: [],
    rows: rows.map((r) => ({
      conversation_id: "c",
      phone_number_id: null,
      opened_at: r.opened_at,
      responded_at: r.response_seconds === null ? null : r.opened_at,
      responder_user_id: r.responder_user_id ?? null,
      response_seconds: r.response_seconds,
    })),
    row_limit: 5000,
    truncated: false,
    ...overrides,
  };
}

function stub(options: {
  perMember?: boolean;
  hours?: Record<string, { open: string; close: string }>;
  exceptions?: unknown[];
  current: Record<string, unknown>;
  baseline?: ResponseBaselineResult;
  /** #482: the company's numbers, for the by_number labels. */
  numbers?: { id: string; number_e164: string | null }[];
}): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, "owner"),
  );
  sb.on("GET", "/rest/v1/companies", () => [
    {
      timezone: "America/Toronto",
      business_hours: options.hours ?? NINE_TO_FIVE,
      business_hours_exceptions: options.exceptions ?? [],
      response_stats_per_member: options.perMember ?? false,
    },
  ]);
  // #482: the numbers the by_number rows are labelled from.
  sb.on("GET", "/rest/v1/phone_numbers", () => options.numbers ?? []);
  sb.on("POST", "/rest/v1/rpc/api_response_time_stats", () => options.current);
  sb.on("POST", "/rest/v1/rpc/api_response_time_baseline", () =>
    options.baseline ?? { reason: "no_answered_leads" },
  );
  return sb;
}

async function get(sb: SupabaseStub, query = ""): Promise<Response> {
  stubFetch(jwksRoute(auth), sb.route);
  return apiRequest(
    app,
    env,
    await auth.token(),
    `/v1/reports/response-time${query}`,
    { companyId: COMPANY_ID },
  );
}

describe("GET /v1/reports/response-time", () => {
  it("returns the lead channel and missed-call text counts", async () => {
    const sb = stub({
      current: statsPayload([], {
        leads: 3,
        text_first: 1,
        call_first: 2,
        auto_text_sent: 2,
        replied_to_auto_text: 1,
      }),
    });
    const response = await get(sb);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      leads: 3,
      text_first: 1,
      call_first: 2,
      auto_text_sent: 2,
      replied_to_auto_text: 1,
    });
  });

  // #482 — the per-number breakdown was computed and returned and nothing
  // rendered it, because the payload named a UUID rather than a number.
  describe("by_number", () => {
    const twoNumbers = [
      { id: "n1", number_e164: "+14165550111" },
      { id: "n2", number_e164: "+14165550222" },
    ];
    const breakdown = [
      { phone_number_id: "n1", leads: 10, answered: 9, median_seconds: 120 },
      { phone_number_id: "n2", leads: 6, answered: 2, median_seconds: 900 },
    ];

    it("labels each row with the number a person would recognise", async () => {
      const sb = stub({
        numbers: twoNumbers,
        current: statsPayload([], { by_number: breakdown }),
      });
      const body = await (await get(sb)).json<{
        by_number: { number_e164: string; median_seconds: number | null }[];
      }>();
      expect(body.by_number.map((r) => r.number_e164)).toEqual([
        "+14165550222",
        "+14165550111",
      ]);
    });

    it("puts the slowest line first", async () => {
      // The reader's question is "which line is letting people down". A list
      // ordered by anything else makes them scan for the answer.
      const sb = stub({
        numbers: twoNumbers,
        current: statsPayload([], { by_number: breakdown }),
      });
      const body = await (await get(sb)).json<{
        by_number: { median_seconds: number | null }[];
      }>();
      expect(body.by_number[0].median_seconds).toBe(900);
    });

    it("sorts a number nobody answered to the very top", async () => {
      // No median is the worst answer there is, not a missing one.
      const sb = stub({
        numbers: twoNumbers,
        current: statsPayload([], {
          by_number: [
            { phone_number_id: "n1", leads: 10, answered: 9, median_seconds: 120 },
            { phone_number_id: "n2", leads: 4, answered: 0, median_seconds: null },
          ],
        }),
      });
      const body = await (await get(sb)).json<{
        by_number: { number_e164: string }[];
      }>();
      expect(body.by_number[0].number_e164).toBe("+14165550222");
    });

    it("says nothing at all when the leads arrived on ONE number", async () => {
      // Most workspaces. The row would be the headline again, and a panel that
      // repeats itself teaches people to stop reading it. Decided here so no
      // client has to remember the rule.
      const sb = stub({
        numbers: twoNumbers,
        current: statsPayload([], { by_number: [breakdown[0]] }),
      });
      const body = await (await get(sb)).json<{ by_number: unknown[] }>();
      expect(body.by_number).toEqual([]);
    });

    it("drops a row it cannot label rather than showing a UUID", async () => {
      // A number deleted between the leads arriving and this read. Naming it as
      // an id would be a report somebody has to decode before acting on it.
      const sb = stub({
        numbers: [twoNumbers[0]],
        current: statsPayload([], { by_number: breakdown }),
      });
      const body = await (await get(sb)).json<{ by_number: unknown[] }>();
      // And with only one left it is the headline again, so: nothing.
      expect(body.by_number).toEqual([]);
    });

    it("does not ask for labels it will not use", async () => {
      // The single-number case is the common one, and this read is on the home
      // panel of every workspace.
      const sb = stub({
        numbers: twoNumbers,
        current: statsPayload([], { by_number: [] }),
      });
      await get(sb);
      expect(sb.find("GET", "/rest/v1/phone_numbers")).toHaveLength(0);
    });
  });

  it("reports the median, p90 and the unanswered leak", async () => {
    const sb = stub({
      current: statsPayload([
        { opened_at: "2026-07-01T14:00:00Z", response_seconds: 120 },
        { opened_at: "2026-07-02T14:00:00Z", response_seconds: 600 },
        // The leak, named: a lead nobody ever answered.
        { opened_at: "2026-07-03T14:00:00Z", response_seconds: null },
      ]),
    });
    const res = await get(sb);
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      leads: 3,
      answered: 2,
      unanswered: 1,
      median_seconds: 360,
    });
  });

  it("splits by when the CUSTOMER wrote, not when we replied", async () => {
    // A midnight text answered at 9am is an after-hours lead we took nine hours
    // to answer. Keying the split on our reply time would file it as an in-hours
    // win, which is the flattering wrong answer.
    //
    // 2026-07-01 is a Wednesday. 04:00Z is midnight in Toronto (EDT, UTC-4);
    // 18:00Z is 2pm, inside 09:00–17:00.
    const sb = stub({
      current: statsPayload([
        { opened_at: "2026-07-01T04:00:00Z", response_seconds: 32_400 },
        { opened_at: "2026-07-01T18:00:00Z", response_seconds: 120 },
      ]),
    });
    const body = await (await get(sb)).json<{
      business_hours: { leads: number; median_seconds: number | null };
      after_hours: { leads: number; median_seconds: number | null };
    }>();
    expect(body.after_hours).toMatchObject({
      leads: 1,
      median_seconds: 32_400,
    });
    expect(body.business_hours).toMatchObject({
      leads: 1,
      median_seconds: 120,
    });
  });

  it("counts a whole weekend as after hours", async () => {
    // 2026-07-04 is a Saturday; the shop has no saturday entry, so every hour of
    // it is closed. A shop that answers a Sunday text in ten minutes should be
    // able to see that as the after-hours number it is.
    const sb = stub({
      current: statsPayload([
        { opened_at: "2026-07-04T15:00:00Z", response_seconds: 600 },
        { opened_at: "2026-07-05T15:00:00Z", response_seconds: 600 },
      ]),
    });
    const body = await (await get(sb)).json<{
      after_hours: { leads: number };
      business_hours: { leads: number };
    }>();
    expect(body.after_hours.leads).toBe(2);
    expect(body.business_hours.leads).toBe(0);
  });

  it("honours a #402 date exception, so a worked holiday is in hours", async () => {
    // The shop opened on a Saturday for an emergency callout. The one shared
    // evaluator already knows this; the point of the assertion is that this
    // route asks it rather than reimplementing the weekday loop.
    const sb = stub({
      exceptions: [
        { from: "2026-07-04", to: "2026-07-04", hours: { open: "08:00", close: "20:00" } },
      ],
      current: statsPayload([
        { opened_at: "2026-07-04T15:00:00Z", response_seconds: 600 },
      ]),
    });
    const body = await (await get(sb)).json<{
      business_hours: { leads: number };
      after_hours: { leads: number };
    }>();
    expect(body.business_hours.leads).toBe(1);
    expect(body.after_hours.leads).toBe(0);
  });

  it("refuses to invent an arc for a workspace too young to have one", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sb = stub({
      baseline: { baseline: {
        since: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), until: yesterday,
        leads: 7, answered: 5, median_seconds: 1200,
      } },
      current: statsPayload([
        { opened_at: "2026-07-01T14:00:00Z", response_seconds: 120 },
      ]),
    });
    const body = await (await get(sb)).json<Record<string, unknown>>();
    expect(body.baseline).toBeNull();
    expect(body.baseline_unavailable).toBe("too_new");
    expect(body.improved_by_seconds).toBeNull();
  });

  it("reports the arc when the baseline is real, and says which way", async () => {
    const sb = stub({
      current: statsPayload([
        { opened_at: "2026-07-01T14:00:00Z", response_seconds: 240 },
      ]),
      baseline: { baseline: {
        since: "2025-01-20T14:00:00Z", until: "2025-02-03T14:00:00Z",
        leads: 7, answered: 5, median_seconds: 10_800,
      } },
    });
    const body = await (await get(sb)).json<Record<string, unknown>>();
    expect(body.baseline).toMatchObject({ since: "2025-01-20T14:00:00Z", median_seconds: 10_800, answered: 5 });
    // Three hours to four minutes. Positive means faster now, which is the
    // sentence the customer repeats to other contractors.
    expect(body.improved_by_seconds).toBe(10_560);
  });

  it("keeps the arc unavailable when the baseline window closes without answers", async () => {
    const sb = stub({
      current: statsPayload([
        { opened_at: "2026-07-01T14:00:00Z", response_seconds: 240 },
      ]),
      baseline: { reason: "no_answered_leads" },
    });
    const body = await (await get(sb)).json<Record<string, unknown>>();
    expect(body.baseline).toBeNull();
    expect(body.baseline_unavailable).toBe("no_answered_leads");
    expect(body.improved_by_seconds).toBeNull();
  });

  it("returns baseline progress and distinct missed-caller totals", async () => {
    const sb = stub({
      baseline: { reason: "collecting", answered: 3, required: 5 },
      current: statsPayload([], { missed_callers: { total: 6, reached: 4, unreached: 2 } }),
    });

    await expect((await get(sb)).json()).resolves.toMatchObject({
      baseline: null,
      baseline_unavailable: "collecting",
      baseline_progress: { answered: 3, required: 5 },
      missed_callers: { total: 6, reached: 4, unreached: 2 },
    });
  });

  it("labels response times only when the owner opts in", async () => {
    const byMember = [
      { user_id: TECH_ID, answered: 3, median_seconds: 90 },
      { user_id: MEMBER_ID, answered: 2, median_seconds: 120 },
    ];
    const off = stub({
      perMember: false,
      current: statsPayload(
        [{ opened_at: "2026-07-01T14:00:00Z", response_seconds: 90 }],
        { by_member: byMember },
      ),
    });
    const offBody = await (await get(off)).json<Record<string, unknown>>();
    // Null rather than [] — "the owner has not opted in" and "nobody has
    // answered anything" are different facts, and the clients say different
    // things about them.
    expect(offBody.by_member).toBeNull();
    expect(offBody.per_member_enabled).toBe(false);
    expect(JSON.stringify(offBody)).not.toContain(TECH_ID);
    expect(off.find("GET", "/rest/v1/profiles")).toHaveLength(0);

    vi.unstubAllGlobals();

    const on = stub({
      perMember: true,
      current: statsPayload(
        [{ opened_at: "2026-07-01T14:00:00Z", response_seconds: 90 }],
        { by_member: byMember },
      ),
    });
    on.on("GET", "/rest/v1/profiles", () => [{ user_id: TECH_ID, display_name: "  Caroline  " }]);
    const onBody = await (await get(on)).json<Record<string, unknown>>();
    expect(onBody.by_member).toEqual([
      { ...byMember[0], name: "Caroline" },
      { ...byMember[1], name: null },
    ]);
    expect(onBody.per_member_enabled).toBe(true);
  });

  it("says out loud when the hours split covers only part of the window", async () => {
    // The aggregates stay exact over every lead; only the split is capped. A cap
    // that reports nothing reads as "we looked at everything".
    const sb = stub({
      current: statsPayload(
        [{ opened_at: "2026-07-01T14:00:00Z", response_seconds: 120 }],
        { leads: 9000, truncated: true, row_limit: 5000 },
      ),
    });
    const body = await (await get(sb)).json<Record<string, unknown>>();
    expect(body.leads).toBe(9000);
    expect(body.split_truncated).toBe(true);
    expect(body.split_row_limit).toBe(5000);
  });

  it("clamps an unknown window rather than scanning all of history", async () => {
    const sb = stub({ current: statsPayload([]) });
    const body = await (await get(sb, "?days=99999")).json<{
      window: { days: number };
    }>();
    expect(body.window.days).toBe(30);

    const [current] = sb.find("POST", "/rest/v1/rpc/api_response_time_stats");
    const since = new Date((current.body as { p_since: string }).p_since);
    const until = new Date((current.body as { p_until: string }).p_until);
    const days = Math.round(
      (until.getTime() - since.getTime()) / (24 * 60 * 60 * 1000),
    );
    expect(days).toBe(30);
  });

  it("accepts the windows the clients offer", async () => {
    for (const days of [7, 30, 90]) {
      const sb = stub({ current: statsPayload([]) });
      const body = await (await get(sb, `?days=${days}`)).json<{
        window: { days: number };
      }>();
      expect(body.window.days, String(days)).toBe(days);
      vi.unstubAllGlobals();
    }
  });

  it("reports an empty window without inventing a median", async () => {
    const sb = stub({ current: statsPayload([]) });
    const body = await (await get(sb)).json<Record<string, unknown>>();
    expect(body).toMatchObject({ leads: 0, answered: 0, unanswered: 0 });
    expect(body.median_seconds).toBeNull();
    expect(body.p90_seconds).toBeNull();
  });
});

describe("#354 GET /v1/reports/pipeline", () => {
  const QUOTE_TAG = "aaaaaaaa-1111-4222-8333-444444444444";

  function stubPipeline(
    role: string,
    windows: { quoted: number; won: number; lost: number; open: number }[],
    hiddenNumberId?: string,
  ): SupabaseStub {
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, role),
    );
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () =>
      hiddenNumberId ? [{ phone_number_id: hiddenNumberId, level: "none" }] : [],
    );
    let call = 0;
    sb.on("POST", "/rest/v1/rpc/api_pipeline_report", () => {
      const w = windows[Math.min(call, windows.length - 1)];
      call += 1;
      return { ...w, median_days_to_win: 3 };
    });
    sb.on("GET", "/rest/v1/tags", () => [
      // Renamed by the crew, and still the quote stage. The point of the whole
      // design: nothing matched on the name to find it.
      { id: QUOTE_TAG, name: "Quoted", pipeline_stage: "quote_sent" },
    ]);
    return sb;
  }

  it("reports both windows, the rate, and which tag each stage IS", async () => {
    const sb = stubPipeline("member", [
      { quoted: 10, won: 6, lost: 2, open: 2 },
      { quoted: 8, won: 2, lost: 6, open: 0 },
    ], HIDDEN_NUMBER_ID);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/reports/pipeline?days=30",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, unknown>>();
    expect(body.win_rate).toBe(75);
    expect(body.previous_win_rate).toBe(25);
    expect(body.stages).toEqual([
      { stage: "quote_sent", tag_id: QUOTE_TAG, name: "Quoted" },
    ]);
    // Two windows, so the number has a direction. A win rate with nothing to
    // compare it to is a statistic rather than something to act on.
    const calls = sb.find("POST", "/rest/v1/rpc/api_pipeline_report");
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.body).toMatchObject({ p_hidden_number_ids: [HIDDEN_NUMBER_ID] });
    }
  });

  it("divides by DECIDED jobs, so quoting more work cannot lower the rate", async () => {
    const sb = stubPipeline("member", [
      { quoted: 100, won: 6, lost: 2, open: 92 },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/reports/pipeline",
      { companyId: COMPANY_ID },
    );
    expect((await res.json<{ win_rate: number }>()).win_rate).toBe(75);
  });

  it("says nothing rather than a confident number off two jobs", async () => {
    const sb = stubPipeline("member", [{ quoted: 3, won: 2, lost: 0, open: 1 }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/reports/pipeline",
      { companyId: COMPANY_ID },
    );
    const body = await res.json<{ insight: string | null }>();
    expect(body.insight).toBeNull();
  });
});

describe("GET /v1/reports/lead-sources", () => {
  it("scopes attribution to the caller's visible lines", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, "member"));
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => [
      { phone_number_id: HIDDEN_NUMBER_ID, level: "none" },
    ]);
    sb.on("POST", "/rest/v1/rpc/api_lead_source_report", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(app, env, await auth.token(), "/v1/reports/lead-sources", {
      companyId: COMPANY_ID,
    });

    expect(response.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/rpc/api_lead_source_report")[0]?.body)
      .toMatchObject({ p_hidden_number_ids: [HIDDEN_NUMBER_ID] });
  });
});

/**
 * GET /v1/reports/satisfaction (#313).
 *
 * The arithmetic is trivial; every test below is a case where the trivial
 * implementation reports something the owner would later find out was not true:
 * an average drawn from three answers, a direction invented from a rounding
 * difference, per-member scores nobody turned on, or a "we asked nobody" that
 * is really "nobody replied".
 */
interface Rating {
  score: number | null;
  /** Days before now. */
  ago: number;
  rated_user_id?: string | null;
}

function ratingWorld(
  ratings: Rating[],
  options: { perMember?: boolean; restrictLine?: boolean } = {},
): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, options.restrictLine ? "member" : "owner"),
  );
  sb.on("POST", "/rest/v1/rpc/member_number_levels", () => [
    { phone_number_id: HIDDEN_NUMBER_ID, level: "none" },
  ]);
  sb.on("GET", "/rest/v1/companies", () => [
    { response_stats_per_member: options.perMember ?? false },
  ]);
  sb.on("GET", "/rest/v1/profiles", () => [
    { user_id: TECH_ID, display_name: "Dana" },
    { user_id: MEMBER_ID, display_name: "Sam" },
  ]);
  const now = Date.now();
  const rows = ratings
    .map((rating, index) => {
      const timestamp = new Date(now - rating.ago * 86_400_000).toISOString();
      return {
        id: `aaaaaaaa-0000-4000-8000-${String(ratings.length - index).padStart(12, "0")}`,
        task_id: `job-${index}`,
        conversation_id: `thread-${index}`,
        tasks: { title: `Job ${index}` },
        score: rating.score,
        answered_at: rating.score === null ? null : timestamp,
        rated_user_id: rating.rated_user_id ?? null,
        asked_at: timestamp,
      };
    })
    .toSorted((a, b) => b.asked_at.localeCompare(a.asked_at) || b.id.localeCompare(a.id));
  sb.on("GET", "/rest/v1/job_ratings", (call) => {
    const params = call.url.searchParams;
    expect(params.get("order")).toBe("asked_at.desc,id.desc");
    const limit = Number(params.get("limit"));
    expect(limit).toBeLessThanOrEqual(1000);
    const filter = params.get("or");
    const start = filter === null
      ? 0
      : rows.findIndex((row) => filter ===
        `(asked_at.lt.${row.asked_at},and(asked_at.eq.${row.asked_at},id.lt.${row.id}))`,
      ) + 1;
    expect(start).toBeGreaterThanOrEqual(filter === null ? 0 : 1);
    return rows.slice(start, start + limit);
  });
  return sb;
}

async function satisfaction(
  sb: SupabaseStub,
  query = "?days=30",
): Promise<Record<string, unknown>> {
  stubFetch(jwksRoute(auth), sb.route);
  const res = await apiRequest(
    app,
    env,
    await auth.token(),
    `/v1/reports/satisfaction${query}`,
    { companyId: COMPANY_ID },
  );
  expect(res.status).toBe(200);
  return res.json<Record<string, unknown>>();
}

describe("#313 satisfaction reporting", () => {
  it("filters hidden lines and trashed jobs before reading rating pages", async () => {
    const sb = ratingWorld([], { restrictLine: true });
    await satisfaction(sb);
    const query = sb.find("GET", "/rest/v1/job_ratings")[0]?.url.searchParams;

    expect(query?.get("conversations.or")).toBe(`(phone_number_id.is.null,phone_number_id.not.in.(${HIDDEN_NUMBER_ID}))`);
    expect(query?.get("conversations.deleted_at")).toBe("is.null");
    expect(query?.get("tasks.deleted_at")).toBe("is.null");
    expect(query?.get("conversations.purged_at")).toBe("is.null");
    expect(query?.get("tasks.purged_at")).toBe("is.null");
  });

  it.each([1400, 5000, 5001])("counts %i same-time ratings up to the cap", async (count) => {
    const ratings = Array.from({ length: count }, () => ({ score: 5, ago: 1 }));
    const body = await satisfaction(ratingWorld(ratings));

    expect(body.asked).toBe(Math.min(count, 5000));
    expect(body.answered).toBe(Math.min(count, 5000));
    expect(body.truncated).toBe(count > 5000);
  });

  it("SR-1: refuses to average four answers, and says which it is", async () => {
    const body = await satisfaction(
      ratingWorld([
        { score: 5, ago: 1 },
        { score: 5, ago: 2 },
        { score: 5, ago: 3 },
        { score: 1, ago: 4 },
      ]),
    );

    // Four answers with one bad one is a mean of 4.0 — a number an owner would
    // read as a problem, drawn from a sample where one customer's bad morning
    // moved it a full point.
    expect(body.average).toBeNull();
    expect(body.sample_too_small).toBe(true);
    expect(body.answered).toBe(4);
  });

  it("SR-2: at the floor it commits to a number", async () => {
    const body = await satisfaction(
      ratingWorld([
        { score: 5, ago: 1 },
        { score: 5, ago: 2 },
        { score: 4, ago: 3 },
        { score: 4, ago: 4 },
        { score: 2, ago: 5 },
      ]),
    );

    expect(body.average).toBe(4);
    expect(body.sample_too_small).toBe(false);
    expect(body.poor).toBe(1);
    expect(body.poor_jobs).toEqual([{ task_id: "job-4", conversation_id: "thread-4", score: 2, title: "Job 4" }]);
  });

  it("SR-3: 'nobody answered' is not 'we asked nobody'", async () => {
    const body = await satisfaction(
      ratingWorld([
        { score: null, ago: 1 },
        { score: null, ago: 2 },
      ]),
    );

    // Most people do not reply, and a card that reads "no jobs asked about"
    // when two were is the panel telling the owner the feature is off.
    expect(body.asked).toBe(2);
    expect(body.answered).toBe(0);
    expect(body.average).toBeNull();
    expect(body.sample_too_small).toBe(false);
  });

  it("SR-4: per-member scores stay off until the owner turns them on", async () => {
    const ratings: Rating[] = Array.from({ length: 6 }, (_, index) => ({
      score: 5,
      ago: index + 1,
      rated_user_id: TECH_ID,
    }));

    const off = await satisfaction(ratingWorld(ratings));
    expect(off.by_member).toBeNull();
    expect(off.per_member_enabled).toBe(false);

    const on = await satisfaction(ratingWorld(ratings, { perMember: true }));
    expect(on.per_member_enabled).toBe(true);
    // Named, because "which technician are customers happy with" is the
    // question, and an anonymous row cannot answer it.
    expect(on.by_member).toEqual([
      { user_id: TECH_ID, name: "Dana", answered: 6, average: 5 },
    ]);
  });

  it("SR-5: the floor applies per person, not just per workspace", async () => {
    // Eight answers in the workspace, but only two are this member's. The
    // workspace average is honest; a per-member average from two is the
    // coaching conversation #313 warns about.
    const ratings: Rating[] = [
      ...Array.from({ length: 6 }, (_, index) => ({
        score: 5,
        ago: index + 1,
        rated_user_id: MEMBER_ID,
      })),
      { score: 1, ago: 8, rated_user_id: TECH_ID },
      { score: 2, ago: 9, rated_user_id: TECH_ID },
    ];

    const body = await satisfaction(ratingWorld(ratings, { perMember: true }));
    const members = body.by_member as { user_id: string; average: number | null }[];
    expect(members.find((m) => m.user_id === MEMBER_ID)?.average).toBe(5);
    expect(members.find((m) => m.user_id === TECH_ID)?.average).toBeNull();
  });

  it("SR-6: a rounding-sized move is not called a direction", async () => {
    // Current window averages 4.4, the one before 4.5. That is not "worse".
    const body = await satisfaction(
      ratingWorld([
        { score: 5, ago: 1 },
        { score: 5, ago: 2 },
        { score: 4, ago: 3 },
        { score: 4, ago: 4 },
        { score: 4, ago: 5 },
        { score: 5, ago: 40 },
        { score: 5, ago: 41 },
        { score: 4, ago: 42 },
        { score: 4, ago: 43 },
        { score: 5, ago: 44 },
      ]),
    );

    expect(body.average).toBe(4.4);
    expect((body.baseline as { average: number }).average).toBe(4.6);
    // The endpoint reports the delta; the shared helper decides whether it is a
    // direction. -0.2 is exactly at the threshold, so this one does count.
    expect(body.improved_by).toBe(-0.2);
  });

  it("SR-7: the window boundary keeps the two periods apart", async () => {
    const body = await satisfaction(
      ratingWorld([
        { score: 5, ago: 1 },
        { score: 5, ago: 2 },
        { score: 5, ago: 3 },
        { score: 5, ago: 4 },
        { score: 5, ago: 5 },
        // 40 days ago: outside a 30-day window, inside the 30 before it.
        { score: 1, ago: 40 },
        { score: 1, ago: 41 },
        { score: 1, ago: 42 },
        { score: 1, ago: 43 },
        { score: 1, ago: 44 },
      ]),
    );

    // If the boundary leaked, the current average would drag toward 3.
    expect(body.average).toBe(5);
    expect(body.answered).toBe(5);
    expect((body.baseline as { average: number }).average).toBe(1);
  });

  it("SR-8: no baseline is null, not a comparison against nothing", async () => {
    const body = await satisfaction(
      ratingWorld([
        { score: 4, ago: 1 },
        { score: 4, ago: 2 },
        { score: 4, ago: 3 },
        { score: 4, ago: 4 },
        { score: 4, ago: 5 },
      ]),
    );

    expect(body.baseline).toBeNull();
    expect(body.improved_by).toBeNull();
  });
});
