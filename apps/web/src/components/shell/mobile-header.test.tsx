import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * #76: on a phone a conversation is a full-screen pushed view with its own
 * ThreadHeader, so the workspace-chrome mobile header (name + business number)
 * is dropped below md on thread routes — reclaiming two stacked rows. It stays
 * on the bare inbox list and in the md–lg two-pane band.
 */
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({
    membership: { company_id: "co-1", name: "Bytech Labs" },
    memberships: [{ company_id: "co-1", name: "Bytech Labs" }],
    switchCompany: vi.fn(),
    displayName: "Rehman",
  }),
}));
vi.mock("@/lib/api/numbers", () => ({
  useNumbers: () => ({ data: { data: [] } }),
}));
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => <div>bell</div>,
}));
vi.mock("./member-menu", () => ({
  MemberMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./workspace-bits", () => ({
  WorkspaceNumbers: () => <div>numbers</div>,
  companyInitials: () => "BL",
}));
vi.mock("./avatar-color", () => ({
  avatarInitials: () => "RE",
}));

import { MobileHeader } from "./mobile-header";

describe("MobileHeader thread-route decluttering (#76)", () => {
  it("drops the header below md inside a conversation", () => {
    const html = renderToStaticMarkup(<MobileHeader inThread />);
    expect(html).toContain("max-md:hidden");
  });

  it("keeps the header on non-thread routes (list, other pages)", () => {
    const html = renderToStaticMarkup(<MobileHeader />);
    expect(html).not.toContain("max-md:hidden");
    // Still the mobile-only workspace chrome (hidden only at lg+).
    expect(html).toContain("lg:hidden");
  });
});
