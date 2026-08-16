/**
 * #287 — the authenticated quote routes.
 *
 * The cases worth having are the ones where a plausible implementation is
 * wrong: an outstanding queue that trusts the stored status and hands back a
 * quote that expired last week, and a create that trusts a foreign key to
 * enforce tenancy when the constraint knows nothing about companies.
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
import { quotesRoutes } from "./quotes";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONVERSATION_ID = "11111111-2222-4333-8444-555555555555";
const CONTACT_ID = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const QUOTE_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

const DAY = 24 * 60 * 60 * 1000;
/** Computed from now, never a literal: a fixed future date becomes a past one. */
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

let auth: TestAuth;
const app = buildTestApp(quotesRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWithRole(role: string | null): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, role),
  );
  return sb;
}

const row = (over: Record<string, unknown> = {}) => ({
  id: QUOTE_ID,
  conversation_id: CONVERSATION_ID,
  contact_id: CONTACT_ID,
  amount_cents: 45_000,
  currency: "cad",
  description: "Replace the water heater",
  status: "sent",
  expires_at: inDays(7),
  sent_at: null,
  viewed_at: null,
  decided_at: null,
  created_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
});

describe("GET /v1/quotes", () => {
  it("carries the effective status beside the stored one", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/quotes", () => [row()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/quotes", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    // Both, deliberately: the stored one is what a transition is checked
    // against, the effective one is what a person is shown.
    expect(body.data[0].status).toBe("sent");
    expect(body.data[0].effective_status).toBe("sent");
    const call = sb.find("GET", "/rest/v1/quotes")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
  });

  it("does not return an expired quote as outstanding, though the row says sent", async () => {
    /*
     * THE CASE THIS FEATURE GETS WRONG. Nothing writes `expired`, so a query
     * filtering the stored column returns a quote that lapsed last week and
     * the owner chases a price the business no longer honours. The filter
     * asks the shared rule instead.
     */
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/quotes", () => [
      row({ id: QUOTE_ID, status: "sent", expires_at: inDays(-1) }),
      row({ id: "cccccccc-dddd-4eee-8fff-000000000000", status: "sent" }),
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/quotes?status=outstanding",
      { companyId: COMPANY_ID },
    );
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).not.toBe(QUOTE_ID);
  });

  it("refuses a status filter it does not know", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/quotes?status=paid",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(422);
  });
});

describe("POST /v1/quotes", () => {
  function stubCreate(sb: SupabaseStub, opts: { conversation?: boolean; contact?: boolean } = {}) {
    sb.on("GET", "/rest/v1/conversations", () =>
      opts.conversation === false ? [] : [{ id: CONVERSATION_ID }],
    );
    sb.on("GET", "/rest/v1/contacts", () =>
      opts.contact === false ? [] : [{ id: CONTACT_ID }],
    );
    sb.on("POST", "/rest/v1/quotes", () => [row({ status: "draft" })]);
  }

  const body = () => ({
    conversation_id: CONVERSATION_ID,
    contact_id: CONTACT_ID,
    amount_cents: 45_000,
    currency: "cad",
    description: "Replace the water heater",
    expires_at: inDays(7),
  });

  it("creates a DRAFT, never a sent quote", async () => {
    // Sending is its own act. The moment an offer becomes an offer is a fact
    // worth recording separately from the moment somebody typed it.
    const sb = stubWithRole("member");
    stubCreate(sb);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/quotes", {
      companyId: COMPANY_ID,
      method: "POST",
      body: body(),
    });
    expect(res.status).toBe(201);
    const written = sb.find("POST", "/rest/v1/quotes")[0];
    expect((written.body as { status: string }).status).toBe("draft");
    expect((written.body as { company_id: string }).company_id).toBe(COMPANY_ID);
  });

  it("refuses a conversation belonging to another workspace", async () => {
    /*
     * The foreign key would ACCEPT this. `conversation_id` references
     * conversations, and that constraint knows nothing about tenancy — a row
     * pointing at another company's thread satisfies it perfectly. #347: the
     * API scopes every query and the database is not a second opinion.
     */
    const sb = stubWithRole("member");
    stubCreate(sb, { conversation: false });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/quotes", {
      companyId: COMPANY_ID,
      method: "POST",
      body: body(),
    });
    expect(res.status).toBe(404);
    expect(sb.find("POST", "/rest/v1/quotes")).toHaveLength(0);
  });

  it("refuses a contact belonging to another workspace", async () => {
    const sb = stubWithRole("member");
    stubCreate(sb, { contact: false });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/quotes", {
      companyId: COMPANY_ID,
      method: "POST",
      body: body(),
    });
    expect(res.status).toBe(404);
    expect(sb.find("POST", "/rest/v1/quotes")).toHaveLength(0);
  });

  it("refuses an expiry already in the past", async () => {
    // Dead on arrival. Storing it would leave a row every reader has to
    // explain.
    const sb = stubWithRole("member");
    stubCreate(sb);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/quotes", {
      companyId: COMPANY_ID,
      method: "POST",
      body: { ...body(), expires_at: inDays(-1) },
    });
    expect(res.status).toBe(422);
    expect(sb.find("POST", "/rest/v1/quotes")).toHaveLength(0);
  });

  it("refuses a zero or negative amount", async () => {
    const sb = stubWithRole("member");
    stubCreate(sb);
    stubFetch(jwksRoute(auth), sb.route);

    for (const amount_cents of [0, -100]) {
      const res = await apiRequest(app, env, await auth.token(), "/v1/quotes", {
        companyId: COMPANY_ID,
        method: "POST",
        body: { ...body(), amount_cents },
      });
      expect(res.status, `${amount_cents}`).toBe(422);
    }
  });

  it("needs send authority, not just read", async () => {
    // Naming a price is speaking for the business, which is the same
    // authority as sending a text.
    const sb = stubWithRole("bookkeeper");
    stubCreate(sb);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/quotes", {
      companyId: COMPANY_ID,
      method: "POST",
      body: body(),
    });
    expect(res.status).toBe(403);
    expect(sb.find("POST", "/rest/v1/quotes")).toHaveLength(0);
  });
});
