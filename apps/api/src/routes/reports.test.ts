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

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
  type SupabaseStub,
} from "../test/routes-harness";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import { reportsRoutes } from "./reports";

const env = completeEnv();
const COMPANY_ID = "5c1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "1d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const TECH_ID = "2d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

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
    .sort((a, b) => a - b);
  const mid = Math.floor(answered.length / 2);
  return {
    leads: rows.length,
    answered: answered.length,
    unanswered: rows.length - answered.length,
    median_seconds:
      answered.length === 0
        ? null
        : answered.length % 2 === 0
          ? (answered[mid - 1] + answered[mid]) / 2
          : answered[mid],
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
  createdAt?: string;
  perMember?: boolean;
  hours?: Record<string, { open: string; close: string }>;
  exceptions?: unknown[];
  current: Record<string, unknown>;
  baseline?: Record<string, unknown>;
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
      // Old enough for a baseline unless a test says otherwise.
      created_at: options.createdAt ?? "2025-01-01T00:00:00Z",
      timezone: "America/Toronto",
      business_hours: options.hours ?? NINE_TO_FIVE,
      business_hours_exceptions: options.exceptions ?? [],
      response_stats_per_member: options.perMember ?? false,
    },
  ]);
  // #482: the numbers the by_number rows are labelled from.
  sb.on("GET", "/rest/v1/phone_numbers", () => options.numbers ?? []);
  // The route calls the same RPC twice — current window, then baseline. The
  // stub answers in that order.
  const answers = [options.current, options.baseline ?? statsPayload([])];
  let call = 0;
  sb.on("POST", "/rest/v1/rpc/api_response_time_stats", () => {
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    return answer;
  });
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
      const body = (await (await get(sb)).json()) as {
        by_number: { number_e164: string; median_seconds: number | null }[];
      };
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
      const body = (await (await get(sb)).json()) as {
        by_number: { median_seconds: number | null }[];
      };
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
      const body = (await (await get(sb)).json()) as {
        by_number: { number_e164: string }[];
      };
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
      const body = (await (await get(sb)).json()) as { by_number: unknown[] };
      expect(body.by_number).toEqual([]);
    });

    it("drops a row it cannot label rather than showing a UUID", async () => {
      // A number deleted between the leads arriving and this read. Naming it as
      // an id would be a report somebody has to decode before acting on it.
      const sb = stub({
        numbers: [twoNumbers[0]],
        current: statsPayload([], { by_number: breakdown }),
      });
      const body = (await (await get(sb)).json()) as { by_number: unknown[] };
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
    const body = (await res.json()) as Record<string, unknown>;
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
    const body = (await (await get(sb)).json()) as {
      business_hours: { leads: number; median_seconds: number | null };
      after_hours: { leads: number; median_seconds: number | null };
    };
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
    const body = (await (await get(sb)).json()) as {
      after_hours: { leads: number };
      business_hours: { leads: number };
    };
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
    const body = (await (await get(sb)).json()) as {
      business_hours: { leads: number };
      after_hours: { leads: number };
    };
    expect(body.business_hours.leads).toBe(1);
    expect(body.after_hours.leads).toBe(0);
  });

  it("refuses to invent an arc for a workspace too young to have one", async () => {
    // Signed up yesterday. The first-fortnight baseline would overlap the
    // current window, so comparing them compares the workspace to itself and
    // reports the result as progress.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sb = stub({
      createdAt: yesterday,
      current: statsPayload([
        { opened_at: "2026-07-01T14:00:00Z", response_seconds: 120 },
      ]),
    });
    const body = (await (await get(sb)).json()) as Record<string, unknown>;
    expect(body.baseline).toBeNull();
    expect(body.baseline_unavailable).toBe("too_new");
    expect(body.improved_by_seconds).toBeNull();
  });

  it("reports the arc when the baseline is real, and says which way", async () => {
    const sb = stub({
      current: statsPayload([
        { opened_at: "2026-07-01T14:00:00Z", response_seconds: 240 },
      ]),
      baseline: statsPayload([
        { opened_at: "2025-01-02T14:00:00Z", response_seconds: 10_800 },
      ]),
    });
    const body = (await (await get(sb)).json()) as Record<string, unknown>;
    expect(body.baseline).toMatchObject({ median_seconds: 10_800, answered: 1 });
    // Three hours to four minutes. Positive means faster now, which is the
    // sentence the customer repeats to other contractors.
    expect(body.improved_by_seconds).toBe(10_560);
  });

  it("calls a first fortnight with no answers no baseline, not a baseline of zero", async () => {
    // Reporting "you have improved from 0 seconds" for a workspace that answered
    // nothing in its first two weeks is the arc as fiction.
    const sb = stub({
      current: statsPayload([
        { opened_at: "2026-07-01T14:00:00Z", response_seconds: 240 },
      ]),
      baseline: statsPayload([
        { opened_at: "2025-01-02T14:00:00Z", response_seconds: null },
      ]),
    });
    const body = (await (await get(sb)).json()) as Record<string, unknown>;
    expect(body.baseline).toBeNull();
    expect(body.baseline_unavailable).toBe("no_answered_leads");
    expect(body.improved_by_seconds).toBeNull();
  });

  it("withholds per-member numbers until the owner opts in", async () => {
    const byMember = [{ user_id: TECH_ID, answered: 3, median_seconds: 90 }];
    const off = stub({
      perMember: false,
      current: statsPayload(
        [{ opened_at: "2026-07-01T14:00:00Z", response_seconds: 90 }],
        { by_member: byMember },
      ),
    });
    const offBody = (await (await get(off)).json()) as Record<string, unknown>;
    // Null rather than [] — "the owner has not opted in" and "nobody has
    // answered anything" are different facts, and the clients say different
    // things about them.
    expect(offBody.by_member).toBeNull();
    expect(offBody.per_member_enabled).toBe(false);
    expect(JSON.stringify(offBody)).not.toContain(TECH_ID);

    vi.unstubAllGlobals();

    const on = stub({
      perMember: true,
      current: statsPayload(
        [{ opened_at: "2026-07-01T14:00:00Z", response_seconds: 90 }],
        { by_member: byMember },
      ),
    });
    const onBody = (await (await get(on)).json()) as Record<string, unknown>;
    expect(onBody.by_member).toEqual(byMember);
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
    const body = (await (await get(sb)).json()) as Record<string, unknown>;
    expect(body.leads).toBe(9000);
    expect(body.split_truncated).toBe(true);
    expect(body.split_row_limit).toBe(5000);
  });

  it("clamps an unknown window rather than scanning all of history", async () => {
    const sb = stub({ current: statsPayload([]) });
    const body = (await (await get(sb, "?days=99999")).json()) as {
      window: { days: number };
    };
    expect(body.window.days).toBe(30);

    const calls = sb.find("POST", "/rest/v1/rpc/api_response_time_stats");
    const since = new Date((calls[0].body as { p_since: string }).p_since);
    const until = new Date((calls[0].body as { p_until: string }).p_until);
    const days = Math.round(
      (until.getTime() - since.getTime()) / (24 * 60 * 60 * 1000),
    );
    expect(days).toBe(30);
  });

  it("accepts the windows the clients offer", async () => {
    for (const days of [7, 30, 90]) {
      const sb = stub({ current: statsPayload([]) });
      const body = (await (await get(sb, `?days=${days}`)).json()) as {
        window: { days: number };
      };
      expect(body.window.days, String(days)).toBe(days);
      vi.unstubAllGlobals();
    }
  });

  it("reports an empty window without inventing a median", async () => {
    const sb = stub({ current: statsPayload([]) });
    const body = (await (await get(sb)).json()) as Record<string, unknown>;
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
  ): SupabaseStub {
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, role),
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
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/reports/pipeline?days=30",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.win_rate).toBe(75);
    expect(body.previous_win_rate).toBe(25);
    expect(body.stages).toEqual([
      { stage: "quote_sent", tag_id: QUOTE_TAG, name: "Quoted" },
    ]);
    // Two windows, so the number has a direction. A win rate with nothing to
    // compare it to is a statistic rather than something to act on.
    expect(sb.find("POST", "/rest/v1/rpc/api_pipeline_report")).toHaveLength(2);
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
    expect(((await res.json()) as { win_rate: number }).win_rate).toBe(75);
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
    const body = (await res.json()) as { insight: string | null };
    expect(body.insight).toBeNull();
  });
});
