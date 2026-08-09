/**
 * #545 — minting recovery codes needs the second factor; burning one does not.
 *
 * The bypass this pins shut, in two requests and no guessing:
 *
 *   1. Sign in with a stolen password. GoTrue issues an **aal1** token on a
 *      password login and leaves demanding the second factor to us.
 *   2. `POST /v1/mfa/recovery-codes` — the route is company-exempt by design
 *      (#314: somebody being told to enrol must be able to reach the thing that
 *      fixes it), so `companyContext` returns before BOTH of its aal gates. Ten
 *      plaintext codes come back.
 *   3. `POST /v1/mfa/recover` with one of them deletes every verified factor
 *      through the service-role admin API, which bypasses GoTrue's own aal2
 *      requirement for unenrolment.
 *
 * The control whose entire purpose is surviving a stolen password was defeated by
 * a stolen password — and the victim's real printout was silently voided on the
 * way through, because issuing a set invalidates the previous one.
 *
 * ## Why gating the mint cannot lock anyone out
 *
 * That is the asymmetry these tests exist to hold. The handler refuses unless a
 * VERIFIED factor already exists, so anybody entitled to mint can by definition
 * satisfy aal2. Somebody who has genuinely lost their authenticator uses a code
 * they already hold — `recover`, which stays open at aal1 and must.
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
const MEMBER_ID = "1a2b3c4d-5e6f-4708-9a1b-2c3d4e5f6071";

let auth: TestAuth;
const app = buildTestApp(mfaRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

/**
 * @param enrolled Does this account hold a verified authenticator? Drives both
 *   `user_has_verified_mfa` (what the step-up gate reads) and the GoTrue factor
 *   list (what the handler reads), because in reality they cannot disagree.
 */
function world(options: { enrolled: boolean }): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, "owner"),
  );
  sb.on("POST", "/rest/v1/rpc/user_has_verified_mfa", () => options.enrolled);
  sb.on("POST", "/rest/v1/rpc/api_mfa_set_recovery_codes", () => null);
  sb.on("POST", "/rest/v1/audit_log", () => []);
  // GoTrue's admin factor list — same stub, different path family. Registered
  // here rather than as a separate fetch route because the Supabase stub
  // intercepts every Supabase request and refuses anything it does not know.
  sb.on(
    "GET",
    /^\/auth\/v1\/admin\/users\/[^/]+\/factors$/,
    // The bare ARRAY, not `{ factors: [...] }`: supabase-js wraps the HTTP body
    // itself and returns `{ data: { factors: body } }`. Double-wrapping made
    // `data.factors` an object, so `.some` was not a function and the route 500'd
    // instead of answering — a stub shaped wrongly reads exactly like a bug.
    () =>
      options.enrolled
        ? [{ id: "f-1", status: "verified", factor_type: "totp" }]
        : [],
  );
  return sb;
}

async function mint(sb: SupabaseStub, aal: "aal1" | "aal2") {
  stubFetch(jwksRoute(auth), sb.route);
  // No companyId: the route is company-exempt, which is exactly the path the
  // bypass took.
  return apiRequest(app, env, await auth.token({ aal }), "/v1/mfa/recovery-codes", {
    method: "POST",
  });
}

describe("#545 a password-only session cannot mint recovery codes", () => {
  it("refuses at aal1 and asks for the code instead", async () => {
    const sb = world({ enrolled: true });

    const res = await mint(sb, "aal1");

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: { code: "mfa_challenge_required" },
    });
    // The load-bearing assertion: nothing was minted. A 401 that still wrote
    // hashes would have replaced the victim's real printout on the way past.
    expect(
      sb.find("POST", "/rest/v1/rpc/api_mfa_set_recovery_codes"),
    ).toHaveLength(0);
  });

  it("says what the code is FOR, not that an account is being deleted", async () => {
    // The shared step-up helper defaults its sentence to "deleting your account".
    // #537 added its second caller and learned this the hard way; a third caller
    // reusing the default would tell an owner protecting their codes that they
    // were closing their account.
    const sb = world({ enrolled: true });

    const body = (await (await mint(sb, "aal1")).json()) as {
      error: { message: string };
    };

    expect(body.error.message).toContain("issuing new recovery codes");
    expect(body.error.message).not.toContain("deleting your account");
  });

  it("mints for a session that has proved the second factor", async () => {
    const sb = world({ enrolled: true });

    const res = await mint(sb, "aal2");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { codes: string[] };
    expect(body.codes).toHaveLength(10);
    expect(sb.find("POST", "/rest/v1/rpc/api_mfa_set_recovery_codes")).toHaveLength(1);
  });

  it("still refuses an account with no factor, and does not ask for a code", async () => {
    // Ordering matters and this is what pins it: the step-up gate returns null
    // when there is no factor to step up WITH, so the handler's own "enrol
    // first" conflict is what answers — not a challenge the caller cannot meet.
    // Reversed, this route would be a dead end for the very person #314 made it
    // company-exempt for.
    const sb = world({ enrolled: false });

    const res = await mint(sb, "aal1");

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "conflict" } });
    expect(
      sb.find("POST", "/rest/v1/rpc/api_mfa_set_recovery_codes"),
    ).toHaveLength(0);
  });
});
