import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Usage } from "@/lib/api/types";

// Hoisted mock state the hooks read; each test seeds it before rendering.
const state: { usage: Usage } = { usage: null as unknown as Usage };

vi.mock("@/lib/api/usage", () => ({
  useUsage: () => ({
    isPending: false,
    isError: false,
    data: state.usage,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({
    isPending: false,
    isError: false,
    data: { overage_cap_multiplier: 3 },
    refetch: vi.fn(),
  }),
  useUpdateCompany: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: "owner" }),
}));

import UsageSettingsPage from "./page";

function baseUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    period_start: "2026-07-01T00:00:00Z",
    period_end: "2026-07-31T00:00:00Z",
    included_segments: 500,
    used_segments: 120,
    inbound_segments: 0,
    overage_segments: 0,
    cap_segments: 1500,
    projected_overage_cents: 0,
    overage_projection: { trending_over: false, projected_overage_cents: 0 },
    history: [],
    storage: {
      attachments_bytes: 0,
      mms_bytes: 0,
      attachment_budget_bytes: 1024 ** 3,
      mms_budget_bytes: 1024 ** 3,
    },
    voice: {
      used_minutes: 0,
      included_minutes: 0,
      cap_minutes: null,
      overage_minutes: 0,
      projected_overage_cents: 0,
      overage_billed: true,
    },
    ...overrides,
  };
}

function render(usage: Usage): string {
  state.usage = usage;
  return renderToStaticMarkup(<UsageSettingsPage />);
}

/** #85/#95: the "of N" meter only renders when trending over; these tests that
 *  exercise the PeriodMeter's pause-point copy render in that state. */
const TRENDING = {
  overage_projection: { trending_over: true, projected_overage_cents: 0 },
} as const;

/**
 * Finding 8: the usage page no longer renders the abolished "No cap / sending
 * never pauses" state. A 10× hard ceiling ALWAYS applies (#42), so the
 * cap-status line must always name a real pause point.
 */
describe("/settings/usage cap status", () => {
  beforeEach(() => {
    state.usage = null as unknown as Usage;
  });

  it("shows the concrete pause point in the meter when trending over", () => {
    const html = render(baseUsage({ cap_segments: 1500, ...TRENDING }));
    expect(html).toContain("Sending pauses at");
    expect(html).toContain("1,500");
  });

  it("names the 10× maximum, never 'sending never pauses', when cap_segments is null", () => {
    const html = render(
      baseUsage({ cap_segments: null, included_segments: 500, ...TRENDING }),
    );
    expect(html).toContain("Sending pauses at");
    // 10× the 500 included = 5,000, the hard ceiling.
    expect(html).toContain("5,000");
    expect(html).toContain("the maximum, which is 10 times your included messages");
  });

  it("carries no abolished uncapped copy in either cap state", () => {
    for (const capped of [1500, null]) {
      const html = render(baseUsage({ cap_segments: capped, ...TRENDING }));
      expect(html).not.toContain("never pauses");
      expect(html).not.toContain("No cap");
      expect(html).not.toContain("billed as you go");
    }
  });

  it("keeps the spending cap reachable even when usage is quiet (#95)", () => {
    // The meters hide when within plan, but the cap control + its current-cap
    // line must always stay reachable — never leave a customer unable to cap.
    const html = render(baseUsage()); // quiet
    expect(html).toContain("Overage cap");
    expect(html).toContain("messages per period");
  });
});

/**
 * D36: the voice meter speaks the fair-use billing story — extra minutes bill
 * at 1¢ each up to the spending cap, where forwarding pauses. The old
 * pause-at-allowance promise ("new calls aren't forwarded" the moment the
 * included minutes run out) must be gone.
 */
