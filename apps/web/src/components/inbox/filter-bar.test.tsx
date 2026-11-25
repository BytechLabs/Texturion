/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilterBar } from "./filter-bar";
import type { InboxUrlFilters } from "./filter-url";

afterEach(cleanup);

vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({ data: { numbers: [] } }),
}));
vi.mock("@/lib/api/conversations", () => ({
  useConversations: () => ({
    data: { pages: [{ data: [{ id: "c1" }, { id: "c2" }] }] },
    hasNextPage: false,
  }),
}));
vi.mock("@/lib/api/tags", () => ({
  useTags: () => ({ data: { data: [{ id: "t1", name: "Quote sent" }] } }),
}));
vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({
    data: {
      data: [
        { user_id: "u1", display_name: "Sam Lee", deactivated_at: null },
        { user_id: "u2", display_name: "Dana Ortiz", deactivated_at: null },
      ],
    },
  }),
}));
vi.mock("@/lib/api/saved-views", () => ({
  useSavedViews: () => ({
    data: { data: [], defaults: { conversations: null, tasks: null } },
  }),
  useSavedViewCounts: () => ({ data: undefined }),
  useCreateSavedView: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateSavedView: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteSavedView: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useSetDefaultSavedView: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: "owner", userId: "u1" }),
}));

function mountBar(
  filters: InboxUrlFilters,
  props: {
    onChange?: (next: InboxUrlFilters) => void;
    searchOpen?: boolean;
    searchFocusNonce?: number;
    onCloseSearch?: () => void;
  } = {},
) {
  const onChange = props.onChange ?? vi.fn();
  render(
    <FilterBar
      filters={filters}
      onChange={onChange}
      searchOpen={props.searchOpen}
      searchFocusNonce={props.searchFocusNonce}
      onCloseSearch={props.onCloseSearch}
    />,
  );
  return { onChange };
}

describe("FilterBar (#1264 compact top section)", () => {
  it("renders one compact control row with status select, views, and unified filter by default", () => {
    mountBar({ status: "open" });

    const status = screen.getByRole("combobox", { name: "Conversation status" });
    expect(status.dataset.value).toBe("open");
    expect(status.textContent).toContain("Open");
    expect(status.textContent).toContain("2");

    expect(screen.getByRole("button", { name: "Views" })).toBeInstanceOf(Element);
    expect(screen.getByRole("button", { name: "Filter" })).toBeInstanceOf(Element);

    expect(screen.queryByRole("button", { name: "Assignee" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tag" })).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });

  it("exposes assignee, tag, and more filters in one unified popover", () => {
    const { onChange } = mountBar({ status: "open" });

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));

    expect(screen.getByText("Unassigned")).toBeInstanceOf(Element);
    expect(screen.getByText("Dana Ortiz")).toBeInstanceOf(Element);
    expect(screen.getByText("Quote sent")).toBeInstanceOf(Element);
    expect(screen.getByText("Unanswered")).toBeInstanceOf(Element);
    expect(screen.getByText("Unread")).toBeInstanceOf(Element);

    fireEvent.click(screen.getByText("Quote sent"));
    expect(onChange).toHaveBeenCalledWith({ status: "open", tag: "t1" });
  });

  it("renders removable chips and Clear all only when secondary filters are active", () => {
    const { onChange } = mountBar({ status: "open", tag: "t1", unread: true });

    expect(screen.getByRole("button", { name: "Filters: 2 on" })).toBeInstanceOf(Element);
    expect(screen.getByRole("button", { name: "Remove Quote sent filter" })).toBeInstanceOf(Element);
    expect(screen.getByRole("button", { name: "Remove Unread filter" })).toBeInstanceOf(Element);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("shows and focuses search when opened, closes on Escape, and pauses filters during active search", () => {
    const onCloseSearch = vi.fn();
    mountBar({ status: "open" }, { searchOpen: true, searchFocusNonce: 1, onCloseSearch });

    const input = screen.getByRole("searchbox", { name: "Search conversations and contacts" });
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCloseSearch).toHaveBeenCalledOnce();

    cleanup();
    mountBar({ status: "open", q: "heater" });
    expect(screen.getByRole("searchbox")).toHaveProperty("value", "heater");
    expect(screen.getByRole("combobox", { name: "Conversation status" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Filter" }).hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText("Search looks through every conversation, so these filters are paused."),
    ).toBeInstanceOf(Element);
  });
});
