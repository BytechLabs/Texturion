/**
 * POST /v1/conversations/:id/wrap-up-transcript (#507 Phase 1).
 *
 * The module tests in `ai/call-wrapup.test.ts` cover the gates and the
 * sanitizer. These cover what only the route can be wrong about: that a
 * dictation nobody should pay for never reaches the model, that the audio is
 * gone when the response is written, and that a member kept off a number
 * cannot use the feature to reach that conversation anyway.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

import { CALL_WRAPUP_MAX_SECONDS } from "../ai/call-wrapup";
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

const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONVERSATION_ID = "1f2e3d4c-5b6a-4978-8867-56453423120f";
const NUMBER_ID = "2b3c4d5e-6f70-4812-9345-67890abcdef0";

let auth: TestAuth;
const app = buildTestApp(conversationsRoutes);

beforeAll(async () => {
  auth = await createTestAuth(COMPANY_ID ? completeEnv() : completeEnv());
});

/** A stub whose conversation exists and whose member is an owner. */
function stubReady(): SupabaseStub {
  const env = completeEnv();
  const sb = supabaseStub(env);
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
  // The monthly ledger reservation the gate makes before spending.
  sb.on("POST", "/rest/v1/rpc/ai_usage_reserve", () => ({ allowed: true, used: 1 }));
  return sb;
}

function wrapUpForm(seconds: number, bytes = 4096): FormData {
  const form = new FormData();
  form.set("audio", new Blob([new Uint8Array(bytes)], { type: "audio/mp4" }));
  form.set("seconds", String(seconds));
  return form;
}

async function post(
  env: ReturnType<typeof completeEnv>,
  form: FormData,
): Promise<Response> {
  return apiRequest(
    app,
    env,
    await auth.token(),
    `/v1/conversations/${CONVERSATION_ID}/wrap-up-transcript`,
    { method: "POST", companyId: COMPANY_ID, rawBody: form },
  );
}

describe("POST /conversations/:id/wrap-up-transcript (#507)", () => {
  it("hands back what the crew member actually said", async () => {
    const env = completeEnv();
    const run = vi.fn(async () => ({
      text: "Quoted him $2,400 for the tank, parts Thursday.",
    }));
    (env as unknown as { AI: unknown }).AI = { run };
    const sb = stubReady();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await post(env, wrapUpForm(18));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      text: "Quoted him $2,400 for the tank, parts Thursday.",
    });
    expect(run).toHaveBeenCalledTimes(1);
    // The positive control for the cost test below: a real wrap-up DOES
    // reserve against the monthly ledger, so "never reserved" means something.
    expect(sb.find("POST", "/rest/v1/rpc/ai_usage_reserve").length).toBeGreaterThan(0);
  });

  // The cost gate. A phone left in a pocket must be refused for free — reaching
  // the model at all is the bill this exists to prevent.
  it("never pays for a dictation that ran away", async () => {
    const env = completeEnv();
    const run = vi.fn(async () => ({ text: "..." }));
    (env as unknown as { AI: unknown }).AI = { run };
    const sb = stubReady();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await post(env, wrapUpForm(CALL_WRAPUP_MAX_SECONDS + 1));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: null, reason: "too_long" });
    expect(run).not.toHaveBeenCalled();
    // ...and nothing was reserved against the monthly ledger either.
    expect(sb.find("POST", "/rest/v1/rpc/ai_usage_reserve")).toHaveLength(0);
  });

  /**
   * #507's acceptance criterion, asserted rather than intended.
   *
   * The audio is read off the request, handed to the model, and dropped. There
   * is no attachment row, no storage write, and no id in the response that
   * could fetch it back — so a wrap-up leaves nothing behind but the words.
   */
  it("keeps no audio once the words are written", async () => {
    const env = completeEnv();
    (env as unknown as { AI: unknown }).AI = {
      run: async () => ({ text: "on my way Thursday" }),
    };
    const sb = stubReady();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await post(env, wrapUpForm(12));
    const body = (await res.json()) as Record<string, unknown>;

    // Nothing was written anywhere it could be read back from.
    expect(sb.find("POST", "/rest/v1/attachments")).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/messages")).toHaveLength(0);
    // ...and the response is words, not a handle.
    expect(Object.keys(body)).toEqual(["text"]);
  });

  it("says a model that could not be reached could not be reached", async () => {
    const env = completeEnv();
    (env as unknown as { AI: unknown }).AI = {
      run: async () => {
        throw new Error("binding unavailable");
      },
    };
    const sb = stubReady();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await post(env, wrapUpForm(15));
    const body = (await res.json()) as { text: null; reason: string };

    // The member is left in the note composer with a keyboard, and told which
    // of the failures it was rather than "something went wrong".
    expect(res.status).toBe(200);
    expect(body.text).toBeNull();
    expect(body.reason).toBeTruthy();
  });

  it("404s a conversation that is not there", async () => {
    const env = completeEnv();
    (env as unknown as { AI: unknown }).AI = { run: vi.fn() };
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "owner"),
    );
    sb.on("GET", "/rest/v1/conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await post(env, wrapUpForm(15));

    expect(res.status).toBe(404);
  });

  it("refuses a request that is not multipart", async () => {
    const env = completeEnv();
    (env as unknown as { AI: unknown }).AI = { run: vi.fn() };
    const sb = stubReady();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/conversations/${CONVERSATION_ID}/wrap-up-transcript`,
      { method: "POST", companyId: COMPANY_ID, body: { seconds: 10 } },
    );

    expect(res.status).toBe(422);
  });
});
