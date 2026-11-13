import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

type ModulesQuery = {
  data: { modules: unknown[] } | undefined;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => void;
};

const state: { modules: ModulesQuery } = {
  modules: { data: undefined, isPending: true, isError: false, isSuccess: false, refetch: vi.fn() },
};

vi.mock("@/lib/api/billing", () => ({
  useModules: () => state.modules,
  useSetModule: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { PlanModulesCard } from "./plan-modules-card";

describe("PlanModulesCard loading", () => {
  it("draws nothing while the modules read is in flight", () => {
    state.modules = { data: undefined, isPending: true, isError: false, isSuccess: false, refetch: vi.fn() };
    expect(renderToStaticMarkup(<PlanModulesCard />)).toBe("");
  });

  it("draws nothing once the read says there is nothing to toggle", () => {
    state.modules = {
      data: { modules: [{ id: "regions_ca", available: true }] },
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    };
    expect(renderToStaticMarkup(<PlanModulesCard />)).toBe("");
  });

  it("keeps the card with a retry when the read fails", () => {
    state.modules = { data: undefined, isPending: false, isError: true, isSuccess: false, refetch: vi.fn() };
    const html = renderToStaticMarkup(<PlanModulesCard />);
    expect(html).toContain("Add-ons");
    expect(html).toContain("couldn&#x27;t load your add-ons");
  });
});
