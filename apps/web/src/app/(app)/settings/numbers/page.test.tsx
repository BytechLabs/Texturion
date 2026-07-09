import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CompanyView, PhoneNumberSummary } from "@/lib/api/types";

/**
 * #74: a plan-included number can be (re)provisioned in-app whenever a slot is
 * open — the fix for a Starter who releases their only number and was otherwise
 * stranded (the old affordance was Pro-only). These tests pin the page's gating
 * logic: which affordance/empty-state renders for each plan × slot state. The
 * heavy child sections are stubbed so the assertions are about the gate alone.
 */
const state = {
  role: "owner" as "owner" | "admin" | "member",
  company: null as unknown as CompanyView,
  numbers: [] as PhoneNumberSummary[],
};

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: state.role }),
}));
vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({
    isPending: false,
    isError: false,
    data: state.company,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/api/numbers", () => ({
  useNumbers: () => ({
    isPending: false,
    isError: false,
    data: { data: state.numbers, next_cursor: null },
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/api/porting", () => ({
  usePortRequests: () => ({ isPending: false, data: { data: [] } }),
}));
vi.mock("@/components/settings/number-card", () => ({
  NumberCard: ({ number }: { number: PhoneNumberSummary }) => (
    <div>card:{number.status}</div>
  ),
}));
vi.mock("@/components/settings/provision-number-dialog", () => ({
  ProvisionNumberDialog: () => <button type="button">Add a number</button>,
}));
vi.mock("@/components/settings/port-section", () => ({
  PortSection: () => null,
}));
vi.mock("@/components/settings/text-enable-section", () => ({
  TextEnableSection: () => null,
}));
vi.mock("@/components/settings/registration-section", () => ({
  RegistrationSection: () => null,
}));

import NumbersSettingsPage from "./page";

function company(overrides: Partial<CompanyView> = {}): CompanyView {
  return {
    plan: "starter",
    subscription_status: "active",
    country: "US",
    ...overrides,
  } as unknown as CompanyView;
}

function activeNumber(): PhoneNumberSummary {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    status: "active",
    number_e164: "+12125550100",
    country: "US",
    requested_area_code: null,
    source: "provisioned",
    created_at: "2026-07-01T00:00:00Z",
  } as unknown as PhoneNumberSummary;
}

const render = () => renderToStaticMarkup(<NumbersSettingsPage />);

beforeEach(() => {
  state.role = "owner";
  state.company = company();
  state.numbers = [];
});

describe("/settings/numbers provisioning affordance (#74)", () => {
  it("lets an active Starter with an open slot get a number (release dead-end fix)", () => {
    state.company = company({ plan: "starter", subscription_status: "active" });
    state.numbers = []; // released their only number → no non-released rows
    const html = render();
    expect(html).toContain("Add a number");
    expect(html).toContain("included in your plan");
    // The misleading "created automatically" line is gone once a slot is open.
    expect(html).not.toContain("created automatically");
  });

  it("hides the affordance for a Starter already at its 1-number limit", () => {
    state.company = company({ plan: "starter", subscription_status: "active" });
    state.numbers = [activeNumber()];
    const html = render();
    expect(html).not.toContain("Add a number");
  });

  it("shows the 'created automatically' note before the subscription is active", () => {
    state.company = company({
      plan: "starter",
      subscription_status: "incomplete",
    });
    state.numbers = [];
    const html = render();
    expect(html).toContain("created automatically");
    expect(html).not.toContain("Add a number");
  });

  it("offers Pro its second number when one slot is used", () => {
    state.company = company({ plan: "pro", subscription_status: "active" });
    state.numbers = [activeNumber()];
    const html = render();
    expect(html).toContain("Add a number");
    expect(html).toContain("Pro includes a second number");
  });

  it("hides the affordance from non-managers (members)", () => {
    state.role = "member";
    state.company = company({ plan: "starter", subscription_status: "active" });
    state.numbers = [];
    const html = render();
    expect(html).not.toContain("Add a number");
  });
});
