import { afterEach, describe, expect, it, vi } from "vitest";

import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { sendWorkspaceMfaNotices } from "./workspace-mfa-notices";

const CLAIM = "/rest/v1/rpc/claim_workspace_mfa_notices";
const RELEASE = "/rest/v1/rpc/release_workspace_mfa_notice";
const REQUIRED_AT = "2026-11-17T00:00:00Z";
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-30T12:00:00Z");

afterEach(() => vi.unstubAllGlobals());

function setup(providerStatus: number) {
  const env = completeEnv();
  const sb = supabaseStub(env);
  sb.on("POST", CLAIM, () => [{
    member_id: MEMBER_ID,
    required_at: REQUIRED_AT,
    grace_until: "2026-12-01T00:00:00Z",
    kind: "reminder",
    email: "tech@example.test",
    workspace_name: "Plomberie Exemple",
    locale: "fr-CA",
    timezone: "America/Toronto",
  }]);
  sb.on("POST", RELEASE, () => null);
  const email: Request[] = [];
  stubFetch((url, request) => {
    if (url.href !== "https://api.resend.com/emails") return undefined;
    email.push(request.clone());
    return Response.json({ id: "notice" }, { status: providerStatus });
  }, sb.route);
  return { env, sb, email };
}

describe("workspace two-factor notices", () => {
  it("sends a localized notice to the member with a stable delivery key", async () => {
    const { env, sb, email } = setup(200);
    await sendWorkspaceMfaNotices(env, NOW, COMPANY_ID);

    expect(sb.find("POST", CLAIM)[0].body).toEqual({
      p_now: NOW.toISOString(),
      p_company_id: COMPANY_ID,
    });
    expect(email).toHaveLength(1);
    expect(email[0].headers.get("Idempotency-Key"))
      .toBe(`workspace-mfa:${MEMBER_ID}:${REQUIRED_AT}:reminder`);
    const body = await email[0].json();
    expect(body).toMatchObject({
      to: ["tech@example.test"],
      subject: "Rappel de sécurité pour Plomberie Exemple",
    });
    expect(body.html).toContain('<html lang="fr-CA">');
    expect(body.text).toContain("/settings/account#two-factor");
    expect(sb.find("POST", RELEASE)).toHaveLength(0);
  });

  it("releases the claim when the email provider rejects the send", async () => {
    const { env, sb } = setup(500);
    await expect(sendWorkspaceMfaNotices(env, NOW)).rejects.toThrow("notice errors: 1");
    expect(sb.find("POST", RELEASE)[0].body).toEqual({
      p_member_id: MEMBER_ID,
      p_required_at: REQUIRED_AT,
      p_kind: "reminder",
    });
  });
});
