import { describe, expect, it, vi } from "vitest";

import { MODULE_CATALOG } from "./modules";
import { PLAN_MMS_INCLUDED, PLAN_VOICE_MINUTES } from "./plans";
import {
  companyRevenueCents,
  FIXED_MONTHLY_COST_CENTS,
  PLAN_MONTHLY_REVENUE_CENTS,
  stripeNetCents,
  UNIT_COST_CENTS,
} from "./costs";

describe("UNIT_COST_CENTS matches the audited provider basis (PRICING-AUDIT §4)", () => {
  it("encodes the high end of each cost range in cents", () => {
    expect(UNIT_COST_CENTS.outboundSegment).toBe(0.85); // $0.007–0.0085, high end
    expect(UNIT_COST_CENTS.inboundSegment).toBe(0.7); // SPEC §2 COGS ~0.7¢
    expect(UNIT_COST_CENTS.outboundMms).toBe(2.5); // $0.015 + up to $0.01 carrier
    expect(UNIT_COST_CENTS.inboundMms).toBe(0.5); // $0.005 receive
    expect(UNIT_COST_CENTS.voiceMinute).toBe(1.2); // ~$0.012 both legs, high end
    expect(UNIT_COST_CENTS.storageGbMonth).toBe(2.1); // $0.021/GB/mo
    expect(UNIT_COST_CENTS.egressGb).toBe(9); // $0.09/GB
  });

  // The cost table must agree with the margin math already written beside the
  // module caps — if a cost is retuned here without updating those, this breaks.
  it("reproduces the documented voice/MMS/egress margin arithmetic", () => {
    // plans.ts:69 — "300 × $0.012 = $3.60" is the max voice cost per period.
    expect(PLAN_VOICE_MINUTES.starter * UNIT_COST_CENTS.voiceMinute).toBe(360);
    // plans.ts:91 — "150 × $0.025 = $3.75" is the max MMS cost per period.
    expect(PLAN_MMS_INCLUDED.starter * UNIT_COST_CENTS.outboundMms).toBe(375);
    // egress.ts:41 — "200 GB × $0.09/GB ≈ $18" is the worst-case Pro egress.
    expect(200 * UNIT_COST_CENTS.egressGb).toBe(1800);
  });
});

describe("fixed per-company monthly cost", () => {
  it("is number rental plus the US 10DLC campaign fee, in cents", () => {
    expect(FIXED_MONTHLY_COST_CENTS.perNumber).toBe(110); // $1 rental + $0.10 SMS cap
    expect(FIXED_MONTHLY_COST_CENTS.us10dlcCampaign).toBe(1000); // $10/mo, high end
  });
});

describe("PLAN_MONTHLY_REVENUE_CENTS mirrors SPEC §2 plan prices", () => {
  it("is $29 Starter / $79 Pro in cents", () => {
    expect(PLAN_MONTHLY_REVENUE_CENTS.starter).toBe(2900);
    expect(PLAN_MONTHLY_REVENUE_CENTS.pro).toBe(7900);
  });
});

describe("stripeNetCents", () => {
  it("takes 2.9% + 0.5% plus $0.30 off a monthly charge", () => {
    // $79 gross: 7900 × (1 - 0.034) - 30 = 7900 × 0.966 - 30 = 7631.4 - 30.
    expect(stripeNetCents(7900)).toBeCloseTo(7601.4, 5);
    // $29 gross.
    expect(stripeNetCents(2900)).toBeCloseTo(2900 * 0.966 - 30, 5);
  });

  it("never returns a negative net (a tiny charge can't owe Stripe money here)", () => {
    expect(stripeNetCents(10)).toBe(0);
    expect(stripeNetCents(0)).toBe(0);
  });
});

describe("companyRevenueCents", () => {
  it("is the plan price with no modules enabled", () => {
    expect(companyRevenueCents("starter", [])).toBe(2900);
    expect(companyRevenueCents("pro", [])).toBe(7900);
  });

  it("adds each enabled module's catalog price", () => {
    const mms = MODULE_CATALOG.mms.monthlyCents; // 500
    const voice = MODULE_CATALOG.voice.monthlyCents; // 800
    expect(companyRevenueCents("pro", ["mms", "voice"])).toBe(7900 + mms + voice);
    expect(companyRevenueCents("starter", ["extra_storage"])).toBe(
      2900 + MODULE_CATALOG.extra_storage.monthlyCents,
    );
  });
});

describe("companyMonthlyRevenueCents (DB helper)", () => {
  it("reads enabled modules and sums them onto the plan price", async () => {
    vi.resetModules();
    vi.doMock("./company-modules", () => ({
      enabledModules: vi.fn().mockResolvedValue(["voice"]),
    }));
    const { companyMonthlyRevenueCents } = await import("./costs");
    const db = {} as never;
    await expect(companyMonthlyRevenueCents(db, "company-1", "pro")).resolves.toBe(
      7900 + MODULE_CATALOG.voice.monthlyCents,
    );
    vi.doUnmock("./company-modules");
    vi.resetModules();
  });
});
