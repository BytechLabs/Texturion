/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n/provider";

import { ALL_CATEGORIES_ON } from "./thread-filter";
import { ThreadFilterBar } from "./thread-filter-bar";

afterEach(cleanup);

describe(ThreadFilterBar, () => {
  it("renders all three independent toggles pressed with check indicators by default", () => {
    render(<ThreadFilterBar value={ALL_CATEGORIES_ON} onChange={vi.fn()} />);

    const group = screen.getByRole("group", { name: "Show in conversation" });
    expect(group).toBeTruthy();

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Messages", "Notes", "Events"]);

    for (const button of buttons) {
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(button.querySelector("svg")).not.toBeNull();
      expect(button.className).toContain("bg-app-paper");
      expect(button.className).toContain("dark:bg-app-tint");
      expect(button.className).not.toContain("bg-primary");
    }
  });

  it("removes the check mark and switches to outline styling on inactive toggles", () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider userLocale="fr-CA">
        <ThreadFilterBar
          value={{ messages: true, notes: false, events: true }}
          onChange={onChange}
        />
      </LocaleProvider>,
    );

    const messages = screen.getByRole("button", { name: "Messages" });
    const notes = screen.getByRole("button", { name: "Notes" });

    expect(messages.getAttribute("aria-pressed")).toBe("true");
    expect(messages.querySelector("svg")).not.toBeNull();
    expect(messages.className).toContain("dark:bg-app-tint");

    expect(notes.getAttribute("aria-pressed")).toBe("false");
    expect(notes.querySelector("svg")).toBeNull();
    expect(notes.className).toContain("bg-transparent");
    expect(notes.className).toContain("text-app-muted-2");

    fireEvent.click(notes);
    expect(onChange).toHaveBeenCalledWith({
      messages: true,
      notes: true,
      events: true,
    });
  });
});
