/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationListItem } from "@/lib/api/types";
import { writeSingleKeyShortcuts } from "@/lib/inbox/shortcut-preference";
import { onInboxSearchFocusRequest } from "@/lib/inbox/shortcuts";
import { useInboxShortcuts } from "./use-inbox-shortcuts";

afterEach(cleanup);

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/conversations", () => ({
  useSnoozeConversation: () => ({ mutate: vi.fn() }),
  useMarkConversationRead: () => ({ mutate: vi.fn() }),
  useMarkConversationUnread: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/api/tags", () => ({ useTags: () => ({ data: { data: [] } }) }));
vi.mock("@/lib/api/team", () => ({ useMembers: () => ({ data: { data: [] } }) }));



const ROWS = ["c-1", "c-2", "c-3"].map((id, index) => ({
  id,
  unread: false,
  contact: { name: `Contact ${index + 1}`, phone_e164: "+12125550123" },
})) as unknown as ConversationListItem[];

const runBulkOn = vi.fn();
const scrollToIndex = vi.fn();

function Harness({ listQuery }: { listQuery?: string }) {
  const { cursorId, overlays } = useInboxShortcuts({
    rows: ROWS,
    activeConversationId: null,
    listQuery,
    scrollToIndex,
    runBulkOn,
  });
  return (
    <div>
      <span data-testid="cursor">{cursorId ?? "none"}</span>
      <input aria-label="field" />
      <textarea aria-label="composer" data-composer />
      <div contentEditable suppressContentEditableWarning aria-label="editable">
        x
      </div>
      {overlays}
    </div>
  );
}

const cursor = () => screen.getByTestId("cursor").textContent;

beforeEach(() => {
  push.mockReset();
  runBulkOn.mockReset();
  scrollToIndex.mockReset();
  writeSingleKeyShortcuts(true);
});

describe("inbox shortcuts", () => {
  it("j and k move the cursor, Enter opens, e closes the row", () => {
    render(<Harness />);
    fireEvent.keyDown(document.body, { key: "j" });
    expect(cursor()).toBe("c-1");
    fireEvent.keyDown(document.body, { key: "j" });
    expect(cursor()).toBe("c-2");
    fireEvent.keyDown(document.body, { key: "k" });
    expect(cursor()).toBe("c-1");
    fireEvent.keyDown(document.body, { key: "j" });

    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/inbox/c-2");

    fireEvent.keyDown(document.body, { key: "e" });
    expect(runBulkOn).toHaveBeenCalledWith(
      ["c-2"],
      { action: "set_status", target_status: "closed" },
      expect.any(String),
    );
  });

  it("no shortcut fires inside an input, the composer, or editable text", () => {
    render(<Harness />);
    fireEvent.keyDown(document.body, { key: "j" });
    for (const label of ["field", "composer", "editable"]) {
      const target = screen.getByLabelText(label);
      for (const key of ["j", "k", "e", "s", "a", "l", "r", "u", "/", "?", "Enter"]) {
        fireEvent.keyDown(target, { key });
      }
    }
    expect(cursor()).toBe("c-1");
    expect(runBulkOn).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the next thread with the current inbox filters", () => {
    const view = render(<Harness listQuery="status=open" />);
    fireEvent.keyDown(document.body, { key: "j" });
    view.rerender(<Harness listQuery="status=closed&tag=tag-id&task=previous" />);
    fireEvent.keyDown(document.body, { key: "Enter" });

    expect(push).toHaveBeenCalledExactlyOnceWith("/inbox/c-1?status=closed&tag=tag-id");
  });

  it("? opens the cheat sheet, listing keys from the keymap", () => {
    render(<Harness />);
    fireEvent.keyDown(document.body, { key: "?" });
    expect(screen.getByRole("dialog")).toBeInstanceOf(Element);
    expect(screen.getByText("Keyboard shortcuts")).toBeInstanceOf(Element);
    expect(screen.getByText("Next conversation")).toBeInstanceOf(Element);
    expect(screen.getByText("Alt+T")).toBeInstanceOf(Element);
    expect(screen.getByText("Focus the notifications and Undo actions")).toBeInstanceOf(Element);
  });

  it("/ requests inbox search focus even while search is collapsed", () => {
    const requested = vi.fn();
    const stop = onInboxSearchFocusRequest(requested);
    try {
      render(<Harness />);
      fireEvent.keyDown(document.body, { key: "/" });
      expect(requested).toHaveBeenCalledOnce();
    } finally {
      stop();
    }
  });

  it("does nothing when single-key shortcuts are turned off", () => {
    writeSingleKeyShortcuts(false);
    render(<Harness />);
    act(() => {
      fireEvent.keyDown(document.body, { key: "j" });
      fireEvent.keyDown(document.body, { key: "?" });
    });
    expect(cursor()).toBe("none");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
