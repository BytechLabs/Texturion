import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Usage } from "@/lib/api/types";

// Hoisted mock state the hooks read; each test seeds it before rendering.
const state: { usage: Usage; role: string } = {
  usage: null as unknown as Usage,
  role: "owner",
};

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
  useActiveCompany: () => ({ role: state.role }),
}));

import UsageSettingsPage from "./page";

function baseUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    status: "quiet",
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
      attachment_budget_bytes: 0,
      mms_budget_bytes: 0,
    },
    voice: {
      used_minutes: 0,
      included_minutes: 2500,
      cap_minutes: 7500,
      overage_minutes: 0,
      projected_overage_cents: 0,
      overage_billed: true,
    },
    ...overrides,
  };
}

function render(usage: Usage, role = "owner"): string {
  state.usage = usage;
  state.role = role;
  return renderToStaticMarkup(<UsageSettingsPage />);
}

/**
 * #178 'quiet' — the overwhelming default. The page is one calm fair-use line
 * plus the policy link and the owner's spending cap. NO meters, NO "X of Y",
 * NO progress bars anywhere; the raw numbers exist only inside the collapsed
 * details affordance.
 */
describe("/settings/usage quiet status (#178)", () => {
  beforeEach(() => {
    state.usage = null as unknown as Usage;
    state.role = "owner";
  });

  it("shows the calm fair-use line and the policy link, never a meter", () => {
    const html = render(baseUsage());
    expect(html).toContain("Well within fair use this month.");
    expect(html).toContain("/legal/fair-use");
    // The walls are gone in every status: no meter roles, no progress bars.
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain("included messages used");
  });

  it("keeps the numbers behind the details affordance, collapsed by default", () => {
    const html = render(baseUsage());
    // Native <details> without the open attribute = collapsed by default.
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Show the numbers");
    // The raw figures render only inside that collapsed details block.
    expect(html).toContain("Sending pauses at");
    expect(html).toContain("1,500");
  });

  it("hides the details affordance from non-owners (owner-facing numbers)", () => {
    const html = render(baseUsage(), "member");
    expect(html).not.toContain("Show the numbers");
    expect(html).not.toContain("<details");
    // The calm line and the read-only cap state still render.
    expect(html).toContain("Well within fair use this month.");
    expect(html).toContain("Spending cap");
  });

  it("keeps the spending cap reachable, framed as protection, not a quota", () => {
    const html = render(baseUsage());
    expect(html).toContain("Spending cap");
    expect(html).toContain("A spending cap you control");
    expect(html).not.toContain("Overage cap");
  });
});

/**
 * #178 'pacing' — the early, specific warning: which meter is running hot
 * (used vs included), the projected extra charges, and the cap as protection.
 */
describe("/settings/usage pacing status (#178)", () => {
  beforeEach(() => {
    state.usage = null as unknown as Usage;
    state.role = "owner";
  });

  it("names messages when the message meter is the hot one, with the projection", () => {
    const html = render(
      baseUsage({
        status: "pacing",
        used_segments: 480,
        overage_projection: {
          trending_over: true,
          projected_overage_cents: 4200,
        },
      }),
    );
    expect(html).toContain("messages are pacing past what your plan covers");
    expect(html).toContain("480");
    expect(html).toContain("500");
    expect(html).toContain("$42.00");
    expect(html).toContain("spending cap");
    expect(html).not.toContain("Well within fair use");
  });

  it("names calling minutes when the voice meter is the hot one", () => {
    const html = render(
      baseUsage({
        status: "pacing",
        used_segments: 100,
        voice: {
          used_minutes: 2300,
          included_minutes: 2500,
          cap_minutes: 7500,
          overage_minutes: 0,
          projected_overage_cents: 0,
          overage_billed: true,
        },
        overage_projection: {
          trending_over: true,
          projected_overage_cents: 900,
        },
      }),
    );
    expect(html).toContain(
      "calling minutes are pacing past what your plan covers",
    );
    expect(html).toContain("2,300");
    expect(html).toContain("2,500");
    expect(html).toContain("$9.00");
  });

  it("names both when both meters run hot", () => {
    const html = render(
      baseUsage({
        status: "pacing",
        used_segments: 450,
        voice: {
          used_minutes: 2200,
          included_minutes: 2500,
          cap_minutes: 7500,
          overage_minutes: 0,
          projected_overage_cents: 0,
          overage_billed: true,
        },
        overage_projection: {
          trending_over: true,
          projected_overage_cents: 4200,
        },
      }),
    );
    expect(html).toContain(
      "messages and calling minutes are pacing past what your plan covers",
    );
  });

  it("stays honest without a dollar figure when the projection has no charge", () => {
    const html = render(
      baseUsage({
        status: "pacing",
        used_segments: 480,
        overage_projection: { trending_over: true, projected_overage_cents: 0 },
      }),
    );
    expect(html).toContain("runs past what your plan includes");
    expect(html).not.toContain("$0.00");
  });
});

/**
 * #178 'capped' — the owner-set cap is approaching (>=90%) or reached. The
 * page states how close, what pauses at the cap, and keeps the owner control.
 */
