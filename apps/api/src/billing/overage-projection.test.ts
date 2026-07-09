import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import {
  countResponse,
  endpoint,
  makeHarness,
  type StubEndpoint,
} from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";
import {
  decideOverage,
  extrapolationMultiplier,
  fixedMonthlyCostCents,
  MIN_ELAPSED_DAYS_FOR_WARNING,
  outboundCeiling,
  overageDecision,
  type OverageCompany,
  type PeriodUsage,
  periodTiming,
  projectUsage,
  storageMonthlyCostCents,
} from "./overage-projection";

const env = completeEnv();
const GB = 1024 ** 3;

/** Usage with everything zero, overridable per test. */
function usage(over: Partial<PeriodUsage> = {}): PeriodUsage {
  return {
    outboundSegments: 0,
    inboundSegments: 0,
    voiceSeconds: 0,
    outboundMms: 0,
    egressBytes: 0,
    storageBytes: 0,
    ...over,
  };
}

describe("periodTiming", () => {
  it("derives period + elapsed days from the Stripe window", () => {
    const t = periodTiming(
      "2026-06-01T00:00:00Z",
      "2026-07-01T00:00:00Z",
      new Date("2026-06-16T00:00:00Z"),
    );
    expect(t.periodDays).toBe(30);
    expect(t.elapsedDays).toBe(15);
  });

  it("falls back to a 30-day period when current_period_end is null", () => {
    const t = periodTiming(
      "2026-06-01T00:00:00Z",
      null,
      new Date("2026-06-11T00:00:00Z"),
    );
    expect(t.periodDays).toBe(30);
    expect(t.elapsedDays).toBe(10);
  });
});

describe("extrapolationMultiplier", () => {
  it("scales up early in the period", () => {
    expect(extrapolationMultiplier(30, 15)).toBe(2);
    expect(extrapolationMultiplier(30, 1)).toBe(30);
  });

  it("is ~1 at the end of the period", () => {
    expect(extrapolationMultiplier(30, 30)).toBe(1);
  });

  it("clamps to >= 1 for a stale/overdue period (never scales cost down)", () => {
    expect(extrapolationMultiplier(30, 40)).toBe(1);
  });

  it("never divides by zero at the very start", () => {
    expect(extrapolationMultiplier(30, 0)).toBe(30);
  });
});

describe("outboundCeiling", () => {
  it("is the included allowance times the cap multiplier", () => {
    expect(outboundCeiling("starter", 3)).toBe(1500); // 500 * 3
    expect(outboundCeiling("pro", 3)).toBe(7500); // 2500 * 3
  });

  it("is unbounded when the owner cleared the cap", () => {
    expect(outboundCeiling("starter", null)).toBe(Infinity);
  });
});

describe("projectUsage (per-volume cost + overage revenue)", () => {
  it("prices each extrapolated volume at multiplier 1, no overage under the allowance", () => {
    const u = usage({
      outboundSegments: 400,
      inboundSegments: 1000,
      voiceSeconds: 600, // 10 min
      outboundMms: 20,
      egressBytes: GB,
    });
    // 400*0.85 + 1000*0.7 + 10*1.2 + 20*2.5 + 1*9 = 340 + 700 + 12 + 50 + 9
    expect(projectUsage(u, "starter", 3, 1)).toEqual({
      costCents: 1111,
      overageRevenueGrossCents: 0,
    });
  });

  it("counts FULL outbound cost and the overage revenue past the allowance", () => {
    const u = usage({ outboundSegments: 400 });
    // multiplier 2 -> 800 projected (< 1500 ceiling): full 800*0.85 = 680 cost;
    // overage (800 - 500) * 3c = 900 revenue.
    expect(projectUsage(u, "starter", 3, 2)).toEqual({
      costCents: 680,
      overageRevenueGrossCents: 900,
    });
  });

  it("bounds outbound at the spending-cap ceiling (sending pauses there)", () => {
    const u = usage({ outboundSegments: 1000 });
    // multiplier 2 -> 2000, capped to 1500 ceiling: 1500*0.85 = 1275 cost;
    // overage (1500 - 500) * 3c = 3000 revenue.
    expect(projectUsage(u, "starter", 3, 2)).toEqual({
      costCents: 1275,
      overageRevenueGrossCents: 3000,
    });
  });

  it("is unbounded outbound when the owner cleared the cap", () => {
    const u = usage({ outboundSegments: 1000 });
    expect(projectUsage(u, "starter", null, 2)).toEqual({
      costCents: 1700, // 2000 * 0.85
      overageRevenueGrossCents: 4500, // (2000 - 500) * 3c
    });
  });

  it("caps voice + MMS projections at the cap-and-drop ceilings", () => {
    const u = usage({ voiceSeconds: 12000, outboundMms: 100 });
    // multiplier 3 -> 36000 s / 300 MMS, capped to 18000 s / 150.
    // 18000/60*1.2 + 150*2.5 = 360 + 375.
    expect(projectUsage(u, "starter", 3, 3).costCents).toBe(735);
  });

  it("prices uncapped inbound in full (the real loss driver, no revenue)", () => {
    const u = usage({ inboundSegments: 5000 });
    expect(projectUsage(u, "starter", 3, 2)).toEqual({
      costCents: 7000, // 10000 * 0.7
      overageRevenueGrossCents: 0,
    });
  });
});

