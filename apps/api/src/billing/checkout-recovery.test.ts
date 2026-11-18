import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { remindAbandonedCheckout } from "./checkout-recovery";
import type { Stripe } from "./stripe";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";

const ADDRESS = "1 Example Street, Toronto ON M5V 1A1";
const COMPANY_ID = "f7c901a2-4dd2-4fff-9c35-2f781f4c6f26";
const OWNER_ID = "7e1b5745-7fad-4ad8-b0f6-02dd9e9b5f43";
const TOKEN = crypto.randomUUID();
const EMAIL = "owner@example.com";
const RECOVERY_URL = "https://buy.stripe.com/recovery/test";

let senderAddress: string | null;
vi.mock(import("@loonext/shared"), async (importOriginal) => ({
  ...await importOriginal(),
  get MAILING_ADDRESS() {
    return senderAddress;
  },
}));

beforeEach(() => {
  senderAddress = ADDRESS;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function expiredSession(): Stripe.Checkout.Session {
  return {
    id: "cs_expired",
    mode: "subscription",
    status: "expired",
    client_reference_id: COMPANY_ID,
    recovered_from: null,
    after_expiration: {
      recovery: {
        url: RECOVERY_URL,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        enabled: true,
        allow_promotion_codes: true,
      },
    },
  } as Stripe.Checkout.Session;
}

function setup({ consent = true, failFirstSend = false } = {}) {
  const env = completeEnv();
  const sb = supabaseStub(env);
  let claimedAt: string | null = null;
  sb.on("GET", "/rest/v1/companies", ({ url }) => {
    expect(url.searchParams.get("subscription_status")).toBe("eq.incomplete");
    expect(url.searchParams.get("deleted_at")).toBe("is.null");
    return claimedAt ? [] : [{ owner_user_id: OWNER_ID, locale: "fr-CA" }];
  });
  sb.on("GET", `/auth/v1/admin/users/${OWNER_ID}`, () => ({
    id: OWNER_ID,
    email: EMAIL,
    email_confirmed_at: "2026-01-01T00:00:00Z",
  }));
  sb.on("GET", "/rest/v1/marketing_contacts", ({ url }) => {
    expect(url.searchParams.get("email")).toBe(`eq.${EMAIL}`);
    expect(url.searchParams.get("unsubscribed_at")).toBe("is.null");
    return consent ? [{ unsubscribe_token: TOKEN }] : [];
  });
  sb.on("PATCH", "/rest/v1/companies", ({ body, url }) => {
    const next = (body as { checkout_reminder_sent_at: string | null }).checkout_reminder_sent_at;
    const expectedClaim = claimedAt ? `eq.${claimedAt}` : "is.null";
    expect(url.searchParams.get("id")).toBe(`eq.${COMPANY_ID}`);
    if (url.searchParams.get("checkout_reminder_sent_at") !== expectedClaim) return [];
    claimedAt = next;
    return [{ id: COMPANY_ID }];
  });

  const sent: Request[] = [];
  stubFetch((url, request) => {
    if (url.href !== "https://api.resend.com/emails") return undefined;
    sent.push(request.clone());
    if (failFirstSend && sent.length === 1) {
      return Response.json({ message: `Failed delivery for ${EMAIL}` }, { status: 500 });
    }
    return Response.json({ id: "email_1" });
  }, sb.route);
  return { env, sb, sent };
}

describe("checkout recovery reminder", () => {
  it("skips before accessing personal data when the sender has no mailing address", async () => {
    const { env, sb, sent } = setup();
    senderAddress = null;
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    await remindAbandonedCheckout(env, expiredSession());

    expect(log).toHaveBeenCalledWith({
      event: "checkout_recovery_skipped",
      reason: "missing_sender_postal_address",
    });
    expect(sb.calls).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("skips a verified owner with no active marketing consent", async () => {
    const { env, sb, sent } = setup({ consent: false });

    await remindAbandonedCheckout(env, expiredSession());

    expect(sb.find("PATCH", "/rest/v1/companies")).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("sends a localized reminder with sender details and one-click unsubscribe once", async () => {
    const { env, sent } = setup();
    const session = expiredSession();

    await Promise.all([remindAbandonedCheckout(env, session), remindAbandonedCheckout(env, session)]);
    await remindAbandonedCheckout(env, { ...session, id: "cs_expired_again" });

    expect(sent).toHaveLength(1);
    expect(sent[0].headers.get("Idempotency-Key")).toBe(`checkout-recovery:${COMPANY_ID}:${session.id}`);
    const mail = await sent[0].json() as {
      to: string[];
      subject: string;
      text: string;
      html: string;
      headers: Record<string, string>;
    };
    expect(mail.to).toEqual([EMAIL]);
    expect(mail.subject).toBe("Terminez votre inscription à Loonext");
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain(RECOVERY_URL);
      expect(part).toContain(ADDRESS);
      expect(part).toContain("Se désabonner");
      expect(part).toContain(TOKEN);
    }
    expect(mail.headers).toEqual({
      "List-Unsubscribe": `<${env.API_ORIGIN}/marketing/unsubscribe?token=${TOKEN}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("releases a failed send for retry without logging provider response details", async () => {
    const { env, sb, sent } = setup({ failFirstSend: true });
    const session = expiredSession();

    await expect(remindAbandonedCheckout(env, session)).rejects.toThrow(
      "Could not send the checkout recovery reminder.",
    );
    await remindAbandonedCheckout(env, session);

    expect(sb.find("PATCH", "/rest/v1/companies")).toHaveLength(3);
    expect(sent).toHaveLength(2);
    expect(sent[1].headers.get("Idempotency-Key")).toBe(sent[0].headers.get("Idempotency-Key"));
  });
});
