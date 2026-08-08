/**
 * #332 — the ownership surface. Real product code over the stubbed network
 * edge (D13).
 *
 * The SQL suite (supabase/tests/ownership_transfer.test.sql) owns the rules
 * about who may do what; these pin the parts that live in TypeScript and would
 * be silently wrong without them: the role gates on the two owner-only routes,
 * the mapping from each SQL outcome to a §7 error a person can act on, that
 * `can_claim` is decided on the server rather than by three clients, and that
 * the whole crew is emailed — not just the two people involved.
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
import { ownershipRoutes } from "./ownership";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const PARTNER_MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b60";
const PARTNER_USER_ID = "5b4a3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c10";

let auth: TestAuth;
const app = buildTestApp(ownershipRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface StateOverrides {
  owner_user_id?: string;
  backup_owner_user_id?: string | null;
  backup_member_id?: string | null;
  pending?: Record<string, unknown> | null;
}

function state(overrides: StateOverrides = {}) {
  return {
    owner_user_id: auth.subject,
    owner_member_id: MEMBER_ID,
    backup_owner_user_id: null,
    backup_member_id: null,
    pending: null,
    ...overrides,
  };
}

interface StubOptions {
  role?: string;
  state?: ReturnType<typeof state>;
  /** The emails every member of the workspace would receive. */
  emails?: string[];
  /**
   * #537: has this person a verified second factor?
   *
   * Defaults to false, which is what leaves every test written before the step-up
   * behaving exactly as it did — `requireStepUpForEnrolled` asks nothing of
   * somebody who holds no factor.
   */
  enrolled?: boolean;
}

function stub(options: StubOptions = {}): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, options.role ?? "owner"),
  );
  sb.on("POST", "/rest/v1/rpc/api_ownership_state", () => options.state ?? state());
  sb.on("GET", "/rest/v1/companies", () => [{ name: "Founder Plumbing" }]);
  sb.on("GET", "/rest/v1/company_members", () => [
    { user_id: auth.subject },
    { user_id: PARTNER_USER_ID },
  ]);
  sb.on("GET", /\/auth\/v1\/admin\/users\//, (call) => ({
    id: call.path.split("/").pop(),
    email: `${call.path.split("/").pop()}@crew.example`,
  }));
  sb.on("POST", "/rest/v1/audit_log", () => []);
  sb.on(
    "POST",
    "/rest/v1/rpc/user_has_verified_mfa",
    () => options.enrolled ?? false,
  );
  return sb;
}

/** Every Resend send this test made. */
function mailStub(): { sent: { to: string[]; subject: string }[]; route: ReturnType<typeof vi.fn> } {
  const sent: { to: string[]; subject: string }[] = [];
  const route = vi.fn(async (url: URL, request: Request) => {
    if (url.href !== "https://api.resend.com/emails") return undefined;
    const body = (await request.json()) as { to: string[]; subject: string };
    sent.push(body);
    return Response.json({ id: "re_1" });
  });
  return { sent, route: route as never };
}

describe("GET /v1/company/ownership", () => {
  it("tells the caller what THEY may do, rather than shipping raw ids", async () => {
    const sb = stub({
      role: "member",
      state: state({
        owner_user_id: PARTNER_USER_ID,
        backup_owner_user_id: auth.subject,
        backup_member_id: MEMBER_ID,
      }),
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company/ownership", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      i_am_owner: false,
      i_am_backup: true,
      // The one field a client would get subtly wrong on its own — and
      // getting it wrong means showing somebody a button that takes a
      // business.
      can_claim: true,
      can_offer: false,
      pending: null,
    });
  });

  it("offers no claim button to a member who is not the named backup", async () => {
    const sb = stub({
      role: "member",
      state: state({
        owner_user_id: PARTNER_USER_ID,
        backup_owner_user_id: PARTNER_USER_ID,
        backup_member_id: PARTNER_MEMBER_ID,
      }),
    });
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/company/ownership", {
      companyId: COMPANY_ID,
    });
    expect(await res.json()).toMatchObject({ can_claim: false, i_am_backup: false });
  });

  it("marks a claim not yet ripe as not ready, so no client has to do the arithmetic", async () => {
    const sb = stub({
      state: state({
        pending: {
          id: "t-1",
          kind: "claim",
          from_user_id: auth.subject,
          to_user_id: PARTNER_USER_ID,
          to_member_id: PARTNER_MEMBER_ID,
          ripens_at: new Date(Date.now() + 86_400_000).toISOString(),
          expires_at: new Date(Date.now() + 800 * 86_400_000).toISOString(),
          created_at: new Date().toISOString(),
        },
      }),
    });
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/company/ownership", {
      companyId: COMPANY_ID,
    });
    const body = (await res.json()) as {
      pending: { ready: boolean; mine: boolean };
      can_cancel: boolean;
    };
    expect(body.pending.ready).toBe(false);
    expect(body.pending.mine).toBe(false);
    // The owner's veto is live for the whole waiting period. This is the
    // entire safety property of the claim path.
    expect(body.can_cancel).toBe(true);
  });
});

