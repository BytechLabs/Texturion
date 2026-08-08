/**
 * #288 — the referral MOMENT, over the stubbed network edge (D13).
 *
 * The point of these tests is not that the endpoint returns JSON. It is that the
 * one thing #288 forbids — asking an owner to vouch for a product that has not
 * worked for them — cannot happen through this route, whatever the facts table
 * says, and that the capability gate on it is the one the reward can be paid to.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { REFERRAL_REWARDS_PER_YEAR } from "@loonext/shared";

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
import { referralRoutes } from "./referrals";

const env = completeEnv();
const COMPANY_ID = "9b2c4d6e-8f0a-4b3c-9d5e-7f9a1b3c5d7e";
const MEMBER_ID = "1e0d9c8b-7a6f-4e5d-8c3b-2a1f0e9d8c7b";

let auth: TestAuth;
const app = buildTestApp(referralRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const DAY = 24 * 60 * 60 * 1000;

function ago(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString();
}

/** A workspace that has earned the ask, so each test can break one thing. */
function facts(overrides: Record<string, unknown> = {}) {
  return {
    activated: true,
    activated_at: ago(60),
    replied_customers: 31,
    dismissed_at: null,
    rewards_this_year: 0,
    ...overrides,
  };
}

function stub(
  factsRow: Record<string, unknown> | null,
  role = "owner",
): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, role),
  );
  sb.on("POST", "/rest/v1/rpc/api_referral_ask_facts", () => factsRow);
  return sb;
}

async function moment(sb: SupabaseStub) {
  stubFetch(jwksRoute(auth), sb.route);
  const res = await apiRequest(app, env, await auth.token(), "/v1/moment", {
    companyId: COMPANY_ID,
  });
  return { res, body: (await res.json()) as Record<string, unknown> };
}

describe("GET /v1/referrals/moment", () => {
  it("asks a workspace the product has been working for", async () => {
    const { res, body } = await moment(stub(facts()));
    expect(res.status).toBe(200);
    expect(body).toEqual({ ask: true, customers: 31 });
  });

  it("passes the clock to the SQL rather than letting it read now()", async () => {
    const sb = stub(facts());
    await moment(sb);
    const call = sb.find("POST", "/rest/v1/rpc/api_referral_ask_facts")[0];
    expect(call.body).toMatchObject({ p_company_id: COMPANY_ID });
    expect(typeof (call.body as { p_now: string }).p_now).toBe("string");
  });

  it("never asks a workspace that has not activated", async () => {
    // The acceptance criterion of #288, asserted at the edge as well as in the
    // shared decision: "the ask appears after demonstrated value, never at
    // signup".
    const { body } = await moment(
      stub(facts({ activated: false, activated_at: null })),
    );
    expect(body).toEqual({ ask: false, refusal: "not_activated" });
  });

  it("does not ask a crew that has barely used it", async () => {
    const { body } = await moment(stub(facts({ replied_customers: 3 })));
    expect(body).toEqual({ ask: false, refusal: "too_quiet" });
  });

  it("counts a bigint that arrived as a string", async () => {
    // PostgREST returns count(*) as a string. Compared with < against a number
    // this would coerce and happen to work; compared the other way round it
    // would not, and a threshold that silently always passes is the kind of bug
    // that ships. Both sides asserted.
    expect((await moment(stub(facts({ replied_customers: "31" })))).body).toEqual({
      ask: true,
      customers: 31,
    });
    expect((await moment(stub(facts({ replied_customers: "3" })))).body).toEqual({
      ask: false,
      refusal: "too_quiet",
    });
  });

  it("stops asking a referrer who can no longer be paid", async () => {
    const { body } = await moment(
      stub(facts({ rewards_this_year: REFERRAL_REWARDS_PER_YEAR })),
    );
    expect(body).toEqual({ ask: false, refusal: "capped" });
  });

  it("takes 'Not now' as an answer", async () => {
    const { body } = await moment(stub(facts({ dismissed_at: ago(2) })));
    expect(body).toEqual({ ask: false, refusal: "dismissed" });
  });

  it("does not ask a workspace that is no longer there", async () => {
    // The RPC returns null for a deleted or unknown company. Reading that as a
    // healthy row of zeroes would be the worst kind of wrong: zero customers is
    // also what "too quiet" looks like.
    const { res, body } = await moment(stub(null));
    expect(res.status).toBe(200);
    expect(body).toEqual({ ask: false, refusal: "not_activated" });
  });

  it("is closed to a member who could never collect the reward", async () => {
    // The whole router is behind billing.manage. A tech being offered a month
    // off an invoice they cannot see is an offer we have no way to keep.
    const { res } = await moment(stub(facts(), "member"));
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/referrals/dismiss", () => {
  it("stamps the company and answers 204", async () => {
    const sb = stub(facts());
    sb.on("PATCH", "/rest/v1/companies", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/dismiss", {
      companyId: COMPANY_ID,
      method: "POST",
    });
    expect(res.status).toBe(204);

    const patch = sb.find("PATCH", "/rest/v1/companies")[0];
    expect(
      (patch.body as { referral_prompt_dismissed_at: string })
        .referral_prompt_dismissed_at,
    ).toEqual(expect.any(String));
    // Scoped to the caller's workspace, never a bare update.
    expect(patch.url.searchParams.get("id")).toBe(`eq.${COMPANY_ID}`);
  });

  it("needs no body, because a prompt being put away has nothing to say", async () => {
    const sb = stub(facts());
    sb.on("PATCH", "/rest/v1/companies", () => []);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/dismiss", {
      companyId: COMPANY_ID,
      method: "POST",
    });
    expect(res.status).toBe(204);
  });

  it("is closed to a member", async () => {
    const sb = stub(facts(), "member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/dismiss", {
      companyId: COMPANY_ID,
      method: "POST",
    });
    expect(res.status).toBe(403);
  });
});
