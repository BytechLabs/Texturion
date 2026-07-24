/**
 * POST /v1/conversations/:id/reply-suggestions — the cost + safety envelope
 * around the pure core in messaging/reply-suggestions.ts.
 *
 * Asserts what protects the customer and the bill: the toggle gate never
 * reaches the model, an answered thread with an empty composer spends nothing,
 * the monthly cap-and-drop skips the call, INTERNAL NOTES NEVER ENTER THE
 * PROMPT, business hours only appear when the company set them, a half-typed
 * draft is carried through, and every failure degrades to an empty list rather
 * than an error.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Env, WorkersAi } from "../env";
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

/** A Workers AI double whose next `run` result the test controls. */
function mockAi(result: unknown): {
  ai: WorkersAi;
  run: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(async () => result);
  return { ai: { run }, run };
}

/** A model that returns two clean drafts. */
const TWO_REPLIES = {
  response: '{"replies":["We can come by Thursday.","What time suits you?"]}',
};

interface StubOptions {
  /** Settings row; null = the row is absent (defaults apply). */
  settings?: { suggest_replies: boolean } | null;
  /** Thread rows, NEWEST FIRST (the route reverses them). */
  messages?: { direction: string; body: string | null }[];
  reserve?: { count: number; over_cap: boolean; should_alert: boolean };
  businessHours?: Record<string, { open: string; close: string }> | null;
}

function stubs(options: StubOptions = {}): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "GET",
    "/rest/v1/company_members",
    membershipResponder(MEMBER_ID, "member"),
  );
  // #106: no access rules → every member unrestricted.
  sb.on("GET", "/rest/v1/number_access", () => []);
  sb.on("GET", "/rest/v1/conversations", () => [
    {
      id: CONV_ID,
      company_id: COMPANY_ID,
      contact_id: CONTACT_ID,
      phone_number_id: "eeeeeeee-1111-4222-8333-444444444444",
      status: "open",
      is_spam: false,
      assigned_user_id: null,
      pinned_at: null,
      pinned_by_user_id: null,
      last_message_at: "2026-07-01T10:00:00+00:00",
      closed_at: null,
      created_at: "2026-06-30T10:00:00+00:00",
      updated_at: "2026-07-01T10:00:00+00:00",
    },
  ]);
  sb.on("GET", "/rest/v1/company_ai_settings", () =>
    options.settings === undefined || options.settings === null
      ? []
      : [
          {
            enrich_task_address: true,
            enrich_task_due: true,
            suggest_replies: options.settings.suggest_replies,
          },
        ],
  );
  sb.on("GET", "/rest/v1/messages", () =>
    options.messages ?? [{ direction: "inbound", body: "How much for a drain?" }],
  );
  sb.on("GET", "/rest/v1/companies", () => [
    {
      name: "Bolt Plumbing",
      timezone: "America/Toronto",
      business_hours: options.businessHours ?? {},
    },
  ]);
  sb.on("GET", "/rest/v1/contacts", () => [
    { first_name: "Dana", last_name: "Reyes" },
  ]);
  sb.on("POST", "/rest/v1/rpc/ai_usage_reserve", () =>
    options.reserve ?? { count: 1, over_cap: false, should_alert: false },
  );
  return sb;
}

async function suggest(
  sb: SupabaseStub,
  runtime: Env,
  body: unknown = {},
): Promise<Response> {
  stubFetch(jwksRoute(auth), sb.route);
  return apiRequest(
    app,
    runtime,
    await auth.token(),
    `/v1/conversations/${CONV_ID}/reply-suggestions`,
    { method: "POST", body, companyId: COMPANY_ID },
  );
}

