/**
 * #714: the shared activity read. Real middleware and route code; the network
 * edge (PostgREST over fetch) is the only stub.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
} from "../test/routes-harness";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import { recordActivityRoutes } from "./record-activity";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const RECORD_ID = "cccccccc-1111-4222-8333-444444444444";
const HIDDEN_NUMBER = "eeeeeeee-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(recordActivityRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function harness(levels: { phone_number_id: string; level: string }[] = []) {
  const role = "member";
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(auth.subject, role),
  );
  sb.on("POST", "/rest/v1/rpc/member_number_levels", () => levels);
  sb.on("GET", "/rest/v1/profiles", () => [
    { user_id: auth.subject, display_name: "Rehman" },
  ]);
  return sb;
}

const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `a0000000-0000-4000-8000-00000000000${n}`,
  kind: "text_out",
  category: "message",
  occurred_at: `2026-11-10T1${n}:00:00.000Z`,
  actor_type: "member",
  actor_id: null,
  payload: {},
  source_type: "message",
  source_id: `b0000000-0000-4000-8000-00000000000${n}`,
  conversation_id: "d0000000-0000-4000-8000-000000000001",
  ...extra,
});

async function get(sb: ReturnType<typeof harness>, path: string) {
  stubFetch(jwksRoute(auth), sb.route);
  return apiRequest(app, env, await auth.token(), path, { companyId: COMPANY_ID });
}

describe("GET /v1/{contacts,conversations,calls}/:id/activity", () => {
  it.each([
    ["contacts", "contact"],
    ["conversations", "conversation"],
    ["calls", "call"],
  ])("reads %s through the one RPC", async (segment, recordType) => {
    const sb = harness();
    sb.on("POST", "/rest/v1/rpc/api_record_activity", () => ({ outcome: "ok", items: [] }));
    const response = await get(sb, `/v1/${segment}/${RECORD_ID}/activity`);
    expect(response.status).toBe(200);
    const body = JSON.stringify(sb.find("POST", "/rest/v1/rpc/api_record_activity")[0]);
    expect(body).toContain(`"p_record_type":"${recordType}"`);
    expect(body).toContain(`"p_record_id":"${RECORD_ID}"`);
  });

  it("reads a task's through the record-activity path, leaving /activity to the #689 feed", async () => {
    const sb = harness();
    sb.on("POST", "/rest/v1/rpc/api_record_activity", () => ({ outcome: "ok", items: [] }));
    const response = await get(sb, `/v1/tasks/${RECORD_ID}/record-activity`);
    expect(response.status).toBe(200);
    expect(JSON.stringify(sb.find("POST", "/rest/v1/rpc/api_record_activity")[0])).toContain(
      '"p_record_type":"task"',
    );
  });

  it("shapes items with the actor, a source link and a cursor", async () => {
    const sb = harness();
    sb.on("POST", "/rest/v1/rpc/api_record_activity", () => ({
      outcome: "ok",
      items: [
        row(3, { actor_id: auth.subject }),
        row(2, { kind: "call", category: "call", actor_type: "customer" }),
        row(1),
      ],
    }));
    const response = await get(sb, `/v1/contacts/${RECORD_ID}/activity?limit=2`);
    const json = (await response.json()) as {
      data: Record<string, unknown>[];
      next_cursor: string | null;
    };
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toMatchObject({
      kind: "text_out",
      category: "message",
      actor: { type: "member", user_id: auth.subject, display_name: "Rehman" },
      source: { type: "message", conversation_id: "d0000000-0000-4000-8000-000000000001" },
    });
    expect(json.data[1]).toMatchObject({ actor: { type: "customer", display_name: null } });
    expect(json.next_cursor).not.toBeNull();
    expect(JSON.stringify(sb.find("POST", "/rest/v1/rpc/api_record_activity")[0])).toContain(
      '"p_limit":3',
    );
  });

  it("passes the category filter, and refuses an unknown one", async () => {
    const sb = harness();
    sb.on("POST", "/rest/v1/rpc/api_record_activity", () => ({ outcome: "ok", items: [] }));
    expect((await get(sb, `/v1/contacts/${RECORD_ID}/activity?category=call`)).status).toBe(200);
    expect(JSON.stringify(sb.find("POST", "/rest/v1/rpc/api_record_activity")[0])).toContain(
      '"p_category":"call"',
    );
    expect((await get(sb, `/v1/contacts/${RECORD_ID}/activity?category=nope`)).status).toBe(422);
  });

  it("is a 404 for a record the RPC will not show", async () => {
    const sb = harness();
    sb.on("POST", "/rest/v1/rpc/api_record_activity", () => ({ outcome: "not_found" }));
    const response = await get(sb, `/v1/conversations/${RECORD_ID}/activity`);
    expect(response.status).toBe(404);
  });

  it("hands the RPC the numbers the caller is denied (#106)", async () => {
    const sb = harness([{ phone_number_id: HIDDEN_NUMBER, level: "none" }]);
    sb.on("POST", "/rest/v1/rpc/api_record_activity", () => ({ outcome: "ok", items: [] }));
    await get(sb, `/v1/contacts/${RECORD_ID}/activity`);
    const sent = JSON.stringify(sb.find("POST", "/rest/v1/rpc/api_record_activity")[0]);
    expect(sent).toContain(HIDDEN_NUMBER);
  });
});
