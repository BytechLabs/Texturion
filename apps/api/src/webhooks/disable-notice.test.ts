import { afterEach, describe, expect, it, vi } from "vitest";

import { getEnv } from "../env";
import { completeEnv, stubFetch } from "../test/support";
import { supabaseStub } from "../test/routes-harness";
import { sendEmail } from "../email/resend";
import { runWebhookDisableEmails } from "./disable-notice";

vi.mock("../email/resend", () => ({ sendEmail: vi.fn() }));

const env = completeEnv();
const owner = "8d000000-0000-4000-8000-00000000000e";
const companyId = "8d000000-0000-4000-8000-0000000000d6";
const auditId = "8d000000-0000-4000-8000-0000000000d7";
const now = new Date("2026-11-19T12:00:00Z");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe(runWebhookDisableEmails, () => {
  it("uses the same Resend key when email succeeds but the completion write fails", async () => {
    const db = supabaseStub(env);
    db.on("POST", "/rest/v1/rpc/api_claim_webhook_disable_emails", () => [
      { audit_id: auditId, company_id: companyId },
    ]);
    db.on("GET", "/rest/v1/companies", () => [{ owner_user_id: owner, locale: "fr-CA" }]);
    db.on("GET", `/auth/v1/admin/users/${owner}`, () => ({ id: owner, email: "owner@example.invalid" }));
    let completion = 0;
    db.on("DELETE", "/rest/v1/webhook_disable_emails", ({ url }) => {
      if (url.searchParams.get("audit_id") === `eq.${auditId}`) {
        completion += 1;
        if (completion === 1) {
          return Response.json({ code: "fixture", message: "write failed" }, { status: 400 });
        }
      }
      return new Response(null, { status: 204, headers: { "Content-Range": "*/0" } });
    });
    vi.mocked(sendEmail).mockResolvedValue({ id: "resend-id" });
    stubFetch(db.route);

    await expect(runWebhookDisableEmails(getEnv(env), now)).rejects.toThrow("webhook disable email job failed");
    await expect(runWebhookDisableEmails(getEnv(env), now)).resolves.toBe(1);
    const completions = db.find("DELETE", "/rest/v1/webhook_disable_emails")
      .filter(({ url }) => url.searchParams.get("audit_id") === `eq.${auditId}`);
    expect(completions.map(({ url }) => url.searchParams.get("company_id"))).toEqual([`eq.${companyId}`, `eq.${companyId}`]);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    for (const [, mail] of vi.mocked(sendEmail).mock.calls) {
      expect(mail).toMatchObject({
        to: "owner@example.invalid",
        locale: "fr-CA",
        idempotencyKey: `webhook-disabled:${auditId}`,
      });
      expect(mail.text).toContain("/settings/webhooks");
    }
  });
});
