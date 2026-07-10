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
    voice: { used_minutes: 0, included_minutes: 0 },
    mms: { used_messages: 0, included_messages: 0 },
    ...overrides,
  };
}

function render(usage: Usage): string {
  state.usage = usage;
  return renderToStaticMarkup(<UsageSettingsPage />);
}

/**
 * Finding 8: the usage page no longer renders the abolished "No cap / sending
 * never pauses" state. A 10× hard ceiling ALWAYS applies (#42), so the
 * cap-status line must always name a real pause point.
 */
describe("/settings/usage cap status", () => {
  beforeEach(() => {
    state.usage = null as unknown as Usage;
  });

  it("shows the concrete pause point when a cap multiplier is set", () => {
    const html = render(baseUsage({ cap_segments: 1500 }));
    expect(html).toContain("Sending pauses at");
    expect(html).toContain("1,500");
  });

  it("names the 10× maximum, never 'sending never pauses', when cap_segments is null", () => {
    const html = render(
      baseUsage({ cap_segments: null, included_segments: 500 }),
    );
    expect(html).toContain("Sending pauses at");
    // 10× the 500 included = 5,000, the hard ceiling.
    expect(html).toContain("5,000");
    expect(html).toContain("the maximum, which is 10 times your included messages");
  });

  it("carries no abolished uncapped copy in either cap state", () => {
    for (const capped of [1500, null]) {
      const html = render(baseUsage({ cap_segments: capped }));
      expect(html).not.toContain("never pauses");
      expect(html).not.toContain("No cap");
      expect(html).not.toContain("billed as you go");
    }
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
