/**
 * #231 — the audit write path. What lands in the row, what never does, and
 * what happens when the write itself fails.
 */
import * as Sentry from "@sentry/cloudflare";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { recordAudit, recordAuditFromRequest } from "./log";

vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const ACTOR_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function stub(options: { insertFails?: boolean } = {}): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/audit_log", () =>
    options.insertFails
      ? new Response(JSON.stringify({ message: "boom" }), { status: 500 })
      : [],
  );
  return sb;
}

/** The slice of a Hono context the request-flavoured writer reads. */
function requestContext(headers: Record<string, string>) {
  return {
    req: { header: (name: string) => headers[name] },
    get: () => ACTOR_ID,
  } as unknown as Parameters<typeof recordAuditFromRequest>[1];
}

describe("recordAudit", () => {
  it("writes exactly one row carrying the change", async () => {
    const sb = stub();
    stubFetch(sb.route);

    await recordAudit(getDb(env), {
      companyId: COMPANY_ID,
      actorUserId: ACTOR_ID,
      action: "member.role_changed",
      targetType: "member",
      targetId: "m-1",
      before: { role: "member" },
      after: { role: "admin" },
    });

    const writes = sb.find("POST", "/rest/v1/audit_log");
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toMatchObject({
      company_id: COMPANY_ID,
      actor_user_id: ACTOR_ID,
      action: "member.role_changed",
      target_type: "member",
      target_id: "m-1",
      before: { role: "member" },
      after: { role: "admin" },
    });
  });

  it("records a system actor as nobody, not as a person", async () => {
    // A cron and a webhook are legitimate actors. Attributing their work to
    // whoever happened to be signed in would be worse than saying nothing.
    const sb = stub();
    stubFetch(sb.route);

    await recordAudit(getDb(env), {
      companyId: COMPANY_ID,
      actorUserId: null,
      action: "billing.plan_changed",
      targetType: "company",
    });

    expect(sb.find("POST", "/rest/v1/audit_log")[0].body).toMatchObject({
      actor_user_id: null,
      target_id: null,
    });
  });

  it("never fails the action it is recording, but never goes quiet either", async () => {
    // The mutation already happened — a failed log write cannot undo it, and
    // refusing to remove a member because the log blipped is the worse
    // failure. A hole in the log must still be visible to US.
    const sb = stub({ insertFails: true });
    stubFetch(sb.route);

    // False, not a throw. Almost every caller ignores this and is right to —
    // the mutation already happened. The one that does not is #309's capture
    // call, where the audit row IS the daily dial ceiling, so a write that
    // silently failed would be a cost control that fails open.
    await expect(
      recordAudit(getDb(env), {
        companyId: COMPANY_ID,
        actorUserId: ACTOR_ID,
        action: "member.deactivated",
        targetType: "member",
      }),
    ).resolves.toBe(false);

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("audit_log write failed"),
      "error",
    );
  });
});

describe("recordAuditFromRequest", () => {
  it("keeps where the action came from — the first thing read after a phishing report", async () => {
    const sb = stub();
    stubFetch(sb.route);

    await recordAuditFromRequest(
      getDb(env),
      requestContext({
        "CF-Connecting-IP": "203.0.113.7",
        "X-Forwarded-For": "198.51.100.9, 203.0.113.7",
        "User-Agent": "Mozilla/5.0 (Macintosh)",
      }),
      { companyId: COMPANY_ID, action: "member.invited", targetType: "invite" },
    );

    // Cloudflare's own client-IP header wins; the proxy chain is not trusted
    // beyond it.
    expect(sb.find("POST", "/rest/v1/audit_log")[0].body).toMatchObject({
      actor_user_id: ACTOR_ID,
      actor_ip: "203.0.113.7",
      actor_agent: "Mozilla/5.0 (Macintosh)",
    });
  });

  it("falls back to the forwarded chain's first hop, then to unknown", async () => {
    const sb = stub();
    stubFetch(sb.route);

    await recordAuditFromRequest(
      getDb(env),
      requestContext({ "X-Forwarded-For": "198.51.100.9, 203.0.113.7" }),
      { companyId: COMPANY_ID, action: "member.invited", targetType: "invite" },
    );
    await recordAuditFromRequest(getDb(env), requestContext({}), {
      companyId: COMPANY_ID,
      action: "member.invited",
      targetType: "invite",
    });

    const writes = sb.find("POST", "/rest/v1/audit_log");
    expect(writes[0].body).toMatchObject({ actor_ip: "198.51.100.9" });
    // Absent reads as unknown rather than as a guess.
    expect(writes[1].body).toMatchObject({ actor_ip: null, actor_agent: null });
  });

  it("bounds the agent string — a header is attacker-controlled", async () => {
    const sb = stub();
    stubFetch(sb.route);

    await recordAuditFromRequest(
      getDb(env),
      requestContext({ "User-Agent": "x".repeat(5000) }),
      { companyId: COMPANY_ID, action: "member.invited", targetType: "invite" },
    );

    const written = (
      sb.find("POST", "/rest/v1/audit_log")[0].body as { actor_agent: string }
    ).actor_agent;
    expect(written.length).toBe(400);
  });
});
