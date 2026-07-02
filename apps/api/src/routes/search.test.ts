/**
 * GET /v1/search (SPEC §6, §7): FTS + trgm via the api_search SQL function,
 * cursor over conversation hits, contacts on the first page only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { encodeCursor } from "../http/pagination";
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
import { searchRoutes } from "./search";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONV_ID = "aaaaaaaa-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(searchRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function memberStub(): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "GET",
    "/rest/v1/company_members",
    membershipResponder(MEMBER_ID, "member"),
  );
  return sb;
}

describe("GET /v1/search", () => {
  it("calls api_search with company scope, limit+1, and first-page contacts", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_search", () => ({
      conversations: [
        {
          id: CONV_ID,
          matched_at: "2026-07-01T10:00:00+00:00",
          snippet: "the <b>quote</b> you asked for",
          contact: { id: "dddddddd-1111-4222-8333-444444444444", name: "Jo" },
        },
      ],
      contacts: [{ id: "dddddddd-1111-4222-8333-444444444444", name: "Jo" }],
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/search?q=quote&limit=20",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      conversations: { snippet: string }[];
      contacts: unknown[];
      next_cursor: string | null;
    };
    expect(body.conversations[0].snippet).toContain("<b>quote</b>");
    expect(body.contacts).toHaveLength(1);
    expect(body.next_cursor).toBeNull();

    const rpc = sb.find("POST", "/rest/v1/rpc/api_search")[0];
    expect(rpc.body).toEqual({
      p_company_id: COMPANY_ID,
      p_q: "quote",
      p_conversation_limit: 21,
      p_contact_limit: 10,
      p_cursor_ts: null,
      p_cursor_id: null,
    });
  });

  it("passes the decoded cursor and suppresses contacts on later pages", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_search", () => ({
      conversations: [],
      contacts: [],
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const cursor = encodeCursor({
      ts: "2026-07-01T10:00:00+00:00",
      id: CONV_ID,
    });
    await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/search?q=quote&cursor=${cursor}`,
      { companyId: COMPANY_ID },
    );
    const rpc = sb.find("POST", "/rest/v1/rpc/api_search")[0];
    expect(rpc.body).toMatchObject({
      p_contact_limit: 0,
      p_cursor_ts: "2026-07-01T10:00:00+00:00",
      p_cursor_id: CONV_ID,
    });
  });

  it("builds next_cursor from the matched_at sort key when a full page + 1 returns", async () => {
    const conversations = Array.from({ length: 3 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      matched_at: `2026-07-01T10:00:0${5 - i}+00:00`,
    }));
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_search", () => ({
      conversations,
      contacts: [],
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/search?q=quote&limit=2",
      { companyId: COMPANY_ID },
    );
    const body = (await res.json()) as {
      conversations: unknown[];
      next_cursor: string | null;
    };
    expect(body.conversations).toHaveLength(2);
    expect(body.next_cursor).toBe(
      encodeCursor({
        ts: "2026-07-01T10:00:04+00:00",
        id: "00000000-0000-4000-8000-000000000001",
      }),
    );
  });

  it("422s a missing or empty q", async () => {
    const sb = memberStub();
    stubFetch(jwksRoute(auth), sb.route);
    for (const qs of ["", "?q=", "?q=%20"]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/search${qs}`,
        { companyId: COMPANY_ID },
      );
      expect(res.status, qs).toBe(422);
    }
  });

  it("403s a non-member", async () => {
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/company_members", membershipResponder(MEMBER_ID, null));
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/search?q=quote",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(403);
  });
});