describe("/settings/usage voice meter (D36)", () => {
  beforeEach(() => {
    state.usage = null as unknown as Usage;
  });

  const heavyVoice = {
    used_minutes: 2600,
    included_minutes: 2500,
    cap_minutes: 7500,
    overage_minutes: 100,
    projected_overage_cents: 100,
    overage_billed: true,
  };

  it("states the 1¢/min overage, the cap pause point, and the overage so far", () => {
    const html = render(baseUsage({ voice: heavyVoice, ...TRENDING }));
    expect(html).toContain("2,600");
    expect(html).toContain("2,500");
    expect(html).toContain("100 extra at 1¢ each");
    expect(html).toContain("bill at 1¢ each");
    expect(html).toContain("spending cap (7,500 min)");
    expect(html).toContain("calling pauses");
    expect(html).toContain("missed-call text");
    // D38: the meter names BOTH directions, never just forwarding.
    expect(html).toContain("calls you place from the app");
  });

  it("#133 grandfathered: promises the pause, never a 1¢ charge", () => {
    const html = render(
      baseUsage({
        voice: {
          used_minutes: 250,
          included_minutes: 300,
          cap_minutes: 300,
          overage_minutes: 0,
          projected_overage_cents: 0,
          overage_billed: false,
        },
      }),
    );
    expect(html).toContain("Calling");
    expect(html).toContain("300");
    expect(html).toContain("nothing extra is ever billed");
    expect(html).not.toContain("1¢");
  });

  it("never claims calls stop forwarding at the allowance", () => {
    const html = render(baseUsage({ voice: heavyVoice, ...TRENDING }));
    expect(html).not.toContain("aren't forwarded");
    expect(html).not.toContain("phone bill can't run past your plan");
  });

  it("#133: ANY calling activity shows the meter (there is no other place to see minutes)", () => {
    const html = render(
      baseUsage({
        voice: {
          used_minutes: 10,
          included_minutes: 2500,
          cap_minutes: 7500,
          overage_minutes: 0,
          projected_overage_cents: 0,
          overage_billed: true,
        },
      }),
    );
    expect(html).toContain("included calling minutes used");
  });

  it("stays hidden with zero calling activity", () => {
    const html = render(
      baseUsage({
        voice: {
          used_minutes: 0,
          included_minutes: 2500,
          cap_minutes: 7500,
          overage_minutes: 0,
          projected_overage_cents: 0,
          overage_billed: true,
        },
      }),
    );
    expect(html).not.toContain("included calling minutes used");
  });
});

/**
 * #85/#95: the detailed "of N" limit meters are hidden while usage is
 * comfortably within plan (the fair-use posture) and surface only when the
 * dynamic projection is trending over.
 */
describe("/settings/usage limit-meter gating (#95)", () => {
  beforeEach(() => {
    state.usage = null as unknown as Usage;
  });

  it("stays calm within plan: plain counts, no of-N meter or storage bars", () => {
    const html = render(baseUsage({ used_segments: 120 })); // quiet
    expect(html).toContain("messages sent this period");
    expect(html).toContain("comfortably within your plan");
    expect(html).not.toContain("included messages used"); // PeriodMeter of-N
    expect(html).not.toContain("Files on notes"); // StorageMeter
  });

  it("surfaces the of-N meter when trending over, never storage (#121)", () => {
    const html = render(baseUsage({ used_segments: 480, ...TRENDING }));
    expect(html).toContain("included messages used");
    // #121: storage is free and capless — no storage card even when trending.
    expect(html).not.toContain("Files on notes");
    expect(html).not.toContain("comfortably within your plan");
  });

  it("surfaces a resource meter when NEAR its own limit, even if calm on cost", () => {
    // 450 of 500 = 90%, past the 80% static-alert threshold, so the message
    // meter shows even though the tenant is not trending over on cost — the
    // warning email never points at a hidden meter.
    const html = render(baseUsage({ used_segments: 450 })); // trending false
    expect(html).toContain("included messages used");
    expect(html).not.toContain("comfortably within your plan");
  });

  it("renders no storage card at any fill level (#121: storage is free)", () => {
    const budget = 1024 ** 3;
    const html = render(
      baseUsage({
        storage: {
          attachments_bytes: Math.round(budget * 0.9),
          mms_bytes: 0,
          attachment_budget_bytes: budget,
          mms_budget_bytes: budget,
        },
      }),
    ); // even at 90% of the (dying) budget fields, nothing renders
    expect(html).not.toContain("Files on notes");
    expect(html).not.toContain("Storage");
  });
});

/**
 * #85/#93: the overage heads-up is shown ONLY when the dynamic projection says
 * the tenant is trending over what they pay — the fair-use "quiet unless it
 * matters" posture. When it shows, it names the projected extra charge and
 * points at the spending cap.
 */
describe("/settings/usage overage projection notice", () => {
  beforeEach(() => {
    state.usage = null as unknown as Usage;
  });

  it("stays hidden when the tenant is not trending over", () => {
    const html = render(
      baseUsage({
        overage_projection: { trending_over: false, projected_overage_cents: 4200 },
      }),
    );
    expect(html).not.toContain("on track to go past what your plan covers");
  });

  it("surfaces the projected extra charge and the cap when trending over", () => {
    const html = render(
      baseUsage({
        overage_projection: { trending_over: true, projected_overage_cents: 4200 },
      }),
    );
    expect(html).toContain("on track to go past what your plan covers");
    expect(html).toContain("$42.00");
    expect(html).toContain("spending cap");
  });

  it("omits the dollar figure when there is no projected overage charge", () => {
    const html = render(
      baseUsage({
        overage_projection: { trending_over: true, projected_overage_cents: 0 },
      }),
    );
    expect(html).toContain("on track to go past what your plan covers");
    expect(html).toContain("running higher than usual");
  });
});
