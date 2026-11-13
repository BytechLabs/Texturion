/**
 * @vitest-environment happy-dom
 */
/**
 * The sidebar's collapsed choice is read before the first paint, so a collapsed
 * sidebar never opens wide and then snaps shut. The shell renders only on the
 * client, so there is no server HTML for it to disagree with.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const drawn = vi.hoisted((): boolean[] => []);

vi.mock("next/navigation", () => ({ usePathname: () => "/for-you" }));
vi.mock("@/i18n/provider", () => ({ useT: () => (key: string) => key }));
vi.mock("@/lib/softphone/provider", () => ({
  SoftphoneProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/calls/call-bar", () => ({ CallBar: () => null }));
vi.mock("@/components/notifications/unread-title-manager", () => ({
  UnreadTitleManager: () => null,
}));
vi.mock("@/components/shell/connection-banner", () => ({ ConnectionBanner: () => null }));
vi.mock("@/components/registration/status-banner", () => ({
  WorkspaceStatusBanner: () => null,
}));
vi.mock("@/components/tasks/task-drawer-host", () => ({ TaskDrawerHost: () => null }));
vi.mock("@/components/tasks/new-task", () => ({ NewTaskDialog: () => null }));
vi.mock("./command-palette", () => ({ CommandPalette: () => null }));
vi.mock("./mobile-tab-bar", () => ({ MobileTabBar: () => null }));
vi.mock("./window-drop-guard", () => ({ WindowDropGuard: () => null }));
vi.mock("./sidebar", () => ({
  Sidebar: ({
    collapsed,
    onToggleSidebar,
  }: {
    collapsed: boolean;
    onToggleSidebar: () => void;
  }) => {
    drawn.push(collapsed);
    return (
      <button type="button" onClick={onToggleSidebar}>
        toggle
      </button>
    );
  },
}));

import { AppShell } from "./app-shell";

const KEY = "loonext:sidebar-collapsed";

beforeEach(() => {
  drawn.length = 0;
  window.localStorage.clear();
});
afterEach(cleanup);

describe("AppShell sidebar preference", () => {
  it("draws a collapsed sidebar collapsed from the first paint", () => {
    window.localStorage.setItem(KEY, "true");
    render(<AppShell>page</AppShell>);
    expect(drawn).toEqual([true]);
  });

  it("draws an expanded sidebar when nothing is saved", () => {
    render(<AppShell>page</AppShell>);
    expect(drawn).toEqual([false]);
  });

  it("saves the toggle", () => {
    render(<AppShell>page</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(drawn.at(-1)).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe("true");
  });
});