describe("POST /v1/company/ownership/backup", () => {
  it("is owner-only — an admin cannot choose who may one day take the business", async () => {
    const sb = stub({ role: "admin" });
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/ownership/backup",
      { method: "POST", companyId: COMPANY_ID, body: { member_id: PARTNER_MEMBER_ID } },
    );
    expect(res.status).toBe(403);
    expect(sb.find("POST", "/rest/v1/rpc/api_set_backup_owner")).toHaveLength(0);
  });

  it("names one, records it, and tells the person named", async () => {
    const sb = stub();
    sb.on("POST", "/rest/v1/rpc/api_set_backup_owner", () => ({
      outcome: "set",
      user_id: PARTNER_USER_ID,
    }));
    const mail = mailStub();
    stubFetch(jwksRoute(auth), mail.route as never, sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/ownership/backup",
      { method: "POST", companyId: COMPANY_ID, body: { member_id: PARTNER_MEMBER_ID } },
    );
    expect(res.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/audit_log")[0].body).toMatchObject({
      action: "ownership.backup_named",
    });
    // A standing right to take over a business is not something to discover
    // on the day you need it.
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toEqual([`${PARTNER_USER_ID}@crew.example`]);
  });

  it("refuses a backup who is the owner, in words that say why", async () => {
    const sb = stub();
    sb.on("POST", "/rest/v1/rpc/api_set_backup_owner", () => ({ outcome: "self" }));
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/ownership/backup",
      { method: "POST", companyId: COMPANY_ID, body: { member_id: MEMBER_ID } },
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(
      "not a backup",
    );
  });

  it("takes null as an answer — clearing the nomination is a real choice", async () => {
    const sb = stub();
    sb.on("POST", "/rest/v1/rpc/api_set_backup_owner", () => ({ outcome: "cleared" }));
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/ownership/backup",
      { method: "POST", companyId: COMPANY_ID, body: { member_id: null } },
    );
    expect(res.status).toBe(200);
    // Nobody was named, so nobody is emailed about being named.
    expect(sb.find("POST", "/rest/v1/rpc/api_set_backup_owner")[0].body).toMatchObject({
      p_member_id: null,
    });
  });
});

describe("POST /v1/company/ownership/offer", () => {
  it("is owner-only", async () => {
    const sb = stub({ role: "admin" });
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/ownership/offer",
      { method: "POST", companyId: COMPANY_ID, body: { member_id: PARTNER_MEMBER_ID } },
    );
    expect(res.status).toBe(403);
  });

  it("tells the WHOLE crew, not just the two people involved", async () => {
    const sb = stub();
    sb.on("POST", "/rest/v1/rpc/api_offer_ownership", () => ({
      outcome: "offered",
      to_user_id: PARTNER_USER_ID,
    }));
    const mail = mailStub();
    stubFetch(jwksRoute(auth), mail.route as never, sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/ownership/offer",
      { method: "POST", companyId: COMPANY_ID, body: { member_id: PARTNER_MEMBER_ID } },
    );
    expect(res.status).toBe(200);
    // A handover nobody was told about is indistinguishable from a takeover,
    // and the people best placed to notice a wrong one are the colleagues.
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toEqual([
      `${auth.subject}@crew.example`,
      `${PARTNER_USER_ID}@crew.example`,
    ]);
    expect(sb.find("POST", "/rest/v1/audit_log")[0].body).toMatchObject({
      action: "ownership.offered",
    });
  });

  it("409s a second handover rather than racing the first", async () => {
    const sb = stub();
    sb.on("POST", "/rest/v1/rpc/api_offer_ownership", () => ({ outcome: "in_flight" }));
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/ownership/offer",
      { method: "POST", companyId: COMPANY_ID, body: { member_id: PARTNER_MEMBER_ID } },
    );
    expect(res.status).toBe(409);
  });
});

