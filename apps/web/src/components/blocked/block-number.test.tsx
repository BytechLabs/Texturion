/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const blockMutate = vi.fn();
const unblockMutate = vi.fn();
const role = { current: "member" as string };
const rows = { current: [] as { id: string; phone_e164: string }[] };

vi.mock("@/lib/api/blocked-senders", () => ({
  useBlockedSenders: () => ({ data: { data: rows.current } }),
  useBlockSender: () => ({ mutate: blockMutate, isPending: false }),
  useUnblockSender: () => ({ mutate: unblockMutate, isPending: false }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: role.current }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { BlockNumberDialog, useBlockedNumber } from "./block-number";

beforeEach(() => {
  blockMutate.mockReset();
  unblockMutate.mockReset();
  role.current = "member";
  rows.current = [];
});

function Probe({ phone }: { phone: string }) {
  const state = useBlockedNumber(phone);
  return (
    <div>
      <span data-testid="blocked">{String(state.blocked !== undefined)}</span>
      <span data-testid="can">{String(state.canManage)}</span>
      <button onClick={state.unblock}>unblock</button>
    </div>
  );
}

describe("BlockNumberDialog", () => {
  it("says what a block does and that the crew can still text the number", () => {
    render(
      <BlockNumberDialog phone="+14165550182" open onOpenChange={vi.fn()} />,
    );
    expect(screen.getByText("Block (416) 555-0182?")).toBeTruthy();
    expect(
      screen.getByText(
        "Future texts and calls from this number go straight to spam. You can still text them.",
      ),
    ).toBeTruthy();
  });

  it("blocks the E.164 number on confirm, and not before", () => {
    render(
      <BlockNumberDialog phone="+14165550182" open onOpenChange={vi.fn()} />,
    );
    expect(blockMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(blockMutate).toHaveBeenCalledTimes(1);
    expect(blockMutate.mock.calls[0][0]).toBe("+14165550182");
  });

  it("cancel closes without blocking", () => {
    const onOpenChange = vi.fn();
    render(
      <BlockNumberDialog phone="+14165550182" open onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(blockMutate).not.toHaveBeenCalled();
  });
});

describe("useBlockedNumber", () => {
  it("is not blocked when the number is not on the list", () => {
    rows.current = [{ id: "b-1", phone_e164: "+14165559999" }];
    render(<Probe phone="+14165550182" />);
    expect(screen.getByTestId("blocked").textContent).toBe("false");
  });

  it("unblocks by the list row's id", () => {
    rows.current = [{ id: "b-1", phone_e164: "+14165550182" }];
    render(<Probe phone="+14165550182" />);
    expect(screen.getByTestId("blocked").textContent).toBe("true");
    fireEvent.click(screen.getByText("unblock"));
    expect(unblockMutate.mock.calls[0][0]).toBe("b-1");
  });

  it("is gated like Mark spam: a read-only role may not manage", () => {
    role.current = "read_only";
    render(<Probe phone="+14165550182" />);
    expect(screen.getByTestId("can").textContent).toBe("false");
  });

  it("lets a member manage, as a member may mark spam", () => {
    render(<Probe phone="+14165550182" />);
    expect(screen.getByTestId("can").textContent).toBe("true");
  });
});
