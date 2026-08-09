/**
 * #581 — the cost envelope around POST /v1/conversations/:id/wrap-up-transcript.
 *
 * The rest of the route is covered next door in `wrap-up-transcript.test.ts`
 * (the free gates, the audio that is never stored, the number level). These
 * cover the two ways this path could spend money it should not have:
 *
 *   - IT WAS THE ONE MEMBER-TRIGGERED AI PATH WITH NO BURST GATE. Every sibling
 *     asks a company-keyed limiter and a member-keyed one; this asked neither,
 *     so one member in a loop could spend the crew's whole month of wrap-ups
 *     and the cap alert was the first anyone would hear of it.
 *   - THE MODEL INPUTS WERE BUILT EAGERLY, before any cap was consulted — and
 *     they are the most expensive inputs the product builds (a base64 copy of
 *     up to 8 MB, plus a fallback shape that spreads the same bytes into an
 *     array of eight million numbers). Every refusal was paid for in full.
 *
 * Plus the billing standing the shared gate now checks, through a real route,
 * because "runAiFeature refuses" and "the member is told" are two facts.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Env, RateLimiter } from "../env";
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

/**
 * Which model inputs were BUILT, as opposed to which were sent.
 *
 * Deferring the two inputs is invisible from outside the response — the words
 * come back either way — so the builders are wrapped to record themselves. The
 * real implementations still run, because the transcript that comes out the
 * other end has to stay a real transcript.
 */
const built: string[] = [];

vi.mock("../calls/voicemail-transcript", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../calls/voicemail-transcript")>();
  return {
    ...actual,
    transcriptInput: (audioBase64: string) => {
      built.push("primary");
      return actual.transcriptInput(audioBase64);
    },
    fallbackTranscriptInput: (audio: ArrayBuffer) => {
      built.push("fallback");
      return actual.fallbackTranscriptInput(audio);
    },
  };
});

const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONVERSATION_ID = "1f2e3d4c-5b6a-4978-8867-56453423120f";
const NUMBER_ID = "2b3c4d5e-6f70-4812-9345-67890abcdef0";

let auth: TestAuth;
const app = buildTestApp(conversationsRoutes);

beforeAll(async () => {
  auth = await createTestAuth(completeEnv());
});

/** A burst limiter that always answers the same way, and remembers its keys. */
function fakeLimiter(
  success: boolean,
): RateLimiter & { limit: ReturnType<typeof vi.fn> } {
  return { limit: vi.fn(async () => ({ success })) };
}

interface StubOptions {
  /** `companies.subscription_status`. */
  subscription?: string;
  reserve?: { count: number; over_cap: boolean; should_alert: boolean };
}

/** A stub whose conversation exists, whose member is an owner, and which pays. */
function stubReady(options: StubOptions = {}): SupabaseStub {
  const sb = supabaseStub(completeEnv());
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, "owner"),
  );
  sb.on("GET", "/rest/v1/conversations", () => [
    {
      id: CONVERSATION_ID,
      company_id: COMPANY_ID,
      contact_id: null,
      phone_number_id: NUMBER_ID,
      status: "open",
      is_spam: false,
    },
  ]);
  // #581: the billing standing the shared AI gate reads before it reserves.
  sb.on("GET", "/rest/v1/companies", () => [
    { subscription_status: options.subscription ?? "active" },
  ]);
  sb.on("GET", "/rest/v1/company_ai_settings", () => []);
  sb.on("POST", "/rest/v1/rpc/ai_usage_reserve", () =>
    options.reserve ?? { count: 1, over_cap: false, should_alert: false },
  );
  return sb;
}

/** An AI binding that writes down one sentence. */
function mockAi(): { ai: unknown; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async () => ({
    text: "Quoted him $2,400 for the tank, parts Thursday.",
  }));
  return { ai: { run }, run };
}

function wrapUpForm(seconds: number, bytes = 4096): FormData {
  const form = new FormData();
  form.set("audio", new Blob([new Uint8Array(bytes)], { type: "audio/mp4" }));
  form.set("seconds", String(seconds));
  return form;
}

async function dictate(sb: SupabaseStub, runtime: Env): Promise<Response> {
  stubFetch(jwksRoute(auth), sb.route);
  return apiRequest(
    app,
    runtime,
    await auth.token(),
    `/v1/conversations/${CONVERSATION_ID}/wrap-up-transcript`,
    { method: "POST", companyId: COMPANY_ID, rawBody: wrapUpForm(18) },
  );
}

