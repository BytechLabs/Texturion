/**
 * POST /v1/conversations/:id/summary (#247) — the cost, safety and carrier-truth
 * envelope around the pure core in messaging/thread-summary.ts.
 *
 * What is asserted here is what protects a customer, a crew, and the bill:
 *
 *   - CARRIER TRUTH IS NOT OPTIONAL. The opt-out standing rides back on every
 *     response shape, and a workspace whose opt-out state cannot be established
 *     gets NO summary. A tidy paragraph standing where a legally binding STOP
 *     should be is the failure #247 names and the opt-out mandate forbids.
 *   - NOTHING IS SPENT before the free gates: the toggle, the human spam flag,
 *     and the length rule all refuse without touching the ledger or the model.
 *   - THE CACHE IS FREE. Re-opening an unchanged thread makes no reservation
 *     and no model call, which is a cost requirement before it is a latency one.
 *   - INTERNAL NOTES NEVER ENTER THE PROMPT.
 *   - EVERY FAILURE DEGRADES TO SILENCE. A busy inbox gets an empty list and a
 *     reason, never an error box.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Env, RateLimiter, WorkersAi } from "../env";
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
import {
  THREAD_SUMMARY_CONTEXT_MESSAGES,
  THREAD_SUMMARY_MAX_OUTPUT_TOKENS,
  THREAD_SUMMARY_MODEL,
} from "../messaging/thread-summary";
import { conversationsRoutes } from "./conversations";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONV_ID = "aaaaaaaa-1111-4222-8333-444444444444";
const CONTACT_ID = "dddddddd-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(conversationsRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mockAi(result: unknown): { ai: WorkersAi; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async () => result);
  return { ai: { run }, run };
}

/** A burst limiter that always answers the same way, and remembers its keys. */
function fakeLimiter(
  success: boolean,
): RateLimiter & { limit: ReturnType<typeof vi.fn> } {
  return { limit: vi.fn(async () => ({ success })) };
}

/**
 * A model answer that QUOTES two real messages in the fixture window.
 *
 * Quotes, not summaries of them: a line survives only if the message it cites
 * contains it (`quotedFromSource`), so a fixture written the way a person
 * would summarise is a fixture that tests nothing past the sanitiser's first
 * few rules. See messaging/thread-summary.test.ts for why the model is allowed
 * to select and not to phrase.
 */
const CITED = {
  response: JSON.stringify({
    asked: [{ t: "no hot water since Friday", m: 1 }],
    open: [{ t: "we will take a look", m: 2 }],
  }),
};

/** A model answer whose every line points outside the window. */
const UNCITED = {
  response: JSON.stringify({
    asked: [{ t: "they agreed to Tuesday", m: 99 }],
  }),
};

/** A model answer that SUMMARISES message 1 instead of quoting it. */
const PARAPHRASED = {
  response: JSON.stringify({
    asked: [{ t: "customer has had no hot water since the weekend", m: 1 }],
  }),
};

/**
 * A model answer filing the CUSTOMER's opening message under "What we said" —
 * and quoting it perfectly, which is what makes the attribution rule still
 * necessary: honest selection under the wrong heading changes who said it.
 */
const MISATTRIBUTED = {
  response: JSON.stringify({
    we_said: [{ t: "no hot water since Friday", m: 1 }],
  }),
};

interface Row {
  id: string;
  direction: string;
  body: string | null;
  created_at: string;
}

/**
 * `count` customer-visible rows, NEWEST FIRST — which is what the route's own
 * `.order("created_at", { ascending: false })` asks PostgREST for, and what it
 * then reverses into the oldest-first window.
 *
 * The fixture used to hand back oldest-first while claiming otherwise, and two
 * reversals cancelled: `msg-1` came out as "the newest message" and the cache
 * assertions passed by matching the same mistake. Nothing caught it because
 * nothing in the suite depended on WHICH end was which — until the attribution
 * rule made every line's direction load-bearing.
 */
