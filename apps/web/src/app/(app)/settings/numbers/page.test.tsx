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

/** #523: was the held-numbers route enabled, and what did it answer. */
const held = vi.hoisted(() => ({
  asked: false,
  data: undefined as unknown,
}));

// #301: the numbers page now mounts the lead-source list. Mocked like every
// other data hook here — this file's subject is the number cards, and the
// source card has its own suite.
vi.mock("@/lib/api/lead-sources", () => ({
  useLeadSources: () => ({ data: { data: [] } }),
  useCreateLeadSource: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateLeadSource: () => ({ isPending: false, mutateAsync: vi.fn() }),
  activeSources: () => [],
}));

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: state.role }),
  // #286: the page now mounts the member's own access card, which reads the
  // company id from here.
  useCompanyId: () => "c-1",
}));
// #286: the card has its own suite; this file's subject is the number list.
vi.mock("@/components/settings/my-access-card", () => ({
  MyAccessCard: () => null,
}));
vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({
    isPending: false,
    isError: false,
    data: state.company,
    refetch: vi.fn(),
  }),
  // #232: the widget card asks for its key only once somebody opens it, so on
  // this page it never resolves. Stubbed pending, which is the state these
  // tests actually render it in.
  useWidgetKey: () => ({ isPending: true, isError: false, data: undefined }),
  useRotateWidgetKey: () => ({ isPending: false, mutate: vi.fn() }),
  // #232 phase 3: the widget card's line picker writes through the ordinary
  // company patch. It only renders once the card is opened, which these tests
  // never do — but the module has to export it or the mock refuses to load.
  useUpdateCompany: () => ({ isPending: false, mutate: vi.fn() }),
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
/**
 * #523: the page asks WHY a suspended number is suspended — but only when it
 * has one and only when the reader can read the billing route at all. `asked`
 * records the enablement flag so that discipline is assertable rather than
 * assumed; the route is an authenticated billing read, and a healthy workspace
 * must never spend it.
 */
vi.mock("@/lib/api/billing", () => ({
  useHeldNumbers: (enabled: boolean) => {
    held.asked = enabled;
    return { data: held.data };
  },
}));
/**
 * #523: the card is stubbed (its copy has its own suites) but its props are
 * recorded — `subscriptionActive` is half the release rule and defaults FALSE,
 * so forgetting to pass it does not fail loudly, it silently withholds the
 * release control from every held number on the screen.
 */
const numberCard = vi.hoisted(() => ({
  props: [] as { subscriptionActive?: boolean }[],
}));
vi.mock("@/components/settings/number-card", () => ({
  NumberCard: (props: {
    number: PhoneNumberSummary;
    subscriptionActive?: boolean;
  }) => {
    numberCard.props.push(props);
    return <div>card:{props.number.status}</div>;
  },
}));
vi.mock("@/components/settings/provision-number-dialog", () => ({
  ProvisionNumberDialog: () => <button type="button">Add a number</button>,
}));
/**
 * #523: the port section is the ONLY card a transferred-in number gets, so it
 * has to be handed the numbers list and the billing answer or a held ported
 * line has nowhere to be explained. Recorded rather than rendered — the card's
 * own copy has its own suite; what this file owns is the wiring.
 */