describe("/settings/usage capped status (#178)", () => {
  beforeEach(() => {
    state.usage = null as unknown as Usage;
    state.role = "owner";
  });

  it("states how close when approaching the cap on messages", () => {
    const html = render(
      baseUsage({ status: "capped", used_segments: 1400, cap_segments: 1500 }),
    );
    expect(html).toContain("getting close to your spending cap");
    expect(html).toContain("93%");
    expect(html).toContain("sending pauses instead of billing further");
    expect(html).toContain("Incoming texts still arrive");
  });

  it("states the pause plainly when the message cap is reached", () => {
    const html = render(
      baseUsage({
        status: "capped",
        used_segments: 1500,
        cap_segments: 1500,
        overage_segments: 1000,
        projected_overage_cents: 1000,
      }),
    );
    expect(html).toContain("Your spending cap is doing its job");
    expect(html).toContain("Sending is paused");
    expect(html).toContain("Incoming texts still arrive");
    expect(html).toContain("Nothing bills past the cap");
  });

  it("states the calling pause and the text-back when the voice cap is hit", () => {
    const html = render(
      baseUsage({
        status: "capped",
        voice: {
          used_minutes: 7500,
          included_minutes: 2500,
          cap_minutes: 7500,
          overage_minutes: 5000,
          projected_overage_cents: 5000,
          overage_billed: true,
        },
      }),
    );
    expect(html).toContain("Your spending cap is doing its job");
    expect(html).toContain("Calling is paused");
    expect(html).toContain("text-back");
  });

  it("keeps the owner cap control reachable at the cap", () => {
    const html = render(
      baseUsage({ status: "capped", used_segments: 1500, cap_segments: 1500 }),
    );
    expect(html).toContain("A spending cap you control");
    expect(html).toContain('aria-label="Spending cap"');
  });
});

/**
 * #178 details affordance — the only home for raw numbers, history bars, and
 * storage lines, in every status. #42 still holds inside it: a null
 * cap_segments resolves to the 10x hard ceiling, never "sending never pauses".
 */
describe("/settings/usage details content", () => {
  beforeEach(() => {
    state.usage = null as unknown as Usage;
    state.role = "owner";
  });

  it("carries the period figures: messages, overage so far, calling, inbound", () => {
    const html = render(
      baseUsage({
        used_segments: 520,
        inbound_segments: 38,
        overage_segments: 20,
        projected_overage_cents: 60,
        voice: {
          used_minutes: 120,
          included_minutes: 2500,
          cap_minutes: 7500,
          overage_minutes: 0,
          projected_overage_cents: 0,
          overage_billed: true,
        },
      }),
    );
    expect(html).toContain("520");
    expect(html).toContain("$0.60");
    expect(html).toContain("38");
    expect(html).toContain("always free");
    expect(html).toContain("included minutes used");
    expect(html).toContain("Calling pauses at");
    expect(html).toContain("7,500");
  });

  it("names the 10x maximum, never 'sending never pauses', when cap_segments is null (#42)", () => {
    const html = render(baseUsage({ cap_segments: null }));
    expect(html).toContain("Sending pauses at");
    // 10x the 500 included = 5,000, the hard ceiling.
    expect(html).toContain("5,000");
    expect(html).toContain(
      "the maximum, which is 10 times your included messages",
    );
    expect(html).not.toContain("never pauses");
  });

  it("keeps storage as plain free-of-caps lines, never a budget (#121)", () => {
    const html = render(
      baseUsage({
        storage: {
          attachments_bytes: 1024 * 1024,
          mms_bytes: 5 * 1024 * 1024,
          attachment_budget_bytes: 0,
          mms_budget_bytes: 0,
        },
      }),
    );
    expect(html).toContain("Free on every plan, no caps");
    expect(html).toContain("1 MB");
    expect(html).toContain("5 MB");
    expect(html).not.toContain("of your storage");
  });

  it("moves the 6-month history bars behind details", () => {
    const html = render(
      baseUsage({
        history: [
          { month: "2026-02", segments: 0 },
          { month: "2026-03", segments: 210 },
        ],
      }),
    );
    expect(html).toContain("Last 6 months");
    expect(html).toContain("210");
    // Still inside the collapsed details element, before any card markup.
    expect(html.indexOf("<details")).toBeLessThan(
      html.indexOf("Last 6 months"),
    );
  });
});

/** Acceptance guard: no em dashes in any user-facing copy, in any status. */
describe("/settings/usage copy hygiene (#178)", () => {
  beforeEach(() => {
    state.usage = null as unknown as Usage;
    state.role = "owner";
  });

  it("renders no em dashes in quiet, pacing, or capped", () => {
    for (const usage of [
      baseUsage(),
      baseUsage({
        status: "pacing",
        used_segments: 480,
        overage_projection: {
          trending_over: true,
          projected_overage_cents: 4200,
        },
      }),
      baseUsage({ status: "capped", used_segments: 1500, cap_segments: 1500 }),
    ]) {
      expect(render(usage)).not.toContain("—");
    }
  });
});