describe("the wrap-up burst gates (#581)", () => {
  /**
   * Both limiters are optional bindings — absent in local dev and in every
   * other test in the repo — so an absent one is indistinguishable from an
   * absent GATE unless a test supplies one. The two refusals below and the
   * "asked both" control are what make deleting either line fail.
   */
  it("refuses on the COMPANY burst before the model or the ledger", async () => {
    const sb = stubReady();
    const limiter = fakeLimiter(false);
    const { ai, run } = mockAi();

    const res = await dictate(sb, {
      ...completeEnv(),
      AI: ai,
      AI_REPLY_RATE_LIMITER: limiter,
    } as unknown as Env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: null, reason: "rate_limited" });
    expect(limiter.limit).toHaveBeenCalledWith({ key: COMPANY_ID });
    expect(run).not.toHaveBeenCalled();
    expect(sb.find("POST", "/rest/v1/rpc/ai_usage_reserve")).toHaveLength(0);
  });

  it("refuses on the MEMBER burst, keyed per member and not per workspace", async () => {
    // The key is the whole point of the second limiter: keyed on the company it
    // would be the first one again, and one runaway client could still spend
    // everyone else's month from inside the company allowance.
    const sb = stubReady();
    const company = fakeLimiter(true);
    const member = fakeLimiter(false);
    const { ai, run } = mockAi();

    const res = await dictate(sb, {
      ...completeEnv(),
      AI: ai,
      AI_REPLY_RATE_LIMITER: company,
      AI_MEMBER_RATE_LIMITER: member,
    } as unknown as Env);

    expect((await res.json()) as unknown).toEqual({
      text: null,
      reason: "rate_limited",
    });
    expect(member.limit).toHaveBeenCalledWith({
      key: `${COMPANY_ID}:${auth.subject}`,
    });
    expect(run).not.toHaveBeenCalled();
    expect(sb.find("POST", "/rest/v1/rpc/ai_usage_reserve")).toHaveLength(0);
  });

  it("writes the words down when both allow, having asked both", async () => {
    // The other half of proving a guard: a limiter that says yes must not cost
    // the member their dictation, and both have to have been consulted — a
    // route that asks neither passes the two refusals above by never reaching
    // them.
    const sb = stubReady();
    const company = fakeLimiter(true);
    const member = fakeLimiter(true);
    const { ai, run } = mockAi();

    const res = await dictate(sb, {
      ...completeEnv(),
      AI: ai,
      AI_REPLY_RATE_LIMITER: company,
      AI_MEMBER_RATE_LIMITER: member,
    } as unknown as Env);

    expect(await res.json()).toEqual({
      text: "Quoted him $2,400 for the tank, parts Thursday.",
    });
    expect(company.limit).toHaveBeenCalledTimes(1);
    expect(member.limit).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("what a refused dictation costs to refuse (#581)", () => {
  it("encodes nothing for a dictation the monthly cap refuses", async () => {
    // The cap is the refusal that PROVES this and the burst is not: a burst
    // returns from the route before the inputs are named at all, so it stays
    // green however they are built. This test refused on a burst first and
    // passed against the eager version — a decorative guard, caught only by
    // reverting the fix. The cap lives INSIDE the shared gate, past the point a
    // caller hands its inputs over, so nothing but deferring them keeps them
    // unbuilt here.
    built.length = 0;
    const sb = stubReady({
      reserve: { count: 1501, over_cap: true, should_alert: false },
    });
    const { ai, run } = mockAi();

    const res = await dictate(sb, {
      ...completeEnv(),
      AI: ai,
      AI_REPLY_RATE_LIMITER: fakeLimiter(true),
      AI_MEMBER_RATE_LIMITER: fakeLimiter(true),
    } as unknown as Env);

    expect(await res.json()).toEqual({ text: null, reason: "over_cap" });
    expect(run).not.toHaveBeenCalled();
    expect(built).toEqual([]);
  });

  it("encodes nothing for a workspace the billing gate refuses", async () => {
    // The same ordering, one gate earlier: #581's own refusal must not be paid
    // for in an 8 MB base64 copy before it is made.
    built.length = 0;
    const sb = stubReady({ subscription: "canceled" });
    const { ai } = mockAi();

    await dictate(sb, {
      ...completeEnv(),
      AI: ai,
      AI_REPLY_RATE_LIMITER: fakeLimiter(true),
      AI_MEMBER_RATE_LIMITER: fakeLimiter(true),
    } as unknown as Env);

    expect(built).toEqual([]);
  });

  it("does not build the fallback shape for a dictation the first model answers", async () => {
    // The expensive one of the two — eight million array elements — and the
    // common case is that it is never needed at all.
    built.length = 0;
    const sb = stubReady();
    const { ai } = mockAi();

    const res = await dictate(sb, {
      ...completeEnv(),
      AI: ai,
      AI_REPLY_RATE_LIMITER: fakeLimiter(true),
      AI_MEMBER_RATE_LIMITER: fakeLimiter(true),
    } as unknown as Env);

    expect(res.status).toBe(200);
    expect(built).toEqual(["primary"]);
  });
});

describe("a workspace that has stopped paying (#581)", () => {
  it("stops dictating, and says it is about billing", async () => {
    const sb = stubReady({ subscription: "canceled" });
    const { ai, run } = mockAi();

    const res = await dictate(sb, {
      ...completeEnv(),
      AI: ai,
    } as unknown as Env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      text: null,
      reason: "subscription_inactive",
    });
    expect(run).not.toHaveBeenCalled();
    // Not against the ledger either: a cancelled workspace's month should not
    // be walked down by requests that were never going to be answered.
    expect(sb.find("POST", "/rest/v1/rpc/ai_usage_reserve")).toHaveLength(0);
  });

  it("keeps dictating while a payment is merely late", async () => {
    // The product judgement, through the route this time. A card that failed on
    // Friday is not a cancellation, and Lou going quiet mid-conversation for a
    // customer who is about to pay us is worse than the tenth of a cent.
    const sb = stubReady({ subscription: "past_due" });
    const { ai, run } = mockAi();

    const res = await dictate(sb, {
      ...completeEnv(),
      AI: ai,
    } as unknown as Env);

    expect(await res.json()).toEqual({
      text: "Quoted him $2,400 for the tank, parts Thursday.",
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
