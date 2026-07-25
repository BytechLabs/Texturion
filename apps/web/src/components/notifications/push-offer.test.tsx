import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PushPhase } from "@/lib/push/use-push-subscription";

/**
 * The offer to turn on browser notifications, made inside the notification
 * list. The browser permission prompt can only follow a deliberate tap, and it
 * lived solely on the settings page: until it is granted an alert reaches a
 * member only while the app is already open in front of them.
 */
const state: { phase: PushPhase } = { phase: "idle" };

vi.mock("@/lib/push/use-push-subscription", () => ({
  usePushSubscription: () => ({
    phase: state.phase,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }),
}));

vi.mock("@/lib/api/notifications", () => ({
  useNotificationsFeed: () => ({
    isPending: true,
    isError: false,
    data: undefined,
  }),
  useNotificationsUnreadCount: () => ({ data: { count: 0 } }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkNotificationReadItem: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/realtime/for-you-notifications", () => ({
  useForYouNotificationsRealtime: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { NotificationFeed } from "./notification-bell";

const render = (phase: PushPhase) => {
  state.phase = phase;
  return renderToStaticMarkup(<NotificationFeed active onNavigate={() => {}} />);
};

describe("the notification list's push offer", () => {
  it("offers to turn notifications on when the browser has not been asked", () => {
    const html = render("idle");
    expect(html).toContain("Turn on");
    expect(html).toContain("Get these when Loonext");
  });

  it("says where a block can be undone, and offers nothing that cannot work", () => {
    // Only the browser's own site settings can reverse a denial, so a button
    // here would do nothing at all.
    const html = render("denied");
    expect(html).toContain("blocked for this site");
    expect(html).not.toContain("Turn on");
  });

  it("stays out of the way once notifications are on", () => {
    const html = render("subscribed");
    expect(html).not.toContain("Turn on");
    expect(html).not.toContain("blocked for this site");
  });

  it("says nothing while the browser support check is still settling", () => {
    // A control that flickers in and out on load is worse than a late one.
    expect(render("initializing")).not.toContain("Turn on");
    expect(render("unsupported")).not.toContain("Turn on");
  });
});
