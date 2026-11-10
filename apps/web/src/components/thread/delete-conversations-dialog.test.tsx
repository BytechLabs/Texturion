/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const mutate = vi.fn();
const announce = vi.fn();
const toastApi = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/lib/api/trash", () => ({
  useDeleteConversations: () => ({ mutate, isPending: false }),
}));
vi.mock("@/lib/hooks/use-records-delete", () => ({
  useDeletedToast: () => announce,
}));
vi.mock("sonner", () => ({ toast: toastApi }));

import { DeleteConversationsDialog } from "./delete-conversations-dialog";

beforeEach(() => {
  mutate.mockReset();
  announce.mockReset();
  Object.values(toastApi).forEach((fn) => fn.mockReset());
});

function renderDialog(ids: string[], onDeleted = vi.fn()) {
  const onOpenChange = vi.fn();
  render(
    <DeleteConversationsDialog
      ids={ids}
      open
      onOpenChange={onOpenChange}
      onDeleted={onDeleted}
    />,
  );
  return { onOpenChange, onDeleted };
}

describe("DeleteConversationsDialog (#691)", () => {
  it("puts the count in the question and states what stays", () => {
    renderDialog(["a", "b", "c"]);
    expect(screen.getByText("Delete 3 conversations?")).toBeTruthy();
    expect(screen.getByText(/stay on the customer's phone/)).toBeTruthy();
    expect(screen.getByText(/STOP/)).toBeTruthy();
  });

  it("asks about one conversation in the singular", () => {
    renderDialog(["a"]);
    expect(screen.getByText("Delete this conversation?")).toBeTruthy();
  });

  it("builds the undo from what the server deleted, not from the selection", () => {
    mutate.mockImplementation((_ids, options) =>
      options.onSuccess({ deleted: ["a", "b"] }),
    );
    const { onDeleted } = renderDialog(["a", "b", "c"]);
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));

    expect(onDeleted).toHaveBeenCalledWith(["a", "b"]);
    expect(toastApi.warning).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledWith("2 conversations moved to Trash", [
      { kind: "conversation", id: "a" },
      { kind: "conversation", id: "b" },
    ]);
  });

  it("reports a failure rather than an undo when nothing was deleted", () => {
    mutate.mockImplementation((_ids, options) =>
      options.onSuccess({ deleted: [] }),
    );
    renderDialog(["a"]);
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    expect(toastApi.error).toHaveBeenCalledOnce();
    expect(announce).not.toHaveBeenCalled();
  });
});
