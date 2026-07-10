import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #100: the mobile shell is the bottom tab bar alone — no top header. The
 * fifth cell is the ACCOUNT AVATAR (replacing "More"): it opens the account
 * sheet and carries a dot when there are unread notifications. These pin the
 * render contract: four nav links + the avatar button, the unread dot, and
 * that no "More" link to /settings remains.
 */
const state = {
  unread: 0,
};

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({
    membership: { company_id: "co-1", name: "Bytech Labs" },
    memberships: [{ company_id: "co-1", name: "Bytech Labs" }],
    switchCompany: vi.fn(),
    displayName: "Rehman",
  }),
}));
vi.mock("@/lib/api/notifications", () => ({
  useNotificationsUnreadCount: () => ({ data: { count: state.unread } }),
}));
vi.mock("@/lib/realtime/for-you-notifications", () => ({
  useForYouNotificationsRealtime: () => undefined,
}));
vi.mock("./use-nav-counts", () => ({
  useNavCounts: () => ({ forYou: 2, inbox: 3, tasks: 0, numbers: 1 }),
}));
vi.mock("./mobile-account-sheet", () => ({
  MobileAccountSheet: () => <div data-sheet>sheet</div>,
}));

import { MobileTabBar } from "./mobile-tab-bar";

beforeEach(() => {
  state.unread = 0;
});

describe("MobileTabBar (#100)", () => {
  it("renders the four nav links plus the avatar button — and NO More link", () => {
    const html = renderToStaticMarkup(<MobileTabBar />);
    for (const label of ["For You", "Inbox", "Tasks", "Contacts"]) {
      expect(html).toContain(label);
    }
    // The avatar cell: initials + the "You" label, a button (not a link).
    expect(html).toContain("RE");
    expect(html).toContain("You");
    expect(html).toContain("Account and settings");
    // The old More → /settings tab is gone (#100); Settings lives in the sheet.
    expect(html).not.toContain(">More<");
  });

  it("shows a dot on the avatar when there are unread notifications", () => {
    state.unread = 4;
    const html = renderToStaticMarkup(<MobileTabBar />);
    expect(html).toContain("4 unread notifications");

    state.unread = 0;
    const quiet = renderToStaticMarkup(<MobileTabBar />);
    expect(quiet).not.toContain("unread notifications");
  });
});
