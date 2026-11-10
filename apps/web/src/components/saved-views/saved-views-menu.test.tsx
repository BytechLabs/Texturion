/**
 * @vitest-environment happy-dom
 *
 * #711: one Views menu for every list. Saving is offered only when the filters
 * on screen match no saved view and something is filtered.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rows } = vi.hoisted(() => ({
  rows: { current: [] as { id: string; name: string; shared: boolean; filters: object }[] },
}));

vi.mock("@/lib/api/saved-views", () => ({
  useSavedViews: () => ({
    data: { data: rows.current, defaults: { conversations: null, tasks: null } },
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

import { SavedViewsMenu } from "./saved-views-menu";

afterEach(cleanup);
beforeEach(() => {
  rows.current = [];
});

function open(props: { current?: string; hasFilters?: boolean; onApply?: () => void } = {}) {
  render(
    <SavedViewsMenu
      surface="conversations"
      isCurrent={(filters) => (filters as { id?: string }).id === props.current}
      onApply={props.onApply ?? (() => {})}
      currentFilters={() => ({})}
      suggestName={() => "Open"}
      hasFilters={props.hasFilters ?? true}
      saveDescription=""
      shareNote=""
    />,
  );
  fireEvent.keyDown(screen.getByRole("button"), { key: "ArrowDown" });
}

describe("#711 SavedViewsMenu", () => {
  it("SV-1: filters that match no view can be saved", () => {
    open();
    expect(screen.getByRole("menuitem", { name: "Save these filters as a view…" })).toBeTruthy();
  });

  it("SV-2: filters that are already a view are not saved twice", () => {
    rows.current = [{ id: "v1", name: "Quote sent", shared: false, filters: { id: "v1" } }];
    open({ current: "v1" });
    expect(screen.queryByRole("menuitem", { name: "Save these filters as a view…" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Manage views" })).toBeTruthy();
  });

  it("SV-3: nothing filtered means nothing to save", () => {
    open({ hasFilters: false });
    expect(screen.queryByRole("menuitem", { name: "Save these filters as a view…" })).toBeNull();
  });

  it("SV-4: one click applies a view", () => {
    rows.current = [{ id: "v1", name: "Quote sent", shared: false, filters: { id: "v1" } }];
    const onApply = vi.fn();
    open({ onApply });
    fireEvent.click(screen.getByRole("menuitem", { name: /Quote sent/ }));
    expect(onApply).toHaveBeenCalledWith({ id: "v1" });
  });
});
