/**
 * #422 — the Worker's half of a chargeback.
 *
 * The ledger's behaviour (idempotency, attribution surviving a later event,
 * the tenant flag) is SQL and is covered by supabase/tests/billing_disputes.test.sql.
 * What this owns is what the handler decides:
 *
 *   - that an unattributable dispute is still recorded and still sends its
 *     notice, because a charge we cannot match to a company is MORE alarming;
 *   - that it does NOT write the audit log without a company, because
 *     `audit_log.company_id` is NOT NULL and `recordAudit` swallows its own
 *     failures — an unguarded call would be a silent hole in the log this
 *     issue exists to create;
 *   - that the notice names the total cost, which is the entire argument;
 *   - that a redelivery does not send it twice;
 *   - that nobody is emailed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { noticesCaptured, resetCaptures } from "../test/capture-mock";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { handleChargeDispute } from "./disputes";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";

vi.mock("../observability/capture", async () =>
  (await import("../test/capture-mock")).captureModuleMock(),
);

const notices = () => noticesCaptured("billing-dispute");

beforeEach(() => {
  resetCaptures();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function dispute(overrides: Record<string, unknown> = {}) {
  return {
    id: "dp_1",
    amount: 2900,
    reason: "fraudulent",
    status: "warning_needs_response",
    created: Math.floor(Date.parse("2026-07-28T09:00:00Z") / 1000),
    charge: { id: "ch_1", customer: "cus_1" },
    payment_intent: "pi_1",
    evidence_details: { due_by: Math.floor(Date.parse("2026-08-10T00:00:00Z") / 1000) },
    balance_transactions: [{ fee: 1500 }],
    ...overrides,
  } as never;
}

function world(options: { company?: boolean; firstSeen?: boolean } = {}) {
  const sb = supabaseStub(env);
  const rpcCalls: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];

  sb.on("GET", "/rest/v1/companies", () =>
    options.company === false ? [] : [{ id: COMPANY_ID, stripe_subscription_id: "sub_1" }],
  );
  sb.on("POST", "/rest/v1/rpc/record_billing_dispute", (call) => {
    rpcCalls.push(call.body as Record<string, unknown>);
    return { recorded: true, first_seen: options.firstSeen ?? true };
  });
  sb.on("POST", "/rest/v1/audit_log", (call) => {
    audits.push(call.body as Record<string, unknown>);
    return [];
  });

  const emails: Record<string, unknown>[] = [];
  const resend: FetchRoute = async (url, request) => {
    if (url.href !== "https://api.resend.com/emails") return undefined;
    emails.push((await request.clone().json()) as Record<string, unknown>);
    return Response.json({ id: "email_1" });
  };
  return { sb, rpcCalls, audits, emails, routes: [sb.route, resend] };
}

describe("a dispute we can attribute", () => {
  it("records it, audits it, and sends one notice", async () => {
    const w = world();
    stubFetch(...w.routes);

    await handleChargeDispute(env, dispute(), "charge.dispute.created");

    expect(w.rpcCalls[0]).toMatchObject({
      p_dispute_id: "dp_1",
      p_company_id: COMPANY_ID,
      // The one id shared by the charge, the dispute and the invoice's payment
      // records. `Charge.invoice` and a top-level `Invoice.charge` do not
      // exist in this SDK, so anything else would never join.
      p_payment_intent: "pi_1",
      p_amount_cents: 2900,
      p_fee_cents: 1500,
    });
    expect(w.audits).toHaveLength(1);
    expect(w.audits[0]).toMatchObject({
      action: "billing.disputed",
      // Stripe raised this, not a person. Attributing it to whoever owns the
      // workspace would put a name on an act nobody here performed.
      actor_user_id: null,
    });
    expect(notices()).toHaveLength(1);
    expect(notices()[0].level).toBe("error");
    expect(w.emails).toEqual([]);
  });

  it("names the TOTAL cost, which is the whole argument", async () => {
    // $29 clawed back plus a $15 fee is $44 out on a sale netting $27.71. An
    // alert that reports only the $29 understates the damage by more than half.
    const w = world();
    stubFetch(...w.routes);

    await handleChargeDispute(env, dispute(), "charge.dispute.created");

    const [notice] = notices();
    expect(notice.detail).toContain("total cost $44.00");
    expect(notice.detail).toContain(`company ${COMPANY_ID}`);
    // And that we did NOT cut them off, since that is the reader's first
    // question and the answer is deliberate.
    expect(notice.action).toContain("still running");
  });

  it("assumes the published fee when Stripe has not reported one yet", async () => {
    // Under-reporting the cost is the one direction that makes the alert less
    // alarming than the truth.
    const w = world();
    stubFetch(...w.routes);

    await handleChargeDispute(
      env,
      dispute({ balance_transactions: [] }),
      "charge.dispute.created",
    );

    expect(w.rpcCalls[0]).toMatchObject({ p_fee_cents: 1500 });
  });
});

describe("a dispute we cannot attribute", () => {
  it("still records and still sends the notice: it is MORE alarming, not less", async () => {
    const w = world({ company: false });
    stubFetch(...w.routes);

    await handleChargeDispute(env, dispute(), "charge.dispute.created");

    expect(w.rpcCalls[0]).toMatchObject({ p_company_id: null });
    expect(notices()).toHaveLength(1);
    expect(notices()[0].detail).toContain("UNMATCHED customer");
  });

  it("writes NO audit row, because the log cannot hold one", async () => {
    // `audit_log.company_id` is NOT NULL with an FK, and `recordAudit`
    // swallows its failure into an exception. An unguarded call would look like it
    // logged and quietly would not — a hole in exactly the log #422 asks for.
    const w = world({ company: false });
    stubFetch(...w.routes);

    await handleChargeDispute(env, dispute(), "charge.dispute.created");

    expect(w.audits).toHaveLength(0);
  });
});

describe("Stripe redelivers", () => {
  it("does not send the notice twice for the same dispute", async () => {
    const w = world({ firstSeen: false });
    stubFetch(...w.routes);

    await handleChargeDispute(env, dispute(), "charge.dispute.created");

    expect(w.rpcCalls).toHaveLength(1); // still recorded, for the status advance
    expect(notices()).toEqual([]);
  });

  it("a lost dispute delivered twice takes the prepaid year back once", async () => {
    const w = world();
    // The ledger the revoke RPC keeps: the first call revokes, a later one is a no-op.
    let revoked = false;
    w.sb.on("POST", "/rest/v1/rpc/prepayment_for_payment_intent", () => "cs_prepay_1");
    w.sb.on("POST", "/rest/v1/rpc/revoke_prepayment", () => {
      if (revoked) return { outcome: "noop" };
      revoked = true;
      return { outcome: "revoked", company_id: COMPANY_ID };
    });
    const updates: unknown[] = [];
    const stripeApi = {
      subscriptions: {
        retrieve: vi.fn(async () => ({
          id: "sub_1",
          schedule: null,
          items: {
            data: [{ id: "si_licensed", price: { id: env.STRIPE_STARTER_PRICE_ID }, discounts: [] }],
          },
        })),
        update: vi.fn(async (_id: string, params: unknown) => {
          updates.push(params);
          return {};
        }),
      },
    };
    const stripeModule = await import("./stripe");
    const spy = vi.spyOn(stripeModule, "getStripe").mockReturnValue(stripeApi as never);
    try {
      stubFetch(...w.routes);
      const lost = dispute({ status: "lost" });

      await handleChargeDispute(env, lost, "charge.dispute.closed");
      expect(updates).toHaveLength(1);

      await handleChargeDispute(env, lost, "charge.dispute.closed");
      expect(updates, "the coupon was cleared a second time").toHaveLength(1);
      expect(stripeApi.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("sends nothing when the dispute is merely closing", async () => {
    // The notice went out when it opened. A second one saying it finished is
    // noise on a channel that has to stay believable.
    const w = world();
    stubFetch(...w.routes);

    await handleChargeDispute(env, dispute({ status: "won" }), "charge.dispute.closed");

    expect(w.rpcCalls[0]).toMatchObject({ p_dispute_id: "dp_1" });
    expect(w.rpcCalls[0].p_closed_at).toBeTruthy();
    expect(notices()).toEqual([]);
  });
});
