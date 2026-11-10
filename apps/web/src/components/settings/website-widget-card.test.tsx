/**
 * @vitest-environment happy-dom
 *
 * #717: the widget's line picker names the line its default resolves to, and
 * does not offer that line a second time beside it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { companyData } = vi.hoisted(() => ({
  companyData: { current: {} as Record<string, unknown> },
}));

vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({ data: companyData.current }),
  useRotateWidgetKey: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdateCompany: () => ({ isPending: false, mutate: vi.fn() }),
  useWidgetKey: () => ({ isPending: false, isError: false, data: { widget_key: "wk_1" } }),
}));
vi.mock("@/lib/api/numbers", () => ({
  // Oldest first, as GET /v1/numbers returns them.
  useNumbers: () => ({
    data: {
      data: [
        { id: "n1", status: "active", number_e164: "+14165550100" },
        { id: "n2", status: "active", number_e164: "+14165550111" },
      ],
    },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { WebsiteWidgetCard } from "./website-widget-card";

afterEach(cleanup);
beforeEach(() => {
  companyData.current = { widget_number_id: null };
});

function lineOptions() {
  render(<WebsiteWidgetCard appOrigin="https://app.example.test" />);
  fireEvent.click(screen.getByRole("button", { name: "Get the snippet" }));
  fireEvent.keyDown(document.getElementById("widget-line")!, { key: "ArrowDown" });
  return screen.getAllByRole("option").map((option) => option.textContent);
}

describe("#717 the widget's line picker", () => {
  it("WL-1: the default names its line, and that line is not offered twice", () => {
    expect(lineOptions()).toEqual([
      "Your first number ((416) 555-0100)",
      "(416) 555-0111",
    ]);
  });

  it("WL-2: a workspace that chose the first line explicitly still sees it", () => {
    companyData.current = { widget_number_id: "n1" };
    expect(lineOptions()).toHaveLength(3);
  });
});
