/**
 * @vitest-environment happy-dom
 *
 * The list row's due picker: a datetime-local fires on every segment, so the
 * typed value is held and sent as one PATCH when the field is left or the
 * popover closes.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EN } from "@/i18n/catalog";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("@/lib/api/tasks", () => ({
  useUpdateTask: () => ({ mutate }),
}));
vi.mock("./assignee-field", () => ({ AssigneeField: () => null }));

import { InlineDue } from "./task-inline-edit";

const task = {
  id: "t1",
  title: "Fix sink",
  done: false,
  status: "open",
  message_id: "m1",
  conversation_id: "c1",
  due_at: null,
} as never;

function openPicker(): HTMLInputElement {
  fireEvent.click(screen.getByRole("button", { name: EN.tasks.setDueAria }));
  return screen.getByLabelText(EN.tasks.dueDateTimeAria) as HTMLInputElement;
}

function type(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

beforeEach(() => mutate.mockReset());
afterEach(cleanup);

describe("InlineDue sends one PATCH", () => {
  it("not while the date is typed, once when the field is left", () => {
    render(<InlineDue task={task} />);
    const input = openPicker();
    type(input, "2026-11-20T08:00");
    type(input, "2026-11-20T09:00");
    type(input, "2026-11-20T09:30");
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate.mock.calls[0]![0]).toEqual({
      taskId: "t1",
      due_at: new Date("2026-11-20T09:30").toISOString(),
    });
  });

  it("once when the popover closes, and not again", () => {
    render(<InlineDue task={task} />);
    const input = openPicker();
    type(input, "2026-11-21T08:00");
    type(input, "2026-11-21T10:00");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      due_at: new Date("2026-11-21T10:00").toISOString(),
    });
  });

  it("never for a half-typed value or one that did not change", () => {
    render(<InlineDue task={task} />);
    const input = openPicker();
    type(input, "");
    fireEvent.blur(input);
    expect(mutate).not.toHaveBeenCalled();
  });
});
