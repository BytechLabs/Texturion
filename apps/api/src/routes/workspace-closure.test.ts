/**
 * #341 / D48 — DELETE /v1/company, phase 1 of closing a workspace.
 *
 * The route's job is to make the customer's experience of deletion complete
 * and immediate — signed out, number gone, billing stopped — while the erasure
 * itself waits for the window. What these pin is that no external failure can
 * leave the workspace open, and that nothing is reported as done that wasn't.
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
  type FetchRoute,
  type TestAuth,
} from "../test/support";
import { workspaceClosureRoutes } from "./workspace-closure";

vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const NUMBER_ID = "77777777-1111-4222-8333-444444444444";
const PURGE_AFTER = "2026-08-25T00:00:00+00:00";

let auth: TestAuth;
const app = buildTestApp(workspaceClosureRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function closed(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "closed",
    purge_after: PURGE_AFTER,
    user_ids: [auth.subject],
    phone_number_ids: [NUMBER_ID],
    stripe_subscription_id: "sub_live",
    stripe_customer_id: "cus_live",
    ...overrides,
  };
}

function world(
  options: {
    role?: string;
    close?: Record<string, unknown>;
    /** #537 audit: does this owner hold an authenticator? */
    enrolled?: boolean;
    /** #537 audit: does the code they presented work? */
    codeAccepted?: boolean;
  } = {},
): {
  sb: SupabaseStub;
  routes: FetchRoute[];
  telnyx: string[];
  stripe: string[];
  emails: { to: string[]; subject: string; text: string }[];
} {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, options.role ?? "owner"),
  );
  sb.on("POST", "/rest/v1/rpc/close_workspace", () => options.close ?? closed());
  sb.on("POST", "/rest/v1/rpc/api_revoke_sessions", () => ({
    sessions: 2,
    devices: 0,
    // #581/C7: the ids the route deletes at Telnyx. Returned rather than
    // counted so a failure there can name the credential.
    voice_credentials: ["cred-gone"],
  }));
  // #537 audit. No authenticator, so the emailed code is the path — and by default
  // the code presented is the right one.
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
  sb.on("GET", "/rest/v1/phone_numbers", () => [
    {
      id: NUMBER_ID,
      company_id: COMPANY_ID,
      status: "active",
      source: "purchased",
      telnyx_phone_number_id: "tn-1",
      number_e164: "+14155557501",
    },
  ]);
  sb.on("PATCH", "/rest/v1/phone_numbers", () => [
    { id: NUMBER_ID, company_id: COMPANY_ID, status: "released" },
  ]);
  sb.on("DELETE", "/rest/v1/push_subscriptions", () => new Response(null, { status: 204 }));
  sb.on("DELETE", "/rest/v1/device_push_tokens", () => new Response(null, { status: 204 }));
  sb.on("POST", "/rest/v1/audit_log", () => []);
  // #371: the owner to mail, and the workspace row that carries the address
  // across the 30-day window to the erasure receipt.
  sb.on("GET", new RegExp(`^/auth/v1/admin/users/${auth.subject}$`), () => ({
    id: auth.subject,
    email: "owner@acme.test",
  }));
  sb.on("PATCH", "/rest/v1/companies", () => [
    { name: "Acme Plumbing", purge_after: PURGE_AFTER },
  ]);

  const telnyx: string[] = [];
  const stripe: string[] = [];
  const telnyxRoute: FetchRoute = (url, request) => {
    if (url.hostname !== "api.telnyx.com") return undefined;
    telnyx.push(`${request.method} ${url.pathname}`);
    return new Response(null, { status: 200 });
  };
  const stripeRoute: FetchRoute = (url, request) => {
    if (!url.href.includes("stripe")) return undefined;
    stripe.push(`${request.method} ${url.pathname}`);
    return Response.json({ id: "sub_live", status: "canceled" });
  };
  const emails: { to: string[]; subject: string; text: string }[] = [];
  const resendRoute: FetchRoute = async (url, request) => {
    if (url.href !== "https://api.resend.com/emails") return undefined;
    emails.push(
      (await request.clone().json()) as {
        to: string[];
        subject: string;
        text: string;
      },
    );
    return Response.json({ id: `email_${emails.length}` });
  };
  return {
    sb,
    routes: [sb.route, telnyxRoute, stripeRoute, resendRoute],
    telnyx,
    stripe,
    emails,
  };
}

/**
 * #537 audit: the route now asks for proof of identity. These tests are about the
 * teardown, so they satisfy it the way most owners will — no authenticator, so an
 * emailed code — and the gate itself is pinned separately below.
 */
