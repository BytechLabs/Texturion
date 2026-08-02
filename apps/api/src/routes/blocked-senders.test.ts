/**
 * #250 — POST/GET/DELETE /v1/blocked-senders.
 *
 * The block is the one spam mechanism allowed to ACT: the classifier badges
 * and never hides, because a wrong guess costs somebody a job, but a block is
 * a person who read the thread and decided. So what these pin is that the
 * decision is scoped, audited, and reversible.
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
import { blockedSendersRoutes } from "./blocked-senders";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const BLOCK_ID = "aaaaaaaa-2222-4333-8444-555555555555";

let auth: TestAuth;
const app = buildTestApp(blockedSendersRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function stubs(options: { missing?: boolean } = {}): SupabaseStub {
  const sb = supabaseStub(env);
  // Registered FIRST because the harness is first-match-wins: a later
  // sb.on() for the same route would never be reached.
  if (options.missing === true) {
    sb.on("DELETE", "/rest/v1/blocked_senders", () => []);
  }
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, "member"),
  );
  sb.on("GET", "/rest/v1/blocked_senders", () => []);
  sb.on("POST", "/rest/v1/blocked_senders", () => [
    {
      id: BLOCK_ID,
      phone_e164: "+14155559999",
      reason: null,
      blocked_by: MEMBER_ID,
      created_at: "2026-08-02T10:00:00+00:00",
    },
  ]);
  sb.on("DELETE", "/rest/v1/blocked_senders", () => [
    { id: BLOCK_ID, phone_e164: "+14155559999" },
  ]);
  sb.on("POST", "/rest/v1/audit_log", () => []);
  return sb;
}

async function call(
  sb: SupabaseStub,
  path: string,
  init: { method: string; body?: unknown },
): Promise<Response> {
  stubFetch(jwksRoute(auth), sb.route);
  return apiRequest(app, env, await auth.token(), path, {
    ...init,
    companyId: COMPANY_ID,
  });
}

describe("POST /v1/blocked-senders", () => {
  it("blocks a number and audits who did it", async () => {
    const sb = stubs();
    const res = await call(sb, "/v1/blocked-senders", {
      method: "POST",
      body: { phone_e164: "+14155559999", reason: "robotexts daily" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ phone_e164: "+14155559999" });
    // A block is a person's decision, so unlike the classifier's arrivals it
    // names the member. "Why did this number stop reaching us" has an answer.
    const audits = sb.find("POST", "/rest/v1/audit_log");
    expect(audits).toHaveLength(1);
  });

  it("refuses anything that is not an E.164 number", async () => {
    // The inbound path compares this against the sender verbatim, so a
    // formatted or partial number would block nothing and look like it worked.
    for (const bad of ["4155559999", "(415) 555-9999", "+1", "", "not a phone"]) {
      const res = await call(stubs(), "/v1/blocked-senders", {
        method: "POST",
        body: { phone_e164: bad },
      });
      expect(res.status, `${bad} should be rejected`).toBe(422);
    }
  });

  it("is idempotent: blocking twice is the same answer", async () => {
    // Upsert on (company_id, phone_e164). A unique violation surfacing as a
    // 500 would make a double-tap look like breakage.
    const sb = stubs();
    const first = await call(sb, "/v1/blocked-senders", {
      method: "POST",
      body: { phone_e164: "+14155559999" },
    });
    const second = await call(sb, "/v1/blocked-senders", {
      method: "POST",
      body: { phone_e164: "+14155559999" },
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // Both went through as an upsert rather than the second 409-ing.
    for (const write of sb.find("POST", "/rest/v1/blocked_senders")) {
      expect(write.url.searchParams.get("on_conflict")).toBe(
        "company_id,phone_e164",
      );
    }
  });
});

describe("DELETE /v1/blocked-senders/:id", () => {
  it("unblocks and audits it", async () => {
    const sb = stubs();
    const res = await call(sb, `/v1/blocked-senders/${BLOCK_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    expect(sb.find("POST", "/rest/v1/audit_log")).toHaveLength(1);
  });

  it("404s on a block that is not this workspace's", async () => {
    // The delete is scoped by company_id, so another workspace's id simply
    // matches no row — the tenant boundary is the query, not a check.
    const sb = stubs({ missing: true });
    const res = await call(sb, `/v1/blocked-senders/${BLOCK_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    expect(sb.find("POST", "/rest/v1/audit_log")).toHaveLength(0);
  });
});

describe("GET /v1/blocked-senders", () => {
  it("lists this workspace's blocks, scoped by company", async () => {
    const sb = stubs();
    const res = await call(sb, "/v1/blocked-senders", { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
    const reads = sb.find("GET", "/rest/v1/blocked_senders");
    expect(reads.length).toBeGreaterThan(0);
    // #347's tenant-scope suite is what proves every query carries company_id;
    // this only pins that the route reads the table at all.
    expect(reads[0]?.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
  });
});
