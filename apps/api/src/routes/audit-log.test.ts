/**
 * #231 GET /v1/audit-log — the owner-visible history of privileged changes.
 * Real product code over the stubbed network edge (D13): the role gate, the
 * filters, keyset pagination, and the CSV export an owner hands to an insurer
 * or a security questionnaire.
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
import { auditLogRoutes } from "./audit-log";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const ACTOR_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

let auth: TestAuth;
const app = buildTestApp(auditLogRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    actor_user_id: ACTOR_ID,
    actor_name: "Sam Owner",
    actor_ip: "203.0.113.7",
    action: "member.deactivated",
    target_type: "member",
    target_id: "mmmmmmmm-0000-4000-8000-000000000001",
    before: { role: "member", active: true },
    after: { role: "member", active: false },
    occurred_at: "2026-07-20T15:04:05+00:00",
    ...overrides,
  };
}

function stub(rows: unknown[], role = "admin"): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/company_members", membershipResponder(MEMBER_ID, role));
  sb.on("POST", "/rest/v1/rpc/api_list_audit_log", () => rows);
  return sb;
}

describe("GET /v1/audit-log", () => {
  it("returns the page and passes every filter through to the SQL", async () => {
    const sb = stub([row()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/audit-log?actor=" +
        ACTOR_ID +
        "&action=member.deactivated" +
        "&since=2026-07-01T00:00:00Z&until=2026-08-01T00:00:00Z&limit=10",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; next_cursor: null };
    expect(body.data).toHaveLength(1);
    expect(body.next_cursor).toBeNull();

    const rpc = sb.find("POST", "/rest/v1/rpc/api_list_audit_log")[0];
    expect(rpc.body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_actor: ACTOR_ID,
      p_action: "member.deactivated",
      p_since: "2026-07-01T00:00:00Z",
      p_until: "2026-08-01T00:00:00Z",
      // limit + 1: the extra row is the "is there more" sentinel.
      p_limit: 11,
      p_cursor_ts: null,
      p_cursor_id: null,
    });
  });

  it("pages on the keyset, never on an offset", async () => {
    // Rows arrive while someone reads. An offset would skip or repeat them;
    // the cursor is the last row's (occurred_at, id).
    const rows = [
      row({ id: "aaaaaaaa-0000-4000-8000-000000000001" }),
      row({
        id: "aaaaaaaa-0000-4000-8000-000000000002",
        occurred_at: "2026-07-19T10:00:00+00:00",
      }),
    ];
    const sb = stub(rows);
    stubFetch(jwksRoute(auth), sb.route);

    const first = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/audit-log?limit=1",
      { companyId: COMPANY_ID },
    );
    const body = (await first.json()) as {
      data: { id: string }[];
      next_cursor: string;
    };
    expect(body.data).toHaveLength(1);
    expect(body.next_cursor).toBe(
      "2026-07-20T15:04:05+00:00|aaaaaaaa-0000-4000-8000-000000000001",
    );

    // The cursor round-trips into the next call's keyset.
    await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/audit-log?limit=1&cursor=${encodeURIComponent(body.next_cursor)}`,
      { companyId: COMPANY_ID },
    );
    const second = sb.find("POST", "/rest/v1/rpc/api_list_audit_log")[1];
    expect(second.body).toMatchObject({
      p_cursor_ts: "2026-07-20T15:04:05+00:00",
      p_cursor_id: "aaaaaaaa-0000-4000-8000-000000000001",
    });
  });

  it("exports CSV an owner can hand to someone else", async () => {
    const sb = stub([
      row({ after: { role: "member", active: false }, actor_name: 'Sam "Doc"' }),
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/audit-log?format=csv",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("audit-log.csv");

    const text = await res.text();
    const [header, first] = text.split("\r\n");
    expect(header).toBe(
      "occurred_at,actor,actor_ip,action,target_type,target_id,before,after",
    );
    // RFC 4180: a quote inside a name is doubled, never left to break the row.
    expect(first).toContain('"Sam ""Doc"""');
    expect(first).toContain('"member.deactivated"');
  });

  it("names the system when nobody did it", async () => {
    // A cron or a provider webhook is a legitimate actor. "system" is honest;
    // an empty cell reads as missing data.
    const sb = stub([row({ actor_user_id: null, actor_name: null })]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/audit-log?format=csv",
      { companyId: COMPANY_ID },
    );
    expect(await res.text()).toContain('"system"');
  });

  it("is closed to ordinary members", async () => {
    // The log is a map of the workspace's security posture, and the questions
    // it answers are the owner's.
    const sb = stub([row()], "member");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/audit-log", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(403);
    expect(sb.find("POST", "/rest/v1/rpc/api_list_audit_log")).toHaveLength(0);
  });

  it("rejects a garbage filter rather than quietly ignoring it", async () => {
    // A filter that silently does nothing is worse than an error: the reader
    // believes they looked and found nothing.
    const sb = stub([]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/audit-log?actor=not-a-uuid",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(422);
  });
});