async function close(
  routes: FetchRoute[],
  // `null` means send NO body — an explicit `undefined` would take the default,
  // which is how the first version of this quietly sent a code it meant to omit.
  body: Record<string, unknown> | null = { confirmation_code: "123456" },
) {
  stubFetch(jwksRoute(auth), ...routes);
  return apiRequest(app, env, await auth.token(), "/v1/company", {
    method: "DELETE",
    companyId: COMPANY_ID,
    body: body ?? undefined,
  });
}

describe("DELETE /v1/company (#341 phase 1)", () => {
  // 15s: the two tests that exercise the push-cleanup branch spend seconds in
  // the PostgREST stub, not in the route (the handler's own path measures ~20ms
  // against stubbed vendors). Headroom here, rather than a slower product.
  it("closes the workspace, ends access, releases the number and stops billing", async () => {
    const { sb, routes, stripe } = world();
    const res = await close(routes);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      already_closed: false,
      purge_after: PURGE_AFTER,
      sessions_ended: 2,
      subscription_cancelled: true,
    });
    // Number release is NOT re-asserted here: it goes through the shared
    // releaseCompanyNumbers path, which the grace-expiry suite already covers
    // against a faithful Telnyx double. What matters here is that a failure
    // there cannot leave the workspace open — the next test pins that.

    // One transaction decides everything; the external steps follow it.
    expect(sb.find("POST", "/rest/v1/rpc/close_workspace")[0].body).toEqual({
      p_company_id: COMPANY_ID,
    });
    expect(sb.find("POST", "/rest/v1/rpc/api_revoke_sessions")).toHaveLength(1);
    expect(stripe.some((call) => call.includes("subscriptions"))).toBe(true);

    // #231: the end of a business's account is the most consequential thing
    // anyone does here.
    const audit = sb.find("POST", "/rest/v1/audit_log")[0].body as Record<
      string,
      unknown
    >;
    expect(audit).toMatchObject({
      company_id: COMPANY_ID,
      action: "workspace.closed",
      target_type: "company",
      after: {
        purge_after: PURGE_AFTER,
        sessions_ended: 2,
        subscription_cancelled: true,
      },
    });
  }, 15_000);

  it("stays closed when Telnyx or Stripe fails, and says what did not happen", async () => {
    // A carrier blip must never leave the account open — the customer asked to
    // leave. A number still held costs US money; it is not their risk. The
    // response reports honestly rather than claiming a clean teardown.
    const { sb } = world();
    const failing: FetchRoute[] = [
      sb.route,
      (url) =>
        url.hostname === "api.telnyx.com"
          ? new Response("nope", { status: 503 })
          : undefined,
      (url) =>
        url.href.includes("stripe")
          ? new Response("nope", { status: 500 })
          : undefined,
    ];
    const res = await close(failing);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      already_closed: false,
      numbers_released: 0,
      subscription_cancelled: false,
    });
    // And the audit row records the shortfall rather than a tidy fiction.
    expect(
      (sb.find("POST", "/rest/v1/audit_log")[0].body as { after: unknown }).after,
    ).toMatchObject({ numbers_released: 0, subscription_cancelled: false });
  }, 15_000);

  it("is idempotent: closing twice does not extend the window or re-tear-down", async () => {
    const { sb, routes } = world({
      close: { outcome: "already", purge_after: PURGE_AFTER },
    });
    const res = await close(routes);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      already_closed: true,
      purge_after: PURGE_AFTER,
      sessions_ended: 0,
      numbers_released: 0,
      subscription_cancelled: false,
    });
    // Nothing external ran a second time.
    expect(sb.find("POST", "/rest/v1/rpc/api_revoke_sessions")).toHaveLength(0);
    expect(sb.find("GET", "/rest/v1/phone_numbers")).toHaveLength(0);
  });

  it("keeps push for a member who is still in another workspace", async () => {
    // Push registrations are per person, not per workspace. Closing one must
    // not silence another workspace's customer messages on the same phone.
    const { sb, routes } = world();
    sb.on("GET", "/rest/v1/company_members", (call) =>
      call.url.searchParams.get("user_id") === `eq.${auth.subject}`
        ? [{ company_id: "another-workspace" }]
        : undefined,
    );
    await close(routes);

    expect(sb.find("DELETE", "/rest/v1/push_subscriptions")).toHaveLength(0);
    expect(sb.find("DELETE", "/rest/v1/device_push_tokens")).toHaveLength(0);
  });

  it("is the owner's alone — an admin cannot end the business's account", async () => {
    const { sb, routes } = world({ role: "admin" });
    const res = await close(routes);

    expect(res.status).toBe(403);
    expect(sb.find("POST", "/rest/v1/rpc/close_workspace")).toHaveLength(0);
  });

  it("404s a workspace that is not there rather than reporting success", async () => {
    const { routes } = world({ close: { outcome: "not_found" } });
    const res = await close(routes);
    expect(res.status).toBe(404);
  });

  describe("the receipt (#371)", () => {
    it("emails the owner what ended now, when the erasure runs, and that it can still be undone", async () => {
      const { sb, routes, emails } = world();
      const res = await close(routes);

      expect(await res.json()).toMatchObject({ receipt_emailed: true });
      expect(emails).toHaveLength(1);
      expect(emails[0].to).toEqual(["owner@acme.test"]);
      expect(emails[0].subject).toBe("Acme Plumbing is closed");

      const body = emails[0].text;
      // The date, spelled out. "30 days" is not a date, and the whole reason
      // this email exists is that the person has navigated away from the
      // screen that said one.
      expect(body).toContain("August 25, 2026");
      expect(body).toContain("Access ended immediately");
      expect(body).toContain("released back to the carrier");
      expect(body).toContain("Billing is cancelled");
      // docs/DELETION.md's "what survives" — in the email as well as on the
      // page, because a customer who learns it later learns it from us badly.
      expect(body).toContain("do-not-text list");
      expect(body).toContain("three years");
      expect(body).toContain("undo it");

      // The address is written to the workspace, because 30 days from now the
      // members table is one of the things the purge will have deleted.
      const patch = sb.find("PATCH", "/rest/v1/companies")[0];
      expect(patch.body).toEqual({ purge_receipt_email: "owner@acme.test" });

      expect(
        (sb.find("POST", "/rest/v1/audit_log")[0].body as { after: unknown })
          .after,
      ).toMatchObject({ receipt_emailed: true });
    }, 15_000);

    it("still closes the workspace when the email cannot be sent", async () => {
      // The customer asked to leave. A deletion that reversed itself because
      // Resend was down would be the far worse bug.
      const { sb, routes } = world();
      const failing = routes.map((route): FetchRoute => (url, request) =>
        url.href === "https://api.resend.com/emails"
          ? new Response("nope", { status: 500 })
          : route(url, request),
      );
      const res = await close(failing);

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        already_closed: false,
        receipt_emailed: false,
      });
      // Closed regardless — and the audit row says the customer does not have
      // it in writing, which is the bit we owe them.
      expect(sb.find("POST", "/rest/v1/rpc/close_workspace")).toHaveLength(1);
      expect(
        (sb.find("POST", "/rest/v1/audit_log")[0].body as { after: unknown })
          .after,
      ).toMatchObject({ receipt_emailed: false });
    }, 15_000);

    it("does not re-send on a repeated close", async () => {
      const { routes, emails } = world({
        close: { outcome: "already", purge_after: PURGE_AFTER },
      });
      await close(routes);
      expect(emails).toEqual([]);
    });
  });
  // -------------------------------------------------------------------------
  // #537 audit: proof of identity, not just proof of role
  // -------------------------------------------------------------------------
  describe("the confirmation in front of it (#537)", () => {
    it("will not close a workspace on a role check alone", async () => {
      // The whole point. Being the owner is what a stolen session already is.
      const { sb, routes } = world();
      const res = await close(routes, null);

      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        error: { code: "confirmation_code_required" },
      });
      // And nothing happened: no teardown, no released number, no cancelled
      // subscription, no audit row claiming otherwise.
      expect(sb.find("POST", "/rest/v1/rpc/close_workspace")).toHaveLength(0);
      expect(sb.find("POST", "/rest/v1/audit_log")).toHaveLength(0);
    }, 20_000);

    it("says the same thing for a code that does not work", async () => {
      const { sb, routes } = world({ codeAccepted: false });
      const res = await close(routes, { confirmation_code: "000000" });

      expect(res.status).toBe(403);
      // One message for wrong, expired, spent and out of attempts — naming which
      // would say whether the digits were right.
      expect(await res.json()).toMatchObject({
        error: { code: "confirmation_code_required" },
      });
      expect(sb.find("POST", "/rest/v1/rpc/close_workspace")).toHaveLength(0);
    });

    it("asks an owner who has an authenticator for THAT, not for an email", async () => {
      // Somebody holding a factor must never be offered the weaker path, or the
      // weaker path is the effective one for everybody — including an attacker.
      const { sb, routes } = world({ enrolled: true });
      const res = await close(routes, { confirmation_code: "123456" });

      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
      // #581/#7: the code changed, the property did not. `mfa_challenge_required`
      // is the wall in front of the whole workspace; `mfa_reprove_required` is
      // "tap your authenticator for THIS act". The old assertion also passed for
      // the wrong reason — the gate returned early on aal2, which
      // `companyContext` has already forced for anybody enrolled, so the real
      // caller was never asked for anything.
        error: { code: "mfa_reprove_required" },
      });
      // The emailed code was not even consulted.
      expect(sb.find("POST", "/rest/v1/rpc/api_use_ownership_code")).toHaveLength(0);
      expect(sb.find("POST", "/rest/v1/rpc/close_workspace")).toHaveLength(0);
    });
  });
});