function thread(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => {
    const index = count - i;
    return {
      id: `msg-${index}`,
      // Odd inbound, even outbound: `msg-1` is the customer's opening message
      // and `msg-2` is the crew's reply, which is what CITED points at.
      direction: index % 2 === 1 ? "inbound" : "outbound",
      body:
        index === 1
          ? "no hot water since Friday"
          : index === 2
            ? "we will take a look"
            : `message ${index}`,
      created_at: new Date(Date.UTC(2026, 6, 1, index)).toISOString(),
    };
  });
}

interface StubOptions {
  spam?: boolean;
  settings?: { summarize_threads: boolean } | null;
  messages?: Row[];
  reserve?: { count: number; over_cap: boolean; should_alert: boolean } | Response;
  /** An open opt-out row for this contact, or none. */
  optOut?: { source: string; created_at: string } | null;
  /** Force the opt-out read to fail, so carrier truth cannot be established. */
  optOutBroken?: boolean;
  /** A cached summary row, or none. */
  cache?: {
    last_message_id: string;
    lines: unknown;
    model?: string;
  } | null;
  optOutHintAt?: string | null;
}

function stubs(options: StubOptions = {}): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, "member"),
  );
  sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
  sb.on("GET", "/rest/v1/conversations", () => [
    {
      id: CONV_ID,
      company_id: COMPANY_ID,
      contact_id: CONTACT_ID,
      phone_number_id: "eeeeeeee-1111-4222-8333-444444444444",
      status: options.spam === true ? "closed" : "open",
      is_spam: options.spam === true,
      assigned_user_id: null,
      pinned_at: null,
      pinned_by_user_id: null,
      last_message_at: "2026-07-01T10:00:00+00:00",
      opt_out_hint_at: options.optOutHintAt ?? null,
      closed_at: null,
      created_at: "2026-06-30T10:00:00+00:00",
      updated_at: "2026-07-01T10:00:00+00:00",
    },
  ]);
  // First-match-wins: the opt-out path reads only phone_e164, the prompt path
  // reads only name, so one handler answers both by looking at the select.
  sb.on("GET", "/rest/v1/contacts", (call) =>
    call.url.searchParams.get("select") === "phone_e164"
      ? options.optOutBroken === true
        ? new Response(JSON.stringify({ message: "contacts unreachable" }), {
            status: 500,
          })
        : [{ phone_e164: "+16135550100" }]
      : [{ name: "Dana Reyes" }],
  );
  sb.on("GET", "/rest/v1/opt_outs", () =>
    options.optOut ? [options.optOut] : [],
  );
  sb.on("GET", "/rest/v1/company_ai_settings", () =>
    options.settings === undefined || options.settings === null
      ? []
      : [
          {
            enrich_task_address: true,
            enrich_task_due: true,
            suggest_replies: true,
            business_description: null,
            transcribe_voicemail: true,
            voicemail_intake: false,
            call_wrapup: true,
            summarize_threads: options.settings.summarize_threads,
          },
        ],
  );
  sb.on("GET", "/rest/v1/messages", () => options.messages ?? thread(14));
  sb.on("GET", "/rest/v1/conversation_summaries", () =>
    options.cache
      ? [
          {
            last_message_id: options.cache.last_message_id,
            lines: options.cache.lines,
            model: options.cache.model ?? THREAD_SUMMARY_MODEL,
          },
        ]
      : [],
  );
  sb.on("POST", "/rest/v1/conversation_summaries", () => []);
  sb.on("GET", "/rest/v1/companies", (call) =>
    call.url.searchParams.get("select") === "name,timezone"
      ? [{ name: "Bolt Plumbing", timezone: "America/Toronto" }]
      : undefined,
  );
  sb.on("POST", "/rest/v1/rpc/ai_usage_reserve", () =>
    options.reserve ?? { count: 1, over_cap: false, should_alert: false },
  );
  return sb;
}

async function summarize(sb: SupabaseStub, runtime: Env): Promise<Response> {
  stubFetch(jwksRoute(auth), sb.route);
  return apiRequest(
    app,
    runtime,
    await auth.token(),
    `/v1/conversations/${CONV_ID}/summary`,
    { method: "POST", body: {}, companyId: COMPANY_ID },
  );
}