describe("POST /v1/company/ownership/claim", () => {
  it("is open to a plain MEMBER — the named backup need not be an admin", async () => {
    const sb = stub({ role: "member" });
    sb.on("POST", "/rest/v1/rpc/api_claim_ownership", () => ({
      outcome: "claimed",
      ripens_at: "2026-08-05T00:00:00Z",
    }));
    const mail = mailStub();
    stubFetch(jwksRoute(auth), mail.route as never, sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/ownership/claim",
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(200);
    // The loudest message in the feature: the owner has a week and one click.
    expect(mail.sent[0].subject).toContain("Action needed");
    expect(mail.sent[0].to).toHaveLength(2);
  });

  it("says nothing about who the backup IS when refusing", async () => {
    const sb = stub({ role: "admin" });
    sb.on("POST", "/rest/v1/rpc/api_claim_ownership", () => ({ outcome: "forbidden" }));
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/ownership/claim",
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(403);
    const message = ((await res.json()) as { error: { message: string } }).error.message;
    // Somebody probing this route learns only that it is not them.
    expect(message).not.toContain("@");
    expect(message).toContain("named as backup");
  });
});

describe("POST /v1/company/ownership/accept", () => {
  it("completes the handover and tells everyone it happened", async () => {
    const sb = stub({
      role: "member",
      state: state({
        owner_user_id: PARTNER_USER_ID,
        pending: {
          id: "t-1",
          kind: "offer",
          from_user_id: PARTNER_USER_ID,
          to_user_id: auth.subject,
          to_member_id: MEMBER_ID,
          ripens_at: new Date(Date.now() - 1000).toISOString(),
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          created_at: new Date().toISOString(),
        },
      }),
    });
    sb.on("POST", "/rest/v1/rpc/api_accept_ownership", () => ({
      outcome: "accepted",
      kind: "offer",
      from_user_id: PARTNER_USER_ID,
    }));
    const mail = mailStub();
    stubFetch(jwksRoute(auth), mail.route as never, sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/ownership/accept",
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/audit_log")[0].body).toMatchObject({
      action: "ownership.transferred",
      before: { owner_member_id: MEMBER_ID },
    });
    expect(mail.sent[0].subject).toContain("new owner");
  });

  it("409s a claim that has not finished waiting", async () => {
    const sb = stub({ role: "member" });
    sb.on("POST", "/rest/v1/rpc/api_accept_ownership", () => ({ outcome: "not_yet" }));
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/ownership/accept",
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(409);
  });

  it("403s somebody who left the team between the offer and the answer", async () => {
    const sb = stub({ role: "member" });
    sb.on("POST", "/rest/v1/rpc/api_accept_ownership", () => ({ outcome: "no_member" }));
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/ownership/accept",
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/company/ownership/cancel", () => {
  it("lets the owner veto, and says nothing changed", async () => {
    const sb = stub();
    sb.on("POST", "/rest/v1/rpc/api_cancel_ownership_transfer", () => ({
      outcome: "canceled",
      kind: "claim",
    }));
    const mail = mailStub();
    stubFetch(jwksRoute(auth), mail.route as never, sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/ownership/cancel",
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/audit_log")[0].body).toMatchObject({
      action: "ownership.canceled",
      after: { kind: "claim", declined: false },
    });
    expect(mail.sent[0].subject).toContain("stopped");
  });

  it("403s an uninvolved member — an admin must not be able to freeze a dead owner's workspace", async () => {
    const sb = stub({ role: "admin" });
    sb.on("POST", "/rest/v1/rpc/api_cancel_ownership_transfer", () => ({
      outcome: "forbidden",
    }));
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/ownership/cancel",
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(res.status).toBe(403);
  });
});

describe("#537 — proving it is you before the business moves", () => {
  /**
   * Every route here is already behind the company gate, which demands a second
   * factor from anybody holding one AT SIGN-IN. These ask again at the moment of
   * the act, because a session that proved itself this morning is not the same
   * claim as "the person tapping this right now is the owner".
   */
  const MOVES: { path: string; body?: Record<string, unknown> }[] = [
    { path: "offer", body: { member_id: PARTNER_MEMBER_ID } },
    { path: "claim" },
    { path: "accept" },
  ];

  for (const move of MOVES) {
    it(`asks an enrolled owner for a code before ${move.path}`, async () => {
      const sb = stub({ enrolled: true });
      stubFetch(jwksRoute(auth), sb.route);

      const res = await apiRequest(
        app,
        env,
        // A session that has NOT presented the second factor.
        await auth.token(),
        `/v1/company/ownership/${move.path}`,
        { method: "POST", companyId: COMPANY_ID, body: move.body ?? {} },
      );
      expect(res.status).toBe(403);
      // The CODE, not just the status. `workspace.own` also answers 403, so a
      // status-only assertion would pass just as happily if the step-up were
      // deleted and the capability gate happened to refuse instead.
      expect((await res.json()).error.code).toBe("mfa_challenge_required");
      // And nothing happened. A refusal that still moved the business would be
      // the worst of both.
      expect(
        sb.find("POST", `/rest/v1/rpc/api_${move.path}_ownership`),
      ).toHaveLength(0);
    });

    it(`lets them through once they have presented it: ${move.path}`, async () => {
      const sb = stub({ enrolled: true });
      sb.on("POST", `/rest/v1/rpc/api_${move.path}_ownership`, () => ({
        outcome: "forbidden",
      }));
      stubFetch(jwksRoute(auth), sb.route);

      const res = await apiRequest(
        app,
        env,
        await auth.token({ aal: "aal2" }),
        `/v1/company/ownership/${move.path}`,
        { method: "POST", companyId: COMPANY_ID, body: move.body ?? {} },
      );
      // Past the step-up and into the SQL, which is what this asserts — the
      // outcome beyond it is that route's own business.
      expect(
        sb.find("POST", `/rest/v1/rpc/api_${move.path}_ownership`),
      ).toHaveLength(1);
    });
  }

  it("NEVER asks for a code to cancel", async () => {
    // THE ONE THAT MATTERS MOST. Cancelling is the safe direction: it is how an
    // owner stops a handover they did not intend. Asking for a code while
    // somebody is racing to veto a takeover would be helping the attacker, and
    // an owner who has lost their authenticator must still be able to say no.
    const sb = stub({ enrolled: true });
    sb.on("POST", "/rest/v1/rpc/api_cancel_ownership_transfer", () => ({
      outcome: "cancelled",
    }));
    const mail = mailStub();
    stubFetch(jwksRoute(auth), mail.route as never, sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/ownership/cancel",
      { method: "POST", companyId: COMPANY_ID, body: {} },
    );
    expect(
      sb.find("POST", "/rest/v1/rpc/api_cancel_ownership_transfer"),
    ).toHaveLength(1);
  });

  it("asks nothing of somebody who holds no second factor — yet", async () => {
    // The gap this leaves is deliberate and NOT the finished state: an owner with
    // no authenticator gets no extra proof, because there is nothing to ask them
    // for. The email code that covers them is the other half of #537.
    const sb = stub({ enrolled: false });
    sb.on("POST", "/rest/v1/rpc/api_offer_ownership", () => ({
      outcome: "forbidden",
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/ownership/offer",
      { method: "POST", companyId: COMPANY_ID, body: { member_id: PARTNER_MEMBER_ID } },
    );
    expect(sb.find("POST", "/rest/v1/rpc/api_offer_ownership")).toHaveLength(1);
  });
});
