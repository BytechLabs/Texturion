/**
 * @vitest-environment happy-dom
 *
 * #689 New task: a task with no text or call behind it. The title is the only
 * thing asked for; the assignee is me and the due date is empty until someone
 * opens More.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mutateAsync, toastSuccess, toastError } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/api/tasks", () => ({
  useCreateTaskFromMessage: () => ({ isPending: false, mutateAsync }),
}));
vi.mock("@/lib/api/me", () => ({
  useMe: () => ({ data: { user_id: "me-1" } }),
}));
vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({
    data: { data: [{ id: "m1", user_id: "me-1", display_name: "Sam" }] },
  }),
}));
vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "company-1",
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { NewTaskDialog, openNewTask } from "./new-task";

afterEach(cleanup);

beforeEach(() => {
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({ id: "t1" });
  toastSuccess.mockReset();
  toastError.mockReset();
});

function openWith(context = {}) {
  render(<NewTaskDialog />);
  act(() => openNewTask(context));
}

function typeTitle(value: string) {
  fireEvent.change(screen.getByLabelText("What needs doing?"), {
    target: { value },
  });
}

describe("#689 New task", () => {
  it("asks for a title and hides everything else under More", () => {
    openWith();
    expect(screen.getByLabelText("What needs doing?")).toBeTruthy();
    expect(screen.queryByLabelText("Assignee")).toBeNull();
    expect(screen.queryByLabelText("Due")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByLabelText("Due")).toBeTruthy();
    expect((screen.getByLabelText("Due") as HTMLInputElement).value).toBe("");
  });

  it("creates from the title alone: assigned to me, no due, no link", async () => {
    openWith();
    typeTitle("  Order a furnace filter ");
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      title: "Order a furnace filter",
      assigned_user_id: "me-1",
    });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("refuses an empty title without calling the server", async () => {
    openWith();
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Give the task a title.");
  });

  it("links a contact when opened from a contact", async () => {
    openWith({ contactId: "c1", contactName: "Pat Plumber" });
    expect(screen.getByText("For Pat Plumber")).toBeTruthy();
    typeTitle("Quote the boiler");
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ contact_id: "c1" });
    expect(mutateAsync.mock.calls[0][0]).not.toHaveProperty("conversation_id");
  });

  it("links the conversation, and only it, when opened from a conversation", async () => {
    openWith({ conversationId: "v1", contactId: "c1" });
    typeTitle("Call back");
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const body = mutateAsync.mock.calls[0][0];
    expect(body).toMatchObject({ conversation_id: "v1" });
    expect(body).not.toHaveProperty("contact_id");
  });

  it("says so when the server refuses", async () => {
    mutateAsync.mockRejectedValue(new Error("nope"));
    openWith();
    typeTitle("Anything");
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't create the task. Try again."),
    );
  });
});