describe("storageMonthlyCostCents (stock, not extrapolated)", () => {
  it("prices current stored GB at the monthly storage rate", () => {
    expect(storageMonthlyCostCents(10 * GB)).toBeCloseTo(21, 6); // 10 * 2.1
    expect(storageMonthlyCostCents(0)).toBe(0);
  });
});

describe("fixedMonthlyCostCents", () => {
  it("is number rental plus the US campaign fee when US-enabled", () => {
    expect(fixedMonthlyCostCents({ numbers: 2, usTextingEnabled: true })).toBe(
      2 * 110 + 1000,
    );
  });

  it("drops the campaign fee for a Canada-only company", () => {
    expect(fixedMonthlyCostCents({ numbers: 1, usTextingEnabled: false })).toBe(
      110,
    );
  });
});

describe("overageDecision (pure)", () => {
  const period = {
    periodStart: "2026-06-01T00:00:00Z",
    periodEnd: "2026-07-01T00:00:00Z",
  };
  const midPeriod = new Date("2026-06-16T00:00:00Z"); // 15 days in, multiplier 2
  const STARTER_GROSS = 2900;

  it("flags a high-inbound tenant projected to cost more than they pay", () => {
    const d = overageDecision(
      {
        usage: usage({ inboundSegments: 5000 }),
        plan: "starter",
        overageCapMultiplier: 3,
        numbers: 1,
        usTextingEnabled: true,
        baseRevenueGrossCents: STARTER_GROSS,
        ...period,
      },
      midPeriod,
    );
    // flow 5000*2*0.7 = 7000, fixed 110 + 1000 = 1110, storage 0.
    expect(d.extrapolatedCostCents).toBe(8110);
    expect(d.revenueCents).toBeCloseTo(2771.4, 4); // stripeNet($29), no overage
    expect(d.trendingOver).toBe(true);
  });

  it("does NOT flag a heavy overage-paying 2-way tenant (finding 1 regression)", () => {
    // Cap cleared, so 5000 obs outbound -> 10000 projected all sends. The 9500
    // overage segments bill 9500*3c = $285, which more than covers the cost.
    const d = overageDecision(
      {
        usage: usage({ outboundSegments: 5000, inboundSegments: 3000 }),
        plan: "starter",
        overageCapMultiplier: null,
        numbers: 1,
        usTextingEnabled: true,
        baseRevenueGrossCents: STARTER_GROSS,
        ...period,
      },
      midPeriod,
    );
    // cost: 10000*0.85 + 6000*0.7 + fixed 1110 = 8500 + 4200 + 1110 = 13810.
    expect(d.extrapolatedCostCents).toBe(13810);
    // revenue: stripeNet(2900 + (10000-500)*3) = stripeNet(31400).
    expect(d.revenueCents).toBeCloseTo(31400 * 0.966 - 30, 3);
    expect(d.marginCents).toBeGreaterThan(0);
    expect(d.trendingOver).toBe(false);
  });

  it("stays quiet for a light tenant comfortably inside their revenue", () => {
    const d = overageDecision(
      {
        usage: usage({ inboundSegments: 100, outboundSegments: 200 }),
        plan: "starter",
        overageCapMultiplier: 3,
        numbers: 1,
        usTextingEnabled: true,
        baseRevenueGrossCents: STARTER_GROSS,
        ...period,
      },
      midPeriod,
    );
    expect(d.trendingOver).toBe(false);
    expect(d.marginCents).toBeGreaterThan(0);
  });

  it("never warns before MIN_ELAPSED_DAYS, however alarming the projection", () => {
    const dayOne = new Date("2026-06-01T12:00:00Z"); // 0.5 days in
    const d = overageDecision(
      {
        usage: usage({ inboundSegments: 100000 }),
        plan: "starter",
        overageCapMultiplier: 3,
        numbers: 1,
        usTextingEnabled: true,
        baseRevenueGrossCents: STARTER_GROSS,
        ...period,
      },
      dayOne,
    );
    expect(d.elapsedDays).toBeLessThan(MIN_ELAPSED_DAYS_FOR_WARNING);
    expect(d.trendingOver).toBe(false);
    expect(d.extrapolatedCostCents).toBeGreaterThan(d.revenueCents);
  });

  it("uses the stale-period fail-safe: an overdue period does not shrink cost", () => {
    const overdue = new Date("2026-07-11T00:00:00Z"); // 40 days in, period 30
    const d = overageDecision(
      {
        usage: usage({ inboundSegments: 5000 }),
        plan: "starter",
        overageCapMultiplier: 3,
        numbers: 1,
        usTextingEnabled: true,
        baseRevenueGrossCents: STARTER_GROSS,
        ...period,
      },
      overdue,
    );
    // multiplier clamped to 1: flow 5000*0.7 = 3500 (NOT 5000*0.75).
    expect(d.extrapolatedCostCents).toBe(3500 + 1110);
    expect(d.trendingOver).toBe(true);
  });
});

