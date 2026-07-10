/**
 * GET /v1/for-you (D23, HOME-AND-VIEWS.md) — the crew member's focus queue.
 * The route is a thin, correctly-scoped wrapper over the api_for_you RPC (the
 * urgency sort + section derivation live in SQL, exercised by the DB suite).
 * These stub the RPC (the PostGREST network edge) and assert:
 *   - the four sections pass through unchanged;
 *   - the RPC is called with the caller's company + user;
 *   - the owner/admin-only triage flag (p_is_lead) is derived from the verified
 *     role — true for owner/admin, false for a plain member (role scoping);
 *   - a member never receives a triage section.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { MemberRole } from "../context";
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
import { forYouRoutes } from "./for-you";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
// The signed-in user (matches createTestAuth's default subject) — used only as
// a stub value inside the RPC payload; the route passes it through unchanged.
const USER_ID = "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01";

let auth: TestAuth;
const app = buildTestApp(forYouRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A representative api_for_you payload for a lead (triage populated). */
const LEAD_PAYLOAD = {
  waiting_on_you: [
    {
      conversation_id: "c1000000-0000-4000-8000-000000000001",
      status: "waiting",
      contact: { id: "d1", name: "Jane", phone_e164: "+16135550100" },
      assigned_user_id: USER_ID,
      last_message_at: "2026-07-02T10:00:00+00:00",
      unread: true,
      has_overdue_task: true,
      urgency: 0,
    },
  ],
  my_tasks: [
    {
      task_id: "a1000000-0000-4000-8000-000000000001",
      title: "Send the quote",
      conversation_id: "c1000000-0000-4000-8000-000000000001",
      message_id: "b1000000-0000-4000-8000-000000000001",
      assigned_user_id: USER_ID,
      due_at: "2026-07-01T09:00:00+00:00",
      overdue: true,
    },
  ],
  unread: [
    {
      conversation_id: "c1000000-0000-4000-8000-000000000002",
      status: "open",
      contact: { id: "d2", name: null, phone_e164: "+16135550200" },
      assigned_user_id: null,
      last_message_at: "2026-07-02T11:00:00+00:00",
    },
  ],
  triage: {
    conversations: [
      {
        conversation_id: "c1000000-0000-4000-8000-000000000003",
        status: "new",
        contact: { id: "d3", name: "Bob", phone_e164: "+16135550300" },
        last_message_at: "2026-07-02T12:00:00+00:00",
        unread: true,
      },
    ],
    tasks: [
      {
        task_id: "a1000000-0000-4000-8000-000000000002",
        title: "Call back the new lead",
        conversation_id: "c1000000-0000-4000-8000-000000000003",
        message_id: "b1000000-0000-4000-8000-000000000002",
        due_at: null,
        overdue: false,
      },
    ],
  },
};

/** The same shape as a plain member sees it: triage is null (never leaked). */
const MEMBER_PAYLOAD = {
  ...LEAD_PAYLOAD,
  triage: null,
};

function forYouStub(
  role: MemberRole,
  payload: unknown,
  numberAccess: unknown[] = [],
): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "GET",
    "/rest/v1/company_members",
    membershipResponder(MEMBER_ID, role),
  );
  // #106: the route resolves number_access for members ([] = unrestricted).
  sb.on("GET", "/rest/v1/number_access", () => numberAccess);
  sb.on("POST", "/rest/v1/rpc/api_for_you", () => payload);
  return sb;
}

describe("GET /v1/for-you", () => {
  it("returns the four sections and scopes the RPC to caller + company (member)", async () => {
    const sb = forYouStub("member", MEMBER_PAYLOAD);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/for-you", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(MEMBER_PAYLOAD);

    const rpc = sb.find("POST", "/rest/v1/rpc/api_for_you")[0];
    expect(rpc.body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
      p_is_lead: false, // plain member — no triage strip
      p_limit: 20,
    });
    // The clock is injected (testable "overdue") — a real ISO timestamp.
    expect(typeof (rpc.body as Record<string, unknown>).p_now).toBe("string");
  });

  it("#106: a restricted member's RPC receives the hidden-number deny list", async () => {
    const HIDDEN = "dddddddd-0000-4000-8000-00000000000d";
    const sb = forYouStub("member", MEMBER_PAYLOAD, [
      {
        phone_number_id: HIDDEN,
        principal_kind: "role",
        principal: "admin", // a plain member can't match → hidden
        level: "text",
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/for-you", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const rpc = sb.find("POST", "/rest/v1/rpc/api_for_you")[0];
    expect((rpc.body as Record<string, unknown>).p_hidden_number_ids).toEqual([
      HIDDEN,
    ]);
  });

  it("owner/admin get the triage strip: p_is_lead is true (role-derived)", async () => {
    for (const role of ["owner", "admin"] as const) {
      const sb = forYouStub(role, LEAD_PAYLOAD);
      stubFetch(jwksRoute(auth), sb.route);

      const res = await apiRequest(app, env, await auth.token(), "/v1/for-you", {
        companyId: COMPANY_ID,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as typeof LEAD_PAYLOAD;
      expect(body.triage).not.toBeNull();
      expect(body.triage.conversations).toHaveLength(1);
      expect(body.triage.tasks).toHaveLength(1);

      const rpc = sb.find("POST", "/rest/v1/rpc/api_for_you")[0];
      expect(rpc.body, role).toMatchObject({ p_is_lead: true });
      vi.unstubAllGlobals();
    }
  });

  it("a plain member never receives a triage section", async () => {
    const sb = forYouStub("member", MEMBER_PAYLOAD);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/for-you", {
      companyId: COMPANY_ID,
    });
    const body = (await res.json()) as { triage: unknown };
    expect(body.triage).toBeNull();

    // And the lead flag the route sent is false — the RPC never even computes
    // triage for a member.
    const rpc = sb.find("POST", "/rest/v1/rpc/api_for_you")[0];
    expect(rpc.body).toMatchObject({ p_is_lead: false });
  });

  it("waiting_on_you is urgency-sorted as the RPC returns it (overdue pinned)", async () => {
    // The route preserves the RPC's ordering verbatim; assert the contract that
    // the first waiting_on_you item carries the most-urgent rank (urgency 0 =
    // overdue-linked task) so the client renders it first.
    const sb = forYouStub("member", MEMBER_PAYLOAD);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/for-you", {
      companyId: COMPANY_ID,
    });
    const body = (await res.json()) as typeof MEMBER_PAYLOAD;
    expect(body.waiting_on_you[0].urgency).toBe(0);
    expect(body.waiting_on_you[0].has_overdue_task).toBe(true);
    // my_tasks: the overdue task surfaces with overdue=true (pinned top).
    expect(body.my_tasks[0].overdue).toBe(true);
  });

  it("401 without a token; 403 without company membership", async () => {
    const sb = supabaseStub(env);
    sb.on(
      "GET",
      "/rest/v1/company_members",
      membershipResponder(MEMBER_ID, null),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const noAuth = await app.request("/v1/for-you", {}, env);
    expect(noAuth.status).toBe(401);

    const noMember = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/for-you",
      { companyId: COMPANY_ID },
    );
    expect(noMember.status).toBe(403);
  });
});