describe("POST /v1/conversations/:id/reply-suggestions", () => {
  it("returns drafts for an unanswered customer message", async () => {
    const { ai, run } = mockAi(TWO_REPLIES);
    const res = await suggest(stubs(), { ...env, AI: ai });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      suggestions: ["We can come by Thursday.", "What time suits you?"],
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("toggle OFF returns nothing and never reaches the model or the cap", async () => {
    const { ai, run } = mockAi(TWO_REPLIES);
    const sb = stubs({ settings: { suggest_replies: false } });
    const res = await suggest(sb, { ...env, AI: ai });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      suggestions: [],
      suggestions_disabled: true,
      reason: "disabled",
    });
    expect(run).not.toHaveBeenCalled();
    expect(sb.find("POST", "/rest/v1/rpc/ai_usage_reserve")).toHaveLength(0);
  });

  it("spends nothing when the crew already replied and nothing is typed", async () => {
    const { ai, run } = mockAi(TWO_REPLIES);
    const sb = stubs({
      messages: [
        { direction: "outbound", body: "On our way" },
        { direction: "inbound", body: "How much?" },
      ],
    });
    const res = await suggest(sb, { ...env, AI: ai });

    expect(await res.json()).toEqual({
      suggestions: [],
      reason: "nothing_to_reply",
    });
    expect(run).not.toHaveBeenCalled();
    expect(sb.find("POST", "/rest/v1/rpc/ai_usage_reserve")).toHaveLength(0);
  });

  it("still drafts on an answered thread once the person starts typing", async () => {
    const { ai, run } = mockAi({ response: '{"replies":["We can also bring the part."]}' });
    const sb = stubs({
      messages: [
        { direction: "outbound", body: "On our way" },
        { direction: "inbound", body: "How much?" },
      ],
    });
    const res = await suggest(sb, { ...env, AI: ai }, { draft: "We can also" });

    expect(await res.json()).toEqual({
      suggestions: ["We can also bring the part."],
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("over the monthly cap, it stops calling the model", async () => {
    const { ai, run } = mockAi(TWO_REPLIES);
    const sb = stubs({
      reserve: { count: 1501, over_cap: true, should_alert: false },
    });
    const res = await suggest(sb, { ...env, AI: ai });

    expect(await res.json()).toEqual({ suggestions: [], reason: "over_cap" });
    expect(run).not.toHaveBeenCalled();
  });

  it("an unreachable usage ledger fails CLOSED (no spend, no error)", async () => {
    const { ai, run } = mockAi(TWO_REPLIES);
    const sb = supabaseStub(env);
    sb.on(
      "GET",
      "/rest/v1/company_members",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("GET", "/rest/v1/number_access", () => []);
    sb.on("GET", "/rest/v1/conversations", () => [
      {
        id: CONV_ID,
        company_id: COMPANY_ID,
        contact_id: CONTACT_ID,
        phone_number_id: "eeeeeeee-1111-4222-8333-444444444444",
        status: "open",
        is_spam: false,
        assigned_user_id: null,
        pinned_at: null,
        pinned_by_user_id: null,
        last_message_at: "2026-07-01T10:00:00+00:00",
        closed_at: null,
        created_at: "2026-06-30T10:00:00+00:00",
        updated_at: "2026-07-01T10:00:00+00:00",
      },
    ]);
    sb.on("GET", "/rest/v1/company_ai_settings", () => []);
    sb.on("GET", "/rest/v1/messages", () => [
      { direction: "inbound", body: "How much for a drain?" },
    ]);
    sb.on(
      "POST",
      "/rest/v1/rpc/ai_usage_reserve",
      () => new Response("boom", { status: 500 }),
    );

    const res = await suggest(sb, { ...env, AI: ai });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: [], reason: "over_cap" });
    expect(run).not.toHaveBeenCalled();
  });

  it("NEVER sends internal notes to the model", async () => {
    const { ai, run } = mockAi(TWO_REPLIES);
    const sb = stubs();
    await suggest(sb, { ...env, AI: ai });

    // The query itself must exclude notes — a note is where a crew writes
    // things the customer must never read, even paraphrased.
    const query = sb.find("GET", "/rest/v1/messages")[0].url.searchParams.get(
      "direction",
    );
    expect(query).toBe("in.(inbound,outbound)");
    const prompt = JSON.stringify(run.mock.calls[0][1]);
    expect(prompt).not.toContain("note");
  });

  it("states business hours only when the company has set them", async () => {
    const withoutHours = mockAi(TWO_REPLIES);
    await suggest(stubs(), { ...env, AI: withoutHours.ai });
    const bare = JSON.stringify(withoutHours.run.mock.calls[0][1]);
    expect(bare).not.toContain("Business hours");

    const withHours = mockAi(TWO_REPLIES);
    await suggest(
      stubs({
        businessHours: {
          mon: { open: "08:00", close: "17:00" },
          tue: { open: "08:00", close: "17:00" },
        },
      }),
      { ...env, AI: withHours.ai },
    );
    const stated = JSON.stringify(withHours.run.mock.calls[0][1]);
    expect(stated).toContain("Business hours: Mon 08:00-17:00");
    expect(stated).toContain("Right now the business is");
  });

  it("drops a draft that invents a link or a price", async () => {
    const { ai } = mockAi({
      response:
        '{"replies":["Book at https://example.com/book","That runs $450.","We can come by Thursday."]}',
    });
    const res = await suggest(stubs(), { ...env, AI: ai });
    expect(await res.json()).toEqual({
      suggestions: ["We can come by Thursday."],
    });
  });

  it("degrades to nothing when the model errors or returns nonsense", async () => {
    const failing: WorkersAi = {
      run: vi.fn(async () => {
        throw new Error("model unavailable");
      }),
    };
    expect(await (await suggest(stubs(), { ...env, AI: failing })).json()).toEqual(
      { suggestions: [], reason: "model_error" },
    );

    // Prose with no usable draft: reported as unusable, NOT as "no ideas" —
    // the distinction is what tells us the model is reachable at all.
    const { ai } = mockAi({ response: "Sorry:" });
    expect(await (await suggest(stubs(), { ...env, AI: ai })).json()).toEqual({
      suggestions: [],
      reason: "unusable_output",
    });
  });

  it("offers nothing when there is no AI binding at all", async () => {
    const sb = stubs();
    const res = await suggest(sb, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: [], reason: "unavailable" });
    expect(sb.find("POST", "/rest/v1/rpc/ai_usage_reserve")).toHaveLength(0);
  });

  it("rejects an unknown conversation before spending anything", async () => {
    const { ai, run } = mockAi(TWO_REPLIES);
    const sb = supabaseStub(env);
    sb.on(
      "GET",
      "/rest/v1/company_members",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("GET", "/rest/v1/conversations", () => []);
    const res = await suggest(sb, { ...env, AI: ai });

    expect(res.status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a body that is not the documented shape", async () => {
    const res = await suggest(stubs(), env, { draft: 42 });
    expect(res.status).toBe(422);
  });
});
