/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InboxLayout from "./layout";

const usePathname = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ usePathname }));
vi.mock("@/i18n/provider", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/inbox/inbox-pane", () => ({
  InboxPane: () => <div data-testid="inbox-pane">InboxPane</div>,
}));
vi.mock("@/components/inbox/display-menu", () => ({
  InboxDisplayMenu: () => null,
}));
vi.mock("@/components/inbox/empty-states", () => ({
  InboxListSkeleton: () => null,
}));
vi.mock("@/lib/inbox/navigation-focus", () => ({
  InboxFocusProvider: ({ children }: { children: React.ReactNode }) => children,
}));

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

describe(InboxLayout, () => {
  it("renders the conversation list pane beside inbox routes", () => {
    usePathname.mockReturnValue("/inbox");
    render(
      <InboxLayout>
        <div data-testid="thread-child">Thread</div>
      </InboxLayout>,
    );

    expect(screen.getByTestId("inbox-pane")).toBeInstanceOf(Element);
    expect(screen.getByTestId("thread-child")).toBeInstanceOf(Element);
  });

  it("renders /inbox/scheduled standalone without the inbox conversation list pane", () => {
    usePathname.mockReturnValue("/inbox/scheduled");
    render(
      <InboxLayout>
        <div data-testid="scheduled-child">Scheduled</div>
      </InboxLayout>,
    );

    expect(screen.queryByTestId("inbox-pane")).toBeNull();
    expect(screen.getByTestId("scheduled-child")).toBeInstanceOf(Element);
  });
});
