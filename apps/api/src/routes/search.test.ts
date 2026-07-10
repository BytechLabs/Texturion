/**
 * GET /v1/search (SPEC §6, §7, D29): the full palette via the api_search_v2
 * SQL function — cursor over conversation hits; contacts, tasks, attachments,
 * and templates ride along on the first page only. Conversation hits carry
 * the matched message's direction so notes are labelable.
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
const TASK_ID = "bbbbbbbb-1111-4222-8333-444444444444";
const ATTACHMENT_ID = "cccccccc-1111-4222-8333-444444444444";
const TEMPLATE_ID = "eeeeeeee-1111-4222-8333-444444444444";

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
  // #106: no access rules → the member caller is unrestricted.
  sb.on("GET", "/rest/v1/number_access", () => []);
  return sb;
}

function emptyArms() {
  return { contacts: [], tasks: [], attachments: [], templates: [] };
}

describe("GET /v1/search", () => {
  it("calls api_search_v2 with company scope, limit+1, and first-page arm limits", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_search_v2", () => ({
      conversations: [
        {
          id: CONV_ID,
          matched_at: "2026-07-01T10:00:00+00:00",
          direction: "note",
          snippet: "the <b>quote</b> you asked for",
          contact: { id: "dddddddd-1111-4222-8333-444444444444", name: "Jo" },
        },
      ],
      contacts: [{ id: "dddddddd-1111-4222-8333-444444444444", name: "Jo" }],
      tasks: [
        {
          id: TASK_ID,
          title: "Send the quote",
          conversation_id: CONV_ID,
          done: false,
          matched_at: "2026-07-01T09:00:00+00:00",
        },
      ],
      attachments: [
        {
          id: ATTACHMENT_ID,
          file_name: "quote.pdf",
          owner_type: "note",
          conversation_id: CONV_ID,
          content_type: "application/pdf",
          created_at: "2026-07-01T08:00:00+00:00",
        },
      ],
      templates: [
        { id: TEMPLATE_ID, name: "Quote follow-up", snippet: "Hi there…" },
      ],
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
      conversations: { snippet: string; direction: string }[];
      contacts: unknown[];
      tasks: { id: string; done: boolean }[];
      attachments: { id: string; owner_type: string }[];
      templates: { id: string; snippet: string }[];
      next_cursor: string | null;
    };
    expect(body.conversations[0].snippet).toContain("<b>quote</b>");
    // Note hits are labelable: the matched message's direction passes through.
    expect(body.conversations[0].direction).toBe("note");
    expect(body.contacts).toHaveLength(1);
    expect(body.tasks).toEqual([
      {
        id: TASK_ID,
        title: "Send the quote",
        conversation_id: CONV_ID,
        done: false,
        matched_at: "2026-07-01T09:00:00+00:00",
      },
    ]);
    expect(body.attachments[0]).toMatchObject({
      id: ATTACHMENT_ID,
      file_name: "quote.pdf",
      owner_type: "note",
      conversation_id: CONV_ID,
    });
    expect(body.templates).toEqual([
      { id: TEMPLATE_ID, name: "Quote follow-up", snippet: "Hi there…" },
    ]);
    expect(body.next_cursor).toBeNull();

    // Company scoping + per-arm limits happen in the RPC call, verbatim.
    const rpc = sb.find("POST", "/rest/v1/rpc/api_search_v2")[0];
    expect(rpc.body).toEqual({
      p_company_id: COMPANY_ID,
      p_q: "quote",
      p_conversation_limit: 21,
      p_contact_limit: 10,
      p_task_limit: 5,
      p_attachment_limit: 5,
      p_template_limit: 5,
      p_cursor_ts: null,
      p_cursor_id: null,
      // #106: unrestricted caller → null deny list (the RPC filters nothing).
      p_hidden_number_ids: null,
    });
  });

  it("passes the decoded cursor and suppresses the first-page-only arms on later pages", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_search_v2", () => ({
      conversations: [],
      ...emptyArms(),
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
    const rpc = sb.find("POST", "/rest/v1/rpc/api_search_v2")[0];
    expect(rpc.body).toMatchObject({
      p_contact_limit: 0,
      p_task_limit: 0,
      p_attachment_limit: 0,
      p_template_limit: 0,
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
    sb.on("POST", "/rest/v1/rpc/api_search_v2", () => ({
      conversations,
      ...emptyArms(),
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

  it("keeps the additive shape: empty arms come back as empty arrays", async () => {
    const sb = memberStub();
    sb.on("POST", "/rest/v1/rpc/api_search_v2", () => ({
      conversations: [],
      ...emptyArms(),
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/search?q=nothing",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      conversations: [],
      contacts: [],
      tasks: [],
      attachments: [],
      templates: [],
      next_cursor: null,
    });
  });

  it("#106: a restricted member's search RPC receives the hidden-number deny list", async () => {
    // The deny filter is applied INSIDE api_search_v2 (SQL-tested in
    // global_search.test.sql, arm-by-arm); the Worker's job is to resolve the
    // caller's hidden numbers and pass them, so the RPC returns limit+1 VISIBLE
    // hits and the cursor never truncates.
    const HIDDEN_NUM = "ffffffff-2222-4222-8333-444444444444";
    const sb = supabaseStub(env);
    sb.on(
      "GET",
      "/rest/v1/company_members",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("GET", "/rest/v1/number_access", () => [
      {
        phone_number_id: HIDDEN_NUM,
        principal_kind: "role",
        principal: "admin",
        level: "text",
      },
    ]);
    sb.on("POST", "/rest/v1/rpc/api_search_v2", () => ({
      conversations: [],
      contacts: [],
      tasks: [],
      attachments: [],
      templates: [],
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/search?q=quote",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const rpc = sb.find("POST", "/rest/v1/rpc/api_search_v2")[0];
    expect((rpc.body as Record<string, unknown>).p_hidden_number_ids).toEqual([
      HIDDEN_NUM,
    ]);
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
