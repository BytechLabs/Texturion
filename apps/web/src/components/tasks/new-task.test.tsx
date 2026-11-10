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

const { addLabel } = vi.hoisted(() => ({ addLabel: vi.fn() }));

vi.mock("@/lib/api/tasks", () => ({
  useCreateTaskFromMessage: () => ({ isPending: false, mutateAsync }),
  useAddTaskLabel: () => ({ isPending: false, mutateAsync: addLabel }),
}));
vi.mock("@/lib/api/tags", () => ({
  useTags: () => ({
    data: { data: [{ id: "tag-1", name: "Warranty", color: null }] },
  }),
}));
vi.mock("@/lib/api/me", () => ({
  useMe: () => ({ data: { user_id: "me-1" } }),
}));
vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({
    data: {
      data: [
        { id: "m1", user_id: "me-1", display_name: "Sam" },
        { id: "m2", user_id: "u2", display_name: "Ben" },
      ],
    },
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
  addLabel.mockReset();
  addLabel.mockResolvedValue({ labels: [] });
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
      assignee_ids: ["me-1"],
    });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("takes more than one assignee under More, me first (#689 C)", async () => {
    openWith();
    typeTitle("Two-person install");
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));
    expect(screen.getByRole("option", { name: /Sam/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: "Ben" }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      title: "Two-person install",
      assignee_ids: ["me-1", "u2"],
    });
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

  it("sends a non-default priority and a picked label (#693)", async () => {
    openWith();
    typeTitle("Fix the boiler");
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Add label" }));
    fireEvent.click(await screen.findByText("Warranty"));
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      label_ids: ["tag-1"],
    });
    expect(mutateAsync.mock.calls[0][0]).not.toHaveProperty("priority");
  });

  it("will not save a schedule without a due date (#693)", async () => {
    openWith();
    typeTitle("Monthly filter");
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByLabelText("Repeat"));
    expect(await screen.findByText(/needs a due date/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