describe("carrier truth outranks a tidy paragraph", () => {
  it("refuses the whole summary when the opt-out standing cannot be read", async () => {
    // The one gate here that fails CLOSED on a broken read. Everything else
    // degrades onto "no catch-up, the thread is still there"; this one lands in
    // the same place for a different reason — a summary is what a hurried person
    // reads INSTEAD of the thread, so it must never be the thing that hides a
    // STOP.
    const sb = stubs({ optOutBroken: true });
    const { ai, run } = mockAi(CITED);
    const res = await summarize(sb, { ...env, AI: ai });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lines: [],
      reason: "unavailable",
      opt_out: null,
      opt_out_hint_at: null,
    });
    expect(run).not.toHaveBeenCalled();
    expect(sb.find("POST", "/rest/v1/rpc/ai_usage_reserve")).toHaveLength(0);
  });

  it("carries the opt-out beside a successful summary", async () => {
    const sb = stubs({
      optOut: { source: "stop_keyword", created_at: "2026-06-30T09:00:00+00:00" },
    });
    const { ai } = mockAi(CITED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      lines: unknown[];
      opt_out: { source: string; at: string } | null;
    };
    // Both. A summary that succeeded is exactly the case where burying this
    // would do the damage.
    expect(body.lines.length).toBeGreaterThan(0);
    expect(body.opt_out).toEqual({
      source: "stop_keyword",
      at: "2026-06-30T09:00:00+00:00",
    });
  });

  it("carries the opt-out on a refusal too", async () => {
    const sb = stubs({
      settings: { summarize_threads: false },
      optOut: { source: "carrier", created_at: "2026-06-30T09:00:00+00:00" },
    });
    const body = (await (await summarize(sb, env)).json()) as {
      reason: string;
      opt_out: { source: string } | null;
    };
    expect(body.reason).toBe("disabled");
    expect(body.opt_out?.source).toBe("carrier");
  });

  it("carries the plain-English opt-out hint, which is not an opt-out", async () => {
    // #396: an inbound message that READS as an opt-out is a warning to whoever
    // replies next, never a standing. The two fields stay separate so nothing
    // downstream can collapse a guess into a fact.
    const sb = stubs({ optOutHintAt: "2026-07-01T08:00:00+00:00" });
    const { ai } = mockAi(CITED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      opt_out: unknown;
      opt_out_hint_at: string | null;
    };
    expect(body.opt_out).toBeNull();
    expect(body.opt_out_hint_at).toBe("2026-07-01T08:00:00+00:00");
  });
});

