/**
 * PUT /v1/company/mfa — the workspace-wide two-factor requirement.
 *
 * #537 audit: turning this OFF lowers the whole crew's protection in one silent
 * call, which is the move somebody makes first with a session they stole. So it now
 * asks for proof of identity, the same way handing the business over does.
 *
 * Turning it ON is deliberately NOT gated, and that asymmetry is the point of half
 * these tests: friction belongs on the door that opens, not the one that closes.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
  type SupabaseStub,
} from "../test/routes-harness";
import { completeEnv, createTestAuth, jwksRoute, stubFetch, type TestAuth } from "../test/support";
import { mfaRoutes } from "./mfa";

const env = completeEnv();
const COMPANY_ID = "3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607";
const MEMBER_ID = "1a2b3c4d-5e6f-4708-9a1b-2c3d4e5f6071";

let auth: TestAuth;
const app = buildTestApp(mfaRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

function world(
  options: {
    role?: string;
    /** Is the requirement currently on? `mfa_required_at` is when it went on. */
    alreadyRequired?: boolean;
    /** Does this owner hold an authenticator? */
    enrolled?: boolean;
    /** Does the code they presented work? */
    codeAccepted?: boolean;
    /**
     * What the RPC answers. Passed in rather than overridden afterwards: the stub
     * is FIRST-match-wins, so a second `sb.on` for the same path never runs.
     */
    saved?: { outcome: string; grace_until: string | null };
  } = {},
): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, options.role ?? "owner"),
  );
  sb.on("GET", "/rest/v1/companies", () => [
    {
      mfa_required_at: options.alreadyRequired ? "2026-07-01T00:00:00+00:00" : null,
    },
  ]);
  sb.on(
    "POST",
    "/rest/v1/rpc/user_has_verified_mfa",
    () => options.enrolled ?? false,
  );
  sb.on(
    "POST",
    "/rest/v1/rpc/api_use_ownership_code",
    () => options.codeAccepted ?? true,
  );
  sb.on(
    "POST",
    "/rest/v1/rpc/api_set_company_mfa",
    () => options.saved ?? { outcome: "off", grace_until: null },
  );
  sb.on("POST", "/rest/v1/audit_log", () => []);
  return sb;
}

async function save(sb: SupabaseStub, body: Record<string, unknown>) {
  stubFetch(jwksRoute(auth), sb.route);
  return apiRequest(app, env, await auth.token(), "/v1/company/mfa", {
    method: "PUT",
    companyId: COMPANY_ID,
    body,
  });
}

describe("switching the requirement ON", () => {
  it("asks for nothing — friction belongs on the door that opens", async () => {
    const sb = world({
      alreadyRequired: false,
      saved: { outcome: "on", grace_until: "2026-08-22T00:00:00+00:00" },
    });

    const res = await save(sb, { required: true, grace_days: 14 });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      required: true,
      grace_until: "2026-08-22T00:00:00+00:00",
    });
    // No proof asked for, and none consulted.
    expect(sb.find("POST", "/rest/v1/rpc/user_has_verified_mfa")).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/rpc/api_use_ownership_code")).toHaveLength(0);
  });

  it("does not ask when it is already on and being re-saved", async () => {
    // Re-saving `required: true` is not a relaxation, whatever the grace says.
    const sb = world({
      alreadyRequired: true,
      saved: { outcome: "on", grace_until: "2026-07-15T00:00:00+00:00" },
    });

    expect((await save(sb, { required: true })).status).toBe(200);
    expect(sb.find("POST", "/rest/v1/rpc/user_has_verified_mfa")).toHaveLength(0);
  });
});

describe("switching the requirement OFF (#537 audit)", () => {
  it("will not do it on a role check alone", async () => {
    const sb = world({ alreadyRequired: true });
    const res = await save(sb, { required: false });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: { code: "confirmation_code_required" },
    });
    // Nothing changed, and no audit row says it did.
    expect(sb.find("POST", "/rest/v1/rpc/api_set_company_mfa")).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/audit_log")).toHaveLength(0);
  });

  it("goes through with the emailed code", async () => {
    const sb = world({ alreadyRequired: true });
    const res = await save(sb, { required: false, confirmation_code: "123456" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ required: false });
    // The code was scoped to this action and no other.
    expect(
      sb.find("POST", "/rest/v1/rpc/api_use_ownership_code")[0].body,
    ).toMatchObject({ p_action: "relax_mfa", p_code: "123456" });
    expect(sb.find("POST", "/rest/v1/rpc/api_set_company_mfa")).toHaveLength(1);
  });

  it("says one thing for a code that does not work", async () => {
    const sb = world({ alreadyRequired: true, codeAccepted: false });
    const res = await save(sb, { required: false, confirmation_code: "000000" });

    expect(res.status).toBe(403);
    expect(sb.find("POST", "/rest/v1/rpc/api_set_company_mfa")).toHaveLength(0);
  });

  it("asks an owner who has an authenticator for THAT, not for an email", async () => {
    // Somebody holding a factor must never be offered the weaker path, or the
    // weaker path is the effective one for everybody — including an attacker.
    const sb = world({ alreadyRequired: true, enrolled: true });
    const res = await save(sb, { required: false, confirmation_code: "123456" });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: { code: "mfa_challenge_required" },
    });
    expect(sb.find("POST", "/rest/v1/rpc/api_use_ownership_code")).toHaveLength(0);
  });

  it("asks for nothing when it was already off", async () => {
    // Saving "off" over "off" takes nothing away. Demanding a code for it would
    // send somebody to their inbox to authorise a change that is not happening.
    const sb = world({ alreadyRequired: false });
    const res = await save(sb, { required: false });

    expect(res.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/rpc/user_has_verified_mfa")).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/rpc/api_set_company_mfa")).toHaveLength(1);
  });
});

describe("who may switch it at all", () => {
  it("is owner-only", async () => {
    const sb = world({ role: "admin", alreadyRequired: true });
    const res = await save(sb, { required: false, confirmation_code: "123456" });

    expect(res.status).toBe(403);
    // Refused for the role, before the confirmation is ever considered — an admin
    // must not learn from this route whether the owner holds a factor.
    expect(sb.find("POST", "/rest/v1/rpc/user_has_verified_mfa")).toHaveLength(0);
  });
});
