import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileTabBar } from "./mobile-tab-bar";

const state = {
  unread: 0,
  pathname: "/inbox",
};

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
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
  useForYouNavCount: () => 2,
  useInboxNavCount: () => 3,
  // The tab bar shows no Tasks numeral, so it must not subscribe to one.
  useTaskNavCount: () => {
    throw new Error("the tab bar read the Tasks count it never shows");
  },
}));
vi.mock("./mobile-account-sheet", () => ({
  MobileAccountSheet: () => <div data-sheet>sheet</div>,
}));


beforeEach(() => {
  state.unread = 0;
  state.pathname = "/inbox";
});

describe(MobileTabBar, () => {
  it("renders the five destinations in order with More as a dialog trigger", () => {
    const html = renderToStaticMarkup(<MobileTabBar />);
    let previous = 0;
    for (const href of ["/for-you", "/inbox", "/tasks", "/lou"]) {
      const position = html.indexOf(`href="${href}"`);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
    expect(html.indexOf('aria-label="More"')).toBeGreaterThan(previous);
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it.each(["/inbox", "/inbox/scheduled", "/calls", "/calls/detail"])("selects Conversations alone on %s", (path) => {
    state.pathname = path;
    const html = renderToStaticMarkup(<MobileTabBar />);
    expect(html).toContain('aria-label="For you, 2"');
    expect(html).toContain('aria-label="Conversations, 3"');
    const current = html.match(/<a [^>]*aria-current="page"[^>]*>/g) ?? [];
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/inbox"');
  });

  it.each(["/contacts", "/trash", "/settings/account"])("selects More alone on %s", (path) => {
    state.pathname = path;
    const html = renderToStaticMarkup(<MobileTabBar />);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*aria-current="page"/);
  });

  it("includes the unread notification count in the More label", () => {
    state.unread = 4;
    expect(renderToStaticMarkup(<MobileTabBar />)).toContain('aria-label="More, 4"');
    state.unread = 0;
    expect(renderToStaticMarkup(<MobileTabBar />)).toContain('aria-label="More"');
  });
});
