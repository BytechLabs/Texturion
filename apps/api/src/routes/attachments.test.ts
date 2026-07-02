/**
 * GET /v1/attachments/:id/url (SPEC §7): membership-checked signed Storage
 * URL, 1-hour TTL.
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
import { attachmentsRoutes } from "./attachments";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const ATTACHMENT_ID = "77777777-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(attachmentsRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWithRole(role: string | null): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "GET",
    "/rest/v1/company_members",
    membershipResponder(MEMBER_ID, role),
  );
  return sb;
}

describe("GET /v1/attachments/:id/url", () => {
  it("mints a 1-hour signed URL for a company-owned attachment", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/message_attachments", () => [
      {
        id: ATTACHMENT_ID,
        storage_path: `mms-media/${COMPANY_ID}/msg-1/0`,
      },
    ]);
    sb.on("POST", /^\/storage\/v1\/object\/sign\//, () => ({
      signedURL: `/object/sign/mms-media/${COMPANY_ID}/msg-1/0?token=sig`,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const before = Date.now();
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}/url`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; expires_at: string };
    expect(body.url).toContain("token=sig");

    // TTL 1 hour (SPEC §7).
    const expires = new Date(body.expires_at).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 3595_000);
    expect(expires).toBeLessThanOrEqual(before + 3605_000);

    // The row lookup was company-scoped (the membership check), and the
    // Storage sign call stripped the bucket prefix from storage_path.
    const lookup = sb.find("GET", "/rest/v1/message_attachments")[0];
    expect(lookup.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    const sign = sb.find("POST", /^\/storage\/v1\/object\/sign\//)[0];
    expect(sign.path).toBe(
      `/storage/v1/object/sign/mms-media/${COMPANY_ID}/msg-1/0`,
    );
    expect(sign.body).toMatchObject({ expiresIn: 3600 });
  });

  it("404s another company's attachment (membership check) and malformed ids", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/message_attachments", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    for (const id of [ATTACHMENT_ID, "not-a-uuid"]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/attachments/${id}/url`,
        { companyId: COMPANY_ID },
      );
      expect(res.status, id).toBe(404);
    }
    // No Storage call may happen for a failed membership lookup.
    expect(sb.find("POST", /^\/storage\//)).toHaveLength(0);
  });

  it("403s a non-member before touching anything", async () => {
    const sb = stubWithRole(null);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/attachments/${ATTACHMENT_ID}/url`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(403);
    expect(sb.find("GET", "/rest/v1/message_attachments")).toHaveLength(0);
  });
});
