import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AvailableNumbersResult } from "@/lib/api/types";

/** Hoisted mock the hook reads; each test seeds it before rendering. */
const listState: {
  data: AvailableNumbersResult | null;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
} = { data: null, isPending: false, isError: false, isFetching: false };

vi.mock("@/lib/api/numbers", () => ({
  useAvailableNumbers: () => ({ ...listState, refetch: vi.fn() }),
}));

import { NumberPicker } from "./number-picker";

beforeEach(() => {
  listState.data = null;
  listState.isPending = false;
  listState.isError = false;
  listState.isFetching = false;
});

describe("NumberPicker (#86: area code + digits are filters, not a gate)", () => {
  it("browses available numbers immediately, with no area code chosen", () => {
    listState.data = {
      data: [
        { phone_number: "+13035550123", region: "Denver", features: ["sms"] },
        { phone_number: "+12125550100", region: "New York", features: ["sms"] },
      ],
      masked: false,
      best_effort_exhausted: false,
    };
    const html = renderToStaticMarkup(
      <NumberPicker country="US" onSelect={() => {}} />,
    );
    // The number list renders WITHOUT first picking an area code (the fix).
    expect(html).toContain("Denver");
    expect(html).toContain("New York");
    // The area code is offered as an optional filter, not a required first step.
    expect(html).toContain("Area code (optional)");
    // The empty "pick an area code first" gate is gone.
    expect(html).not.toContain("No numbers available");
  });

  it("still lets an initial area code narrow the list", () => {
    listState.data = {
      data: [
        { phone_number: "+17205550100", region: "Denver", features: ["sms"] },
      ],
      masked: false,
      best_effort_exhausted: false,
    };
    const html = renderToStaticMarkup(
      <NumberPicker country="US" initialAreaCode="720" onSelect={() => {}} />,
    );
    expect(html).toContain("Denver");
    expect(html).toContain("Change area code");
  });

  it("guides a Canadian pick to an area code when inventory is masked", () => {
    listState.data = { data: [], masked: true, best_effort_exhausted: false };
    const html = renderToStaticMarkup(
      <NumberPicker country="CA" onSelect={() => {}} />,
    );
    // Masked CA numbers can't be browsed, so the picker points at the filter.
    expect(html).toContain("pick an area code above");
  });
});
