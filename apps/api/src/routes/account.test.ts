/**
 * #346 — DELETE /v1/account and its preview.
 *
 * The teardown itself is asserted in SQL (supabase/tests/delete_account.test.sql).
 * What these pin is the route's part: that it is about the caller and nobody
 * else, that an owner is refused with copy naming their workspaces, that every
 * membership is offboarded on the way out, and that the auth identity is
 * severed rather than left signable.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  supabaseStub,
  type SupabaseStub,
} from "../test/routes-harness";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type FetchRoute,
  type TestAuth,
} from "../test/support";
import { accountRoutes } from "./account";

vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ROW = "eeeeeeee-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(accountRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function world(
  options: {
    preview?: Record<string, unknown>;
    deleteResult?: Record<string, unknown>;
    /** #371: what the auth identity's address is when the receipt is built. */
    email?: string;
    /** #496: whether this user holds a verified second factor. */
    enrolled?: boolean;
  } = {},
): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/account_deletion_preview", () =>
    options.preview ?? {
      blocked_by: null,
      memberships: 1,
      conversations: 2,
      tasks: 3,
    },
  );
  sb.on("GET", "/rest/v1/company_members", () => [
    { id: MEMBER_ROW, company_id: COMPANY_ID },
  ]);
  // #496: the step-up check. Not enrolled by default — the overwhelming
  // majority of accounts — so every existing vector still exercises the path
  // it was written for.
  sb.on("POST", "/rest/v1/rpc/user_has_verified_mfa", () => options.enrolled ?? false);
  sb.on("POST", "/rest/v1/rpc/offboard_member", () => ({
    outcome: "deactivated",
    user_id: auth.subject,
    conversations: 2,
    tasks: 3,
  }));
  sb.on("POST", "/rest/v1/audit_log", () => []);
  sb.on("POST", "/rest/v1/rpc/delete_account", () =>
    options.deleteResult ?? { outcome: "deleted", personal_rows: 7 },
  );
  // #371: the address the receipt goes to — and the one severAuthIdentity
  // replaces a moment later.
  sb.on("GET", /^\/auth\/v1\/admin\/users\//, () => ({
    id: auth.subject,
    email: options.email ?? "leaver@crew.test",
  }));
  sb.on("PUT", /^\/auth\/v1\/admin\/users\//, () => ({ id: auth.subject }));
  return sb;
}

/**
 * The Resend leg, and the ordering evidence with it. Each send records how
 * many sever calls had already gone out when it left — the receipt is useless
 * if it is sent to an address that has already been replaced with
 * `@account.invalid`, and "before" is not something a call-count assertion can
 * express after the fact.
 */
function mailbox(sb: SupabaseStub, options: { fails?: boolean } = {}) {
  const sent: { to: string[]; subject: string; text: string; severedBefore: number }[] =
    [];
  const route: FetchRoute = async (url, request) => {
    if (url.href !== "https://api.resend.com/emails") return undefined;
    const body = (await request.clone().json()) as {
      to: string[];
      subject: string;
      text: string;
    };
    sent.push({
      ...body,
      severedBefore: sb.find("PUT", /^\/auth\/v1\/admin\/users\//).length,
    });
    return options.fails
      ? new Response(JSON.stringify({ message: "boom" }), { status: 500 })
      : Response.json({ id: "email_1" });
  };
  return { route, sent };
}

describe("GET /v1/account/deletion-preview", () => {
  it("says what deleting would touch", async () => {
    const sb = world();
    stubFetch(jwksRoute(auth), sb.route, mailbox(sb).route);

    // Company-exempt: this is about the person, and someone with no membership
    // at all must still be able to leave.
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/account/deletion-preview",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      blocked_by: null,
      owned_workspaces: [],
      memberships: 1,
      open_conversations: 2,
      open_tasks: 3,
    });
    expect(
      sb.find("POST", "/rest/v1/rpc/account_deletion_preview")[0].body,
    ).toEqual({ p_user_id: auth.subject });
  });

  it("names the workspaces an owner has to deal with first", async () => {
    const sb = world({
      preview: {
        blocked_by: "owner",
        owned: [{ id: COMPANY_ID, name: "Brightside Plumbing" }],
      },
    });
    stubFetch(jwksRoute(auth), sb.route, mailbox(sb).route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/account/deletion-preview",
    );
    expect(await res.json()).toMatchObject({
      blocked_by: "owner",
      owned_workspaces: [{ name: "Brightside Plumbing" }],
    });
  });
});

