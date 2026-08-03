import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CompanyView } from "@/lib/api/types";

/**
 * The away reply is best-effort: when the send gates refuse a destination it
 * is skipped without a trace. A switch that reads ON while nobody is answered
 * after hours is the first week of every US workspace, so the reach of the
 * feature has to be stated where it is turned on.
 */
const company = {
  name: "Ace Plumbing",
  timezone: "America/Toronto",
  business_hours: {},
  away_enabled: true,
  away_message: "We're closed. Reply URGENT for a no-heat emergency.",
  country: "US",
  us_texting_enabled: true,
  registration: {
    brand: null,
    campaign: { status: "approved", deactivated_at: null },
  },
} as unknown as CompanyView;

/** The workspace's reach: which destinations its texts can arrive at. */
function setReach(
  country: "US" | "CA",
  usTextingEnabled: boolean,
  campaignApproved: boolean,
) {
  company.country = country;
  company.us_texting_enabled = usTextingEnabled;
  company.registration = {
    brand: null,
    campaign: campaignApproved
      ? { status: "approved", deactivated_at: null }
      : null,
  } as unknown as CompanyView["registration"];
}

vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({
    isPending: false,
    isError: false,
    data: company,
    refetch: vi.fn(),
  }),
  useUpdateCompany: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: "owner" }),
  useCompanyId: () => "11111111-1111-4111-8111-111111111111",
}));

// #237: the reminder card renders on this page and asks react-query for its
// rules. Mocked at the API layer, exactly as `@/lib/api/companies` above is —
// this file renders to static markup with no QueryClientProvider, and these
// assertions are about the US-reach notice rather than about reminders.
vi.mock("@/lib/api/appointment-reminders", () => ({
  useReminderRules: () => ({
    isPending: false,
    data: { rules: [], suggested: [], cap: 2 },
  }),
  useSaveReminderRules: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// #244: this page now also mounts the on-call card. Empty roster, no shifts —
// the card renders its "nobody is on call" state and these assertions stay
// about the away reply's reach.
vi.mock("@/lib/api/on-call", () => ({
  useOnCallShifts: () => ({ isPending: false, data: [] }),
  useCreateOnCallShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEndOnCallShift: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({ data: { data: [] } }),
}));

import AwayReplySettingsPage from "./page";

const render = () => renderToStaticMarkup(<AwayReplySettingsPage />);

describe("/settings/away-reply — the away reply's reach", () => {
  afterEach(() => {
    company.away_enabled = true;
    setReach("US", true, true);
  });

  it("says US customers get nothing while registration is pending", () => {
    setReach("US", true, false);
    expect(render()).toContain(
      "get this reply until your registration is approved",
    );
  });

  it("says nothing once the campaign is approved", () => {
    setReach("US", true, true);
    expect(render()).not.toContain("get this reply until");
  });

  it("names the add-on for a workspace that never turned US texting on", () => {
    setReach("CA", false, false);
    expect(render()).toContain("on for this workspace");
  });

  it("stays quiet while the away reply itself is off", () => {
    company.away_enabled = false;
    setReach("US", true, false);
    expect(render()).not.toContain("get this reply until");
  });
});
