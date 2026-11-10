/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const state = { canDelete: true };
const deleteCall = vi.fn();
const deleteVoicemail = vi.fn();

vi.mock("@/lib/hooks/use-records-delete", () => ({
  useCanDeleteRecords: () => state.canDelete,
  useDeletedToast: () => vi.fn(),
}));
vi.mock("@/lib/api/trash", () => ({
  useDeleteCall: () => ({ mutate: deleteCall, isPending: false }),
  useDeleteVoicemail: () => ({ mutate: deleteVoicemail, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { CallActions } from "./call-actions";

beforeEach(() => {
  state.canDelete = true;
  deleteCall.mockReset();
  deleteVoicemail.mockReset();
});

function open() {
  const trigger = screen.getByRole("button", {
    name: "Actions for the call from Dana",
  });
  fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("CallActions (#691)", () => {
  it("renders nothing for a member without records.delete", () => {
    state.canDelete = false;
    const { container } = render(
      <CallActions callId="k-1" callerName="Dana" hasVoicemail />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("offers voicemail-only delete only when there is a voicemail", () => {
    render(<CallActions callId="k-1" callerName="Dana" hasVoicemail={false} />);
    open();
    expect(screen.queryByText("Delete voicemail")).toBeNull();
    expect(screen.getByText("Delete call")).toBeTruthy();
  });

  it("deletes by the call-log row id", () => {
    render(<CallActions callId="k-1" callerName="Dana" hasVoicemail />);
    open();
    fireEvent.click(screen.getByText("Delete voicemail"));
    expect(deleteVoicemail.mock.calls[0][0]).toBe("k-1");
    expect(deleteCall).not.toHaveBeenCalled();
  });
});
