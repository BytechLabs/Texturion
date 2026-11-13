/**
 * @vitest-environment happy-dom
 */
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReminderRule } from "@/lib/api/appointment-reminders";

const query: {
  data: { rules: ReminderRule[]; suggested: []; cap: number } | undefined;
} = { data: undefined };

vi.mock("@/lib/api/appointment-reminders", () => ({
  useReminderRules: () => ({ data: query.data, isPending: query.data === undefined }),
  useSaveReminderRules: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ReminderRulesCard } from "./reminder-rules-card";

function rules(body: string) {
  return {
    rules: [{ id: "r-1", offset_minutes: 1440, body, enabled: true }],
    suggested: [] as [],
    cap: 3,
  };
}

afterEach(() => {
  cleanup();
  query.data = undefined;
});

describe("ReminderRulesCard first paint", () => {
  it("draws the saved rules on the first render when the cache already has them", () => {
    query.data = rules("See you tomorrow at {time}");
    const html = renderToStaticMarkup(<ReminderRulesCard canEdit />);
    expect(html).toContain("See you tomorrow at {time}");
    expect(html).not.toContain('data-slot="skeleton"');
  });

  it("still shows the skeleton while the first read is in flight", () => {
    const html = renderToStaticMarkup(<ReminderRulesCard canEdit />);
    expect(html).toContain('data-slot="skeleton"');
  });

  it("re-seeds the draft when the server answers again", () => {
    query.data = rules("See you tomorrow");
    const view = render(<ReminderRulesCard canEdit />);
    query.data = rules("We are on the way");
    view.rerender(<ReminderRulesCard canEdit />);
    expect(view.container.querySelector("textarea")?.value).toBe("We are on the way");
  });
});