describe("nothing is spent before the free gates", () => {
  it("never reaches the model for a workspace that turned catch-ups off", async () => {
    const sb = stubs({ settings: { summarize_threads: false } });
    const { ai, run } = mockAi(CITED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      reason: string;
    };
    expect(body.reason).toBe("disabled");
    expect(run).not.toHaveBeenCalled();
    expect(sb.find("POST", "/rest/v1/rpc/ai_usage_reserve")).toHaveLength(0);
  });

  it("never spends on a thread a human marked spam", async () => {
    const sb = stubs({ spam: true });
    const { ai, run } = mockAi(CITED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      reason: string;
    };
    expect(body.reason).toBe("spam");
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a thread too short to be worth summarising", async () => {
    // The free pre-filter. A summary of a four-message thread is slower to read
    // than the thread, and asking anyway buys an AI unit to say so.
    const sb = stubs({ messages: thread(3) });
    const { ai, run } = mockAi(CITED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      reason: string;
    };
    expect(body.reason).toBe("too_short");
    expect(run).not.toHaveBeenCalled();
    expect(sb.find("POST", "/rest/v1/rpc/ai_usage_reserve")).toHaveLength(0);
  });

  it("does not call the model when the monthly cap is spent", async () => {
    const sb = stubs({
      reserve: { count: 501, over_cap: true, should_alert: false },
    });
    const { ai, run } = mockAi(CITED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      lines: unknown[];
      reason: string;
    };
    expect(body).toMatchObject({ lines: [], reason: "over_cap" });
    expect(run).not.toHaveBeenCalled();
  });

  it("treats an unreachable ledger as over cap", async () => {
    // Failing closed: a broken ledger costs a catch-up, never an unbounded bill.
    const sb = stubs({
      reserve: new Response(JSON.stringify({ message: "nope" }), { status: 500 }),
    });
    const { ai, run } = mockAi(CITED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      reason: string;
    };
    expect(body.reason).toBe("over_cap");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("the burst limiters, which the monthly cap cannot stand in for", () => {
  /**
   * WHY A SECOND KIND OF LIMIT EXISTS. The cap is a per-company MONTHLY ceiling
   * and it is spent in whatever order requests arrive, so on its own a stuck
   * retry loop or a stolen token spends the crew's whole month in a few
   * seconds, and the cap alert is the first anybody hears of it. The limiters
   * bound the RATE; the cap bounds the TOTAL.
   *
   * Both were previously deletable from the route with every test still green,
   * which is the same failure as not having them: an absent binding is the
   * documented dev/test behaviour, so "it did not fire" is indistinguishable
   * from "it is not there" unless a test supplies one.
   */
  it("refuses on the COMPANY burst before the model or the ledger", async () => {
    const sb = stubs({
      optOut: { source: "stop_keyword", created_at: "2026-06-30T09:00:00+00:00" },
    });
    const limiter = fakeLimiter(false);
    const { ai, run } = mockAi(CITED);
    const body = (await (
      await summarize(sb, { ...env, AI: ai, AI_REPLY_RATE_LIMITER: limiter })
    ).json()) as { lines: unknown[]; reason: string; opt_out: { source: string } | null };

    expect(body).toMatchObject({ lines: [], reason: "rate_limited" });
    expect(limiter.limit).toHaveBeenCalledWith({ key: COMPANY_ID });
    expect(run).not.toHaveBeenCalled();
    expect(sb.find("POST", "/rest/v1/rpc/ai_usage_reserve")).toHaveLength(0);
    // Carrier truth rides on THIS refusal too. It is the shape most likely to
    // be forgotten, being the one nobody writes on purpose.
    expect(body.opt_out?.source).toBe("stop_keyword");
  });

  it("refuses on the MEMBER burst, keyed per member and not per workspace", async () => {
    // The key is the whole point of the second limiter: keyed on the company it
    // would be the first one again, and one runaway client could still spend
    // everyone else's month inside the company allowance.
    const sb = stubs();
    const company = fakeLimiter(true);
    const member = fakeLimiter(false);
    const { ai, run } = mockAi(CITED);
    const body = (await (
      await summarize(sb, {
        ...env,
        AI: ai,
        AI_REPLY_RATE_LIMITER: company,
        AI_MEMBER_RATE_LIMITER: member,
      })
    ).json()) as { reason: string };

    expect(body.reason).toBe("rate_limited");
    expect(member.limit).toHaveBeenCalledWith({
      key: `${COMPANY_ID}:${auth.subject}`,
    });
    expect(run).not.toHaveBeenCalled();
    expect(sb.find("POST", "/rest/v1/rpc/ai_usage_reserve")).toHaveLength(0);
  });

  it("summarises normally when both allow, having asked both", async () => {
    // The other half of proving a guard: a limiter that says yes must not cost
    // the feature anything, and both have to have been consulted — a route that
    // asks neither passes the two refusals above by never being reached.
    const sb = stubs();
    const company = fakeLimiter(true);
    const member = fakeLimiter(true);
    const { ai, run } = mockAi(CITED);
    const body = (await (
      await summarize(sb, {
        ...env,
        AI: ai,
        AI_REPLY_RATE_LIMITER: company,
        AI_MEMBER_RATE_LIMITER: member,
      })
    ).json()) as { lines: unknown[] };

    expect(company.limit).toHaveBeenCalledTimes(1);
    expect(member.limit).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(body.lines.length).toBeGreaterThan(0);
  });

  it("does not spend a burst allowance on a thread served from cache", async () => {
    // A cache hit costs nothing, and "nothing" includes the rate budget: a
    // limiter consulted before the cache would make re-opening an unchanged
    // thread able to lock somebody out of a summary they could have had free.
    const rows = thread(14);
    const sb = stubs({
      messages: rows,
      cache: {
        last_message_id: rows[0].id,
        lines: {
          lines: [
            {
              section: "asked",
              text: "no hot water since Friday",
              message_id: rows[0].id,
              at: rows[0].created_at,
            },
          ],
          truncated: false,
        },
      },
    });
    const company = fakeLimiter(true);
    const { ai } = mockAi(CITED);
    const body = (await (
      await summarize(sb, { ...env, AI: ai, AI_REPLY_RATE_LIMITER: company })
    ).json()) as { cached: boolean };

    expect(body.cached).toBe(true);
    expect(company.limit).not.toHaveBeenCalled();
  });
});

describe("the window and the prompt", () => {
  it("asks PostgREST for customer-visible messages only, capped at the window", async () => {
    // INTERNAL NOTES ARE EXCLUDED BY THIS FILTER, and it is load-bearing twice
    // over here: a note is where a crew writes "this guy never pays", and a
    // summary is a paragraph that could carry it anywhere.
    const sb = stubs();
    const { ai } = mockAi(CITED);
    await summarize(sb, { ...env, AI: ai });
    const read = sb.find("GET", "/rest/v1/messages")[0];
    expect(read.url.searchParams.get("direction")).toBe("in.(inbound,outbound)");
    expect(read.url.searchParams.get("limit")).toBe(
      String(THREAD_SUMMARY_CONTEXT_MESSAGES),
    );
  });

  it("never puts a note in the prompt even if one reaches the row set", async () => {
    // Belt and braces: the filter is the guarantee, and this asserts the prompt
    // builder would not carry one through if the filter were ever loosened.
    const sb = stubs({
      messages: [
        ...thread(13),
        {
          id: "note-1",
          direction: "note",
          body: "this guy never pays",
          created_at: "2026-07-01T23:00:00.000Z",
        },
      ],
    });
    const { ai, run } = mockAi(CITED);
    await summarize(sb, { ...env, AI: ai });
    expect(JSON.stringify(run.mock.calls[0][1])).not.toContain("never pays");
  });

  it("caps what the model may WRITE, not only what it may read", async () => {
    // C1. Output on this model costs 8.5x input, so the smaller half of the
    // token count is the larger half of the bill — and this was the one bound
    // in `AI_UNIT_COST_CENTS.thread_summary`'s arithmetic that nothing checked
    // had reached the provider at all. Deleting `max_tokens` from the call, or
    // sizing it against anything but the shipped constant, fails here.
    const sb = stubs();
    const { ai, run } = mockAi(CITED);
    await summarize(sb, { ...env, AI: ai });
    expect(run.mock.calls[0][1]).toMatchObject({
      max_tokens: THREAD_SUMMARY_MAX_OUTPUT_TOKENS,
    });
  });

  it("says the card covers a window when the thread is longer than one", async () => {
    const sb = stubs({ messages: thread(THREAD_SUMMARY_CONTEXT_MESSAGES) });
    const { ai } = mockAi(CITED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      truncated: boolean;
    };
    expect(body.truncated).toBe(true);
  });
});

describe("output that cannot be trusted is not shown", () => {
  it("returns nothing when every line points outside the window", async () => {
    // The whole point. The model answered, fluently, and none of it survived —
    // which is the honest failure this feature is built to have.
    const sb = stubs();
    const { ai } = mockAi(UNCITED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      lines: unknown[];
      reason: string;
      dropped: { uncited: number; candidates: number };
    };
    expect(body.lines).toEqual([]);
    expect(body.reason).toBe("unusable_output");
    expect(body.dropped.uncited).toBe(1);
    expect(body.dropped.candidates).toBe(1);
  });

  it("refuses a line filed under the wrong speaker's heading", async () => {
    // End to end, because the direction has to survive the route's own row
    // mapping to reach the rule. `msg-1` is the customer's opening message, so
    // nothing grounded in it may be rendered as something the crew said.
    const sb = stubs();
    const { ai } = mockAi(MISATTRIBUTED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      lines: unknown[];
      reason: string;
      dropped: { misattributed: number };
    };
    expect(body.lines).toEqual([]);
    expect(body.reason).toBe("unusable_output");
    expect(body.dropped.misattributed).toBe(1);
  });

  it("shows nothing rather than a sentence no message contains", async () => {
    // End to end, because the message BODY has to survive the route's own row
    // mapping to reach the quotation rule — the citation and the direction were
    // enough for every other rule, and this one needs the words. The line is
    // true, fluent and cites the right message; it is not in it, so it goes.
    const sb = stubs();
    const { ai } = mockAi(PARAPHRASED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      lines: unknown[];
      reason: string;
      dropped: { notQuoted: number };
    };
    expect(body.lines).toEqual([]);
    expect(body.reason).toBe("unusable_output");
    expect(body.dropped.notQuoted).toBe(1);
  });

  it("hands back a tally with no line text in it", async () => {
    const sb = stubs();
    const { ai } = mockAi(UNCITED);
    const raw = await (await summarize(sb, { ...env, AI: ai })).text();
    expect(raw).not.toContain("they agreed to Tuesday");
  });

  it("names the envelope shape when the model answer is unrecognisable", async () => {
    const sb = stubs();
    const { ai } = mockAi({ surprising: "shape" });
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      envelope: string;
    };
    expect(body.envelope).toBe("surprising");
  });

  it("attaches a real message id and timestamp to every line it does show", async () => {
    const sb = stubs();
    const { ai } = mockAi(CITED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      lines: { text: string; message_id: string; at: string }[];
    };
    expect(body.lines).toHaveLength(2);
    for (const line of body.lines) {
      expect(line.message_id).toMatch(/^msg-\d+$/);
      expect(Number.isFinite(Date.parse(line.at))).toBe(true);
    }
  });
});

describe("the cache", () => {
  it("serves an unchanged thread without reserving or calling the model", async () => {
    // #247: "cached so re-opening an unchanged thread costs nothing". Nothing
    // means nothing — no reservation, no model call.
    const rows = thread(14);
    const newest = rows[0].id;
    const sb = stubs({
      messages: rows,
      cache: {
        last_message_id: newest,
        lines: {
          lines: [
            {
              section: "asked",
              text: "no hot water since Friday",
              message_id: newest,
              at: rows[0].created_at,
            },
          ],
          truncated: false,
        },
      },
    });
    const { ai, run } = mockAi(CITED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      lines: unknown[];
      cached: boolean;
    };
    expect(body.cached).toBe(true);
    expect(body.lines).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();
    expect(sb.find("POST", "/rest/v1/rpc/ai_usage_reserve")).toHaveLength(0);
  });

  it("re-summarises once a new message has arrived", async () => {
    const rows = thread(14);
    const sb = stubs({
      messages: rows,
      // Anchored to a message that is no longer the newest.
      cache: { last_message_id: "msg-13", lines: { lines: [], truncated: false } },
    });
    const { ai, run } = mockAi(CITED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      cached?: boolean;
    };
    expect(run).toHaveBeenCalledTimes(1);
    expect(body.cached).toBeUndefined();
  });

  it("ignores a cached summary written by a model we no longer call", async () => {
    const rows = thread(14);
    const sb = stubs({
      messages: rows,
      cache: {
        last_message_id: rows[0].id,
        model: "@cf/meta/llama-2-retired",
        lines: {
          lines: [
            {
              section: "asked",
              text: "stale",
              message_id: rows[0].id,
              at: rows[0].created_at,
            },
          ],
        },
      },
    });
    const { ai, run } = mockAi(CITED);
    await summarize(sb, { ...env, AI: ai });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("drops a cached line whose cited message has since disappeared", async () => {
    // Retention or a purge can take the message a line points at. Serving it
    // would be the only way this feature could show somebody a claim with no
    // message behind it, so the citation is re-checked against the window we
    // just read — which costs nothing, because it is already here.
    const rows = thread(14);
    const sb = stubs({
      messages: rows,
      cache: {
        last_message_id: rows[0].id,
        lines: {
          lines: [
            {
              section: "asked",
              text: "cites a purged message",
              message_id: "msg-gone",
              at: "2026-06-01T00:00:00.000Z",
            },
          ],
          truncated: false,
        },
      },
    });
    const { ai, run } = mockAi(CITED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      lines: { text: string }[];
      cached?: boolean;
    };
    // Not served from cache, and the fresh answer is what comes back.
    expect(body.cached).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
    expect(body.lines.map((line) => line.text)).not.toContain(
      "cites a purged message",
    );
  });

  it("writes the cache anchored to the newest customer-visible message", async () => {
    const rows = thread(14);
    const sb = stubs({ messages: rows });
    const { ai } = mockAi(CITED);
    await summarize(sb, { ...env, AI: ai });
    const write = sb.find("POST", "/rest/v1/conversation_summaries")[0];
    expect(write).toBeDefined();
    expect(write.body).toMatchObject({
      conversation_id: CONV_ID,
      company_id: COMPANY_ID,
      last_message_id: rows[0].id,
      model: THREAD_SUMMARY_MODEL,
    });
  });

  it("caches the finding that nothing survived, so it is paid for once", async () => {
    // C2. `unusable_output` used to return before the write, which made the
    // most expensive call this product can make the only one with no memory of
    // having been made — and it is the refusal a person retries, because it
    // reads as a glitch rather than as an answer.
    const rows = thread(14);
    const sb = stubs({ messages: rows });
    const { ai } = mockAi(UNCITED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      reason: string;
    };
    expect(body.reason).toBe("unusable_output");
    const write = sb.find("POST", "/rest/v1/conversation_summaries")[0];
    expect(write).toBeDefined();
    expect(write.body).toMatchObject({
      last_message_id: rows[0].id,
      lines: { lines: [] },
    });
  });

  it("re-summarises rather than serving a cached row it cannot read", async () => {
    // An empty summary is now an ANSWER the route serves without calling the
    // model, so a payload whose shape we do not recognise must not collapse
    // into one — that would be a refusal a workspace could never get past.
    const rows = thread(14);
    const sb = stubs({
      messages: rows,
      cache: { last_message_id: rows[0].id, lines: { truncated: false } },
    });
    const { ai, run } = mockAi(CITED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      lines: unknown[];
      cached?: boolean;
    };
    expect(run).toHaveBeenCalledTimes(1);
    expect(body.cached).toBeUndefined();
    expect(body.lines.length).toBeGreaterThan(0);
  });

  it("does not call the model again for a thread state already known to fail", async () => {
    const rows = thread(14);
    const sb = stubs({
      messages: rows,
      cache: { last_message_id: rows[0].id, lines: { lines: [], truncated: false } },
    });
    const { ai, run } = mockAi(CITED);
    const body = (await (await summarize(sb, { ...env, AI: ai })).json()) as {
      lines: unknown[];
      reason: string;
      cached: boolean;
    };
    expect(body).toMatchObject({
      lines: [],
      reason: "unusable_output",
      cached: true,
    });
    expect(run).not.toHaveBeenCalled();
    expect(sb.find("POST", "/rest/v1/rpc/ai_usage_reserve")).toHaveLength(0);
  });
});

describe("every failure degrades to silence", () => {
  it("says so rather than erroring when there is no AI binding", async () => {
    const sb = stubs();
    const res = await summarize(sb, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ lines: [], reason: "unavailable" });
  });

  it("degrades when the model throws", async () => {
    const sb = stubs();
    const ai = {
      run: vi.fn(async () => {
        throw new Error("model exploded");
      }),
    } as unknown as WorkersAi;
    const res = await summarize(sb, { ...env, AI: ai });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ lines: [], reason: "model_error" });
  });

  it("404s a conversation in another workspace", async () => {
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    const res = await summarize(sb, { ...env, AI: mockAi(CITED).ai });
    expect(res.status).toBe(404);
  });
});