const portSection = vi.hoisted(() => ({
  props: null as { numbers?: unknown[]; held?: unknown } | null,
}));
vi.mock("@/components/settings/port-section", () => ({
  PortSection: (props: { numbers?: unknown[]; held?: unknown }) => {
    portSection.props = props;
    return null;
  },
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

function suspendedNumber(): PhoneNumberSummary {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    status: "suspended",
    number_e164: "+12125550101",
    country: "US",
    requested_area_code: null,
    source: "provisioned",
    created_at: "2026-07-01T00:00:00Z",
  } as unknown as PhoneNumberSummary;
}

beforeEach(() => {
  state.role = "owner";
  state.company = company();
  state.numbers = [];
  held.asked = false;
  held.data = undefined;
  portSection.props = null;
  numberCard.props = [];
});

describe("#523 asking why a number is on hold", () => {
  it("does not ask on a workspace with nothing suspended", () => {
    // The overwhelming majority of loads. An authenticated billing read on
    // every visit to the numbers screen, to answer a question nobody asked,
    // is the cost this gate exists to avoid.
    state.numbers = [activeNumber()];
    render();
    expect(held.asked).toBe(false);
  });

  it("asks once there is a suspended number to explain", () => {
    state.numbers = [suspendedNumber()];
    render();
    expect(held.asked).toBe(true);
  });

  it("does not ask on behalf of a reader who would get a 403", () => {
    // `GET /v1/billing/held-numbers` is behind `billing.manage`. A member's
    // request could only ever fail, and the card copes with the missing answer
    // by declining to name a cause.
    state.role = "member";
    state.numbers = [suspendedNumber()];
    render();
    expect(held.asked).toBe(false);
  });

  it("hands the transfer stepper what it needs to explain a held ported line", () => {
    // A ported row is de-duplicated OUT of the number cards on purpose, so the
    // stepper is the only surface it has. Without both of these it goes on
    // saying "Live on Loonext" over a number that cannot send — which is the
    // whole D4 defect, and it is invisible from inside the port card.
    const held523 = { reason: "over_plan_allowance", held: [], allowance: 1 };
    held.data = held523;
    state.numbers = [suspendedNumber()];
    render();
    expect(portSection.props?.numbers).toEqual(state.numbers);
    expect(portSection.props?.held).toBe(held523);
  });

  it("tells each card whether the plan is live, so a held one can be released", () => {
    // The release rule refuses a suspended number on a dead subscription — the
    // problem there is the card, not the plan, and an irreversible control in
    // front of somebody in that state is a press made in a panic. The page is
    // the only place that fact is known.
    state.numbers = [suspendedNumber()];
    render();
    expect(numberCard.props.map((p) => p.subscriptionActive)).toEqual([true]);

    numberCard.props = [];
    state.company = company({ subscription_status: "past_due" });
    render();
    expect(numberCard.props.map((p) => p.subscriptionActive)).toEqual([false]);
  });

  it("does not ask during the grace window", () => {
    // A cancelled workspace's numbers are suspended for a different reason,
    // and the billing screen's win-back card owns that state.
    state.company = company({ subscription_status: "canceled" });
    state.numbers = [suspendedNumber()];
    render();
    expect(held.asked).toBe(false);
  });
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

  it("offers a US-enabled Starter its 2nd number as a $5 paid extra (#105)", () => {
    state.company = company({
      plan: "starter",
      subscription_status: "active",
      us_texting_enabled: true,
    });
    state.numbers = [activeNumber()];
    const html = render();
    expect(html).toContain("Add a number");
    expect(html).toContain("$5");
    // The shared-quota truth is stated BEFORE the buy (#80).
    expect(html).toContain("shared across all your numbers");
  });

  it("hides the paid-extra affordance without US texting enabled (#105)", () => {
    state.company = company({
      plan: "starter",
      subscription_status: "active",
      country: "US",
      us_texting_enabled: false,
    });
    state.numbers = [activeNumber()];
    const html = render();
    expect(html).not.toContain("Add a number");
  });

  // #464: "Why is extra phone number US only?? that makes no sense." It didn't.
  // Canada has no 10DLC equivalent, so `us_texting_enabled` is never true for a
  // CA workspace — and this page required it, which refused every Canadian
  // customer forever, for a carrier rule that does not apply to them.
  it("offers a Canadian workspace its paid extra, with no registration wait", () => {
    state.company = company({
      plan: "starter",
      subscription_status: "active",
      country: "CA",
      us_texting_enabled: false,
    });
    state.numbers = [activeNumber()];
    const html = render();
    expect(html).toContain("Add a number");
    expect(html).toContain("$5");
  });

  it("still holds a Canadian Starter to the hard 2-number max", () => {
    state.company = company({
      plan: "starter",
      subscription_status: "active",
      country: "CA",
      us_texting_enabled: false,
    });
    state.numbers = [
      activeNumber(),
      { ...activeNumber(), id: "00000000-0000-4000-8000-000000000002" },
    ];
    const html = render();
    expect(html).not.toContain("Add a number");
  });

  it("hides the affordance at Starter's hard 2-number max (#105)", () => {
    state.company = company({
      plan: "starter",
      subscription_status: "active",
      us_texting_enabled: true,
    });
    state.numbers = [
      activeNumber(),
      { ...activeNumber(), id: "00000000-0000-4000-8000-000000000002" },
    ];
    const html = render();
    expect(html).not.toContain("Add a number");
  });

  it("offers a US-enabled Pro a 3rd number as a $4 paid extra (#105)", () => {
    state.company = company({
      plan: "pro",
      subscription_status: "active",
      us_texting_enabled: true,
    });
    state.numbers = [
      activeNumber(),
      { ...activeNumber(), id: "00000000-0000-4000-8000-000000000002" },
    ];
    const html = render();
    expect(html).toContain("Add a number");
    expect(html).toContain("$4");
    expect(html).toContain("shared across all your numbers");
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