describe("DELETE /v1/account", () => {
  // #496 — "Audit all auth endpoints, destructive actions, etc."
  //
  // This is the one company-EXEMPT route that is both irreversible and not an
  // exit from an MFA state, so the company middleware's gate never sees it and
  // it has to ask for itself.
  it("refuses an enrolled user who has not presented their code", async () => {
    const sb = world({ enrolled: true });
    stubFetch(jwksRoute(auth), sb.route, mailbox(sb).route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/account", {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "mfa_challenge_required", message: expect.any(String) },
    });
    // And nothing happened. A destructive route that refuses AFTER acting is
    // not a gate, and offboarding is not undoable.
    expect(sb.find("POST", "/rest/v1/rpc/offboard_member")).toHaveLength(0);
  });

  it("lets an enrolled user through once they have presented it", async () => {
    const sb = world({ enrolled: true });
    stubFetch(jwksRoute(auth), sb.route, mailbox(sb).route);

    const res = await apiRequest(
      app,
      env,
      await auth.token({ aal: "aal2" }),
      "/v1/account",
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
  });

  it("offboards every workspace, then severs the identity", async () => {
    const sb = world();
    stubFetch(jwksRoute(auth), sb.route, mailbox(sb).route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/account", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deleted: true,
      workspaces_left: 1,
      personal_rows_removed: 7,
      receipt_emailed: true,
    });

    // #276 runs per membership, releasing their open work to the crew — there
    // is nobody to nominate on a leaver's behalf.
    expect(sb.find("POST", "/rest/v1/rpc/offboard_member")[0].body).toEqual({
      p_company_id: COMPANY_ID,
      p_member_id: MEMBER_ROW,
      p_reassign_to: null,
    });
    // #231: the business's record of why one of its people vanished.
    expect(sb.find("POST", "/rest/v1/audit_log")[0].body).toMatchObject({
      company_id: COMPANY_ID,
      action: "member.deactivated",
      after: { reason: "account_deleted" },
    });
    // The auth identity: no address to mail, no credential to present.
    const severed = sb.find("PUT", /^\/auth\/v1\/admin\/users\//)[0].body as {
      email: string;
      ban_duration: string;
    };
    expect(severed.email).toContain("@account.invalid");
    expect(severed.ban_duration).toBeTruthy();
  });

  it("refuses an owner, naming what they have to do", async () => {
    // A generic failure leaves them with no idea what to change — and there is
    // no ownership transfer yet (#332), so the rule has to be stated.
    const sb = world({
      preview: {
        blocked_by: "owner",
        owned: [{ id: COMPANY_ID, name: "Brightside Plumbing" }],
      },
    });
    stubFetch(jwksRoute(auth), sb.route, mailbox(sb).route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/account", {
      method: "DELETE",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Brightside Plumbing");
    // Nothing was touched.
    expect(sb.find("POST", "/rest/v1/rpc/offboard_member")).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/rpc/delete_account")).toHaveLength(0);
  });

  it("still reports success when the auth identity cannot be severed", async () => {
    // The data is already gone by then — telling someone their deletion did
    // not happen when most of it did would be worse. It raises for US instead.
    const sb = world();
    sb.on(
      "PUT",
      /^\/auth\/v1\/admin\/users\//,
      () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
    stubFetch(jwksRoute(auth), sb.route, mailbox(sb).route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/account", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: true });
  });

  it("handles becoming an owner between the preview and the delete", async () => {
    const sb = world({ deleteResult: { outcome: "owner" } });
    stubFetch(jwksRoute(auth), sb.route, mailbox(sb).route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/account", {
      method: "DELETE",
    });
    expect(res.status).toBe(409);
  });

  describe("the receipt (#371)", () => {
    it("emails the address BEFORE the identity holding it is severed", async () => {
      // The ordering is the feature. `severAuthIdentity` parks the address on
      // a non-routable `.invalid` domain, so a receipt sent one line later
      // goes nowhere at all — and it would still look like it worked.
      const sb = world();
      const mail = mailbox(sb);
      stubFetch(jwksRoute(auth), sb.route, mail.route);

      await apiRequest(app, env, await auth.token(), "/v1/account", {
        method: "DELETE",
      });

      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0].to).toEqual(["leaver@crew.test"]);
      expect(mail.sent[0].severedBefore).toBe(0);
      expect(mail.sent[0].subject).toBe("Your Loonext account is deleted");

      const body = mail.sent[0].text;
      expect(body).toContain("no longer sign in");
      // What they handed back, and what stays with the business — the same
      // answer docs/DELETION.md gives, so nobody gets a different one here.
      expect(body).toContain("the crew you were on");
      expect(body).toContain("three years");
    });

    it("deletes the account anyway when the receipt cannot be sent", async () => {
      const sb = world();
      const mail = mailbox(sb, { fails: true });
      stubFetch(jwksRoute(auth), sb.route, mail.route);

      const res = await apiRequest(app, env, await auth.token(), "/v1/account", {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        deleted: true,
        receipt_emailed: false,
      });
      // And the deletion still completed: a mail failure is ours to chase, not
      // a reason to leave someone with a signable account.
      expect(sb.find("POST", "/rest/v1/rpc/delete_account")).toHaveLength(1);
      expect(sb.find("PUT", /^\/auth\/v1\/admin\/users\//)).toHaveLength(1);
    });

    it("sends nothing when there is no address left to send to", async () => {
      // A second delete attempt against an already-severed identity: a no-op,
      // not a bounce at a domain that cannot receive.
      const sb = world({ email: `deleted-${auth.subject}@account.invalid` });
      const mail = mailbox(sb);
      stubFetch(jwksRoute(auth), sb.route, mail.route);

      const res = await apiRequest(app, env, await auth.token(), "/v1/account", {
        method: "DELETE",
      });
      expect(await res.json()).toMatchObject({ receipt_emailed: false });
      expect(mail.sent).toEqual([]);
    });
  });
});
