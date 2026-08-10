import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  capabilitiesOf,
  MEMBER_ROLES,
  type Capability,
  type MemberRole,
} from "@loonext/shared";

/**
 * A preset this build has never heard of, standing in for the next one #315
 * adds. Its capabilities are whatever a test says they are — which is the only
 * way to ask the page the question that matters: does it consult the capability,
 * or does it recognise a name?
 */
const FUTURE_ROLE = "field_supervisor" as MemberRole;

// Hoisted mock state the hooks read; each test seeds it before rendering.
const state: { role: MemberRole; futureCapabilities: Capability[] } = {
  role: "owner",
  futureCapabilities: [],
};

/**
 * The real capability table for every real role, plus one role that does not
 * exist yet. Everything else is passed straight through — this is the module the
 * whole settings tree reads, and replacing it wholesale would test the mock.
 */
vi.mock("@loonext/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@loonext/shared")>();
  return {
    ...actual,
    capabilitiesOf: (role: MemberRole): Capability[] =>
      role === FUTURE_ROLE
        ? [...state.futureCapabilities]
        : actual.capabilitiesOf(role),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: state.role, companyId: "company_1" }),
}));
vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({
    isPending: false,
    isError: false,
    data: {
      id: "company_1",
      name: "Northfield Plumbing",
      country: "CA",
      us_texting_enabled: false,
      timezone: "America/Toronto",
      locale: "en",
      first_message_identification: false,
      first_message_identification_suffix: null,
      quiet_hours_confirm_enabled: true,
    },
    refetch: vi.fn(),
  }),
  useUpdateCompany: () => ({ isPending: false, mutate: vi.fn() }),
  useCloseWorkspace: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/lib/api/registration", () => ({
  useRegistration: () => ({
    isPending: false,
    isError: false,
    data: { brand: null },
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/api/contact-fields", () => ({
  useContactFields: () => ({
    isPending: false,
    isError: false,
    data: { fields: [] },
    refetch: vi.fn(),
  }),
  useSaveContactFields: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/lib/api/team", () => ({
  useLeaveWorkspace: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-action-confirmation", () => ({
  useActionConfirmation: () => ({
    kind: null,
    rejected: false,
    requesting: false,
    demanded: () => false,
    confirm: vi.fn(),
    resend: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
// #227's card. A real mutation hook, and this harness renders statically with
// no query client.
vi.mock("@/lib/api/exports", () => ({
  useDataExports: () => ({ isPending: false, data: { data: [] } }),
  useRequestDataExport: () => ({ isPending: false, mutate: vi.fn() }),
}));

import WorkspaceSettingsPage from "./page";

function render(role: MemberRole): string {
  state.role = role;
  return renderToStaticMarkup(<WorkspaceSettingsPage />);
}

/** The card's title and its button — present together or not at all. */
function showsExportCard(html: string): boolean {
  return html.includes("Export your data");
}

/**
 * #595 — the workspace export card asks for a CAPABILITY, not a rank.
 *
 * The server gates `POST /v1/exports` on `contacts.bulk`
 * (apps/api/src/routes/exports.ts). The page used to gate the card on the role
 * NAMES "owner" and "admin", which is the same answer today by coincidence and
 * a different question in principle: since #315 a role is a capability set, so
 * a preset carrying `contacts.bulk` would have been shown nothing while the
 * server stood ready to serve it.
 *
 * The bookkeeper case is the acceptance criterion. They were already excluded —
 * but by rank, not by anyone deciding they should be.
 */
describe("/settings/workspace data export gate (#595)", () => {
  beforeEach(() => {
    state.role = "owner";
    state.futureCapabilities = [];
  });

  it("shows the card to a role that holds contacts.bulk", () => {
    // Stated as a premise rather than assumed: if the table ever stops giving
    // admin this capability, this test should fail on THAT line, not silently
    // start asserting the negative case twice.
    expect(capabilitiesOf("admin")).toContain("contacts.bulk");

    const html = render("admin");
    expect(showsExportCard(html)).toBe(true);
    expect(html).toContain("Export my data");
  });

  it("never shows it to a bookkeeper, who does the books and not the customers", () => {
    expect(capabilitiesOf("bookkeeper")).toContain("billing.manage");
    expect(capabilitiesOf("bookkeeper")).not.toContain("contacts.bulk");

    const html = render("bookkeeper");
    expect(showsExportCard(html)).toBe(false);
    expect(html).not.toContain("Export my data");
    // Absent, not disabled: no greyed-out control left behind to go asking
    // about, and no explanation of a rank they would have to be promoted to.
    expect(html).not.toContain("A copy of everything in this workspace");
    expect(html).not.toContain("Only owners and admins can export");
    // The page itself still renders for them — the card is missing, not the
    // screen.
    expect(html).toContain("Northfield Plumbing");
  });

  /**
   * Set equality in BOTH directions, over every role that exists.
   *
   * A pair of examples proves the two cases somebody thought of. This proves
   * the rule: no role is shown the card without the capability, and no role
   * holding the capability is refused it. A new preset added to the table is
   * covered the day it lands, which is the whole reason for asking a capability
   * instead of listing names.
   */
  it.each(MEMBER_ROLES)("matches the capability table for %s", (role) => {
    const entitled = capabilitiesOf(role).includes("contacts.bulk");
    expect(showsExportCard(render(role))).toBe(entitled);
  });

  /**
   * The test that tells a capability apart from a rank.
   *
   * Every assertion above passes just as well against the rank gate this
   * replaced, because owner and admin are exactly today's `contacts.bulk`
   * holders — the two models agree on every role that currently exists, which is
   * what made this safe to change and also what makes it unprovable using them.
   *
   * So: a role off the owner/admin line entirely, carrying the capability. The
   * rank gate refuses it (it is neither name), the capability gate serves it, and
   * that difference is the entire change.
   */
  it("serves a role that is on no rank at all but holds the capability", () => {
    state.futureCapabilities = ["workspace.access", "contacts.bulk"];
    expect(showsExportCard(render(FUTURE_ROLE))).toBe(true);
  });

  it("refuses the same role once the capability is taken away", () => {
    // Same role, same everything, one capability different. Nothing about the
    // name can explain both results.
    state.futureCapabilities = ["workspace.access", "billing.manage"];
    expect(showsExportCard(render(FUTURE_ROLE))).toBe(false);
  });
});
