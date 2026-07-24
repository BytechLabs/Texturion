import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #100: the account sheet carries everything the retired mobile header did —
 * the workspace info (+ switcher when multi-workspace), the business
 * number(s), the notifications entry with its unread count, the theme choice,
 * Settings, and Sign out. These pin that contract at render level.
 */
const state = {
  memberships: [{ company_id: "co-1", name: "Bytech Labs" }],
  unread: 0,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear: vi.fn() }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({
    membership: state.memberships[0],
    memberships: state.memberships,
    switchCompany: vi.fn(),
    displayName: "Rehman",
  }),
}));
vi.mock("@/lib/api/numbers", () => ({
  useNumbers: () => ({ data: { data: [] } }),
}));
vi.mock("@/lib/api/notifications", () => ({
  useNotificationsUnreadCount: () => ({ data: { count: state.unread } }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowser: () => ({ auth: { signOut: vi.fn() } }),
}));
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationFeed: () => <div>feed</div>,
}));
vi.mock("./workspace-bits", () => ({
  WorkspaceNumbers: () => <div>numbers-strip</div>,
  companyInitials: () => "BL",
}));

// The Sheet wrapper is a Radix portal (renders nothing in SSR), so the tests
// pin the BODY — the actual content contract.
import { MobileAccountSheetBody } from "./mobile-account-sheet";

const noop = () => undefined;

beforeEach(() => {
  state.memberships = [{ company_id: "co-1", name: "Bytech Labs" }];
  state.unread = 0;
});

describe("MobileAccountSheetBody (#100)", () => {
  it("carries the account, number strip, notifications, theme, Settings, and Sign out", () => {
    const html = renderToStaticMarkup(
      <MobileAccountSheetBody
        onClose={noop}
        onNavigateClose={noop}
        onFeedOpened={noop}
      />,
    );
    expect(html).toContain("Rehman");
    expect(html).toContain("Bytech Labs");
    expect(html).toContain("numbers-strip");
    expect(html).toContain("Notifications");
    for (const theme of ["System", "Light", "Dark"]) {
      expect(html).toContain(theme);
    }
    expect(html).toContain("Settings");
    expect(html).toContain('href="/settings"');
    expect(html).toContain("Sign out");
  });

  it("shows the unread count on the Notifications row", () => {
    state.unread = 12;
    const html = renderToStaticMarkup(
      <MobileAccountSheetBody
        onClose={noop}
        onNavigateClose={noop}
        onFeedOpened={noop}
      />,
    );
    // 12 caps to the calm 9+ numeral.
    expect(html).toContain("9+");
    expect(html).toContain("12 unread");
  });

  it("shows the workspace switcher only for multi-workspace accounts", () => {
    const single = renderToStaticMarkup(
      <MobileAccountSheetBody
        onClose={noop}
        onNavigateClose={noop}
        onFeedOpened={noop}
      />,
    );
    expect(single).not.toContain("Workspaces");

    state.memberships = [
      { company_id: "co-1", name: "Bytech Labs" },
      { company_id: "co-2", name: "Acme Plumbing" },
    ];
    const multi = renderToStaticMarkup(
      <MobileAccountSheetBody
        onClose={noop}
        onNavigateClose={noop}
        onFeedOpened={noop}
      />,
    );
    expect(multi).toContain("Workspaces");
    expect(multi).toContain("Acme Plumbing");
  });
});