describe("decideOverage (DB orchestrator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const company: OverageCompany = {
    id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    plan: "starter",
    current_period_start: "2026-06-01T00:00:00Z",
    current_period_end: "2026-07-01T00:00:00Z",
    us_texting_enabled: true,
    overage_cap_multiplier: 3,
  };

  function endpoints(
    over: Partial<PeriodUsage> & { numbers?: number },
  ): StubEndpoint[] {
    const u = usage(over);
    return [
      endpoint("POST", /\/rpc\/api_period_segments/, () => u.outboundSegments),
      endpoint(
        "POST",
        /\/rpc\/api_period_inbound_segments/,
        () => u.inboundSegments,
      ),
      endpoint("POST", /\/rpc\/api_period_voice_seconds/, () => u.voiceSeconds),
      endpoint("POST", /\/rpc\/api_period_outbound_mms/, () => u.outboundMms),
      endpoint("POST", /\/rpc\/api_period_egress_bytes/, () => u.egressBytes),
      endpoint("POST", /\/rpc\/api_storage_usage/, () => ({
        attachments_bytes: 0,
        mms_bytes: u.storageBytes,
      })),
      endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () =>
        countResponse(over.numbers ?? 1),
      ),
      endpoint("GET", /\/rest\/v1\/company_modules/, () => []),
    ];
  }

  it("reads the six RPCs + numbers + revenue and returns the decision", async () => {
    const harness = makeHarness(
      endpoints({
        outboundSegments: 400,
        inboundSegments: 1000,
        voiceSeconds: 600,
        outboundMms: 20,
        egressBytes: GB,
        numbers: 1,
      }),
    );
    stubFetch(harness.route);
    const db = getDb(env);

    const d = await decideOverage(
      db,
      company,
      new Date("2026-06-16T00:00:00Z"), // 15 days in, multiplier 2
    );

    // flow @ x2: min(800,1500)*0.85 + 2000*0.7 + 20*1.2 + 40*2.5 + 2*9
    //          = 680 + 1400 + 24 + 100 + 18 = 2222; + fixed (110 + 1000) = 3332.
    expect(d.extrapolatedCostCents).toBe(3332);
    // revenue: stripeNet(2900 + (800-500)*3 = 900) = stripeNet(3800).
    expect(d.revenueCents).toBeCloseTo(3800 * 0.966 - 30, 3);
    expect(d.marginCents).toBeCloseTo(3800 * 0.966 - 30 - 3332, 3);
  });

  it("stays quiet for a quiet company", async () => {
    const harness = makeHarness(endpoints({ inboundSegments: 50, numbers: 1 }));
    stubFetch(harness.route);
    const db = getDb(env);
    const d = await decideOverage(db, company, new Date("2026-06-16T00:00:00Z"));
    expect(d.trendingOver).toBe(false);
    expect(d.marginCents).toBeGreaterThan(0);
  });
});
