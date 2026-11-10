/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = { canDelete: true };

vi.mock("@/lib/api/trash", () => ({
  useDeleteCall: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteVoicemail: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/use-records-delete", () => ({
  useCanDeleteRecords: () => state.canDelete,
  useDeletedToast: () => () => undefined,
}));
vi.mock("@/lib/softphone/provider", () => ({
  useSoftphone: () => null,
  MicPermissionError: class MicPermissionError extends Error {},
}));
vi.mock("@/components/calls/voicemail-player", () => ({
  screeningLabel: () => null,
  VoicemailPlayer: () => null,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import type { Call } from "@/lib/api/types";

import { CallRow } from "./call-row";

afterEach(() => {
  cleanup();
  state.canDelete = true;
});

const call = {
  id: "call-1",
  call_session_id: "sess-1",
  caller_e164: "+14165550133",
  caller_name: null,
  contact_id: "k-1",
  contact_name: "Maria Alvarez",
  conversation_id: "conv-1",
  direction: "inbound",
  outcome: "answered",
  screening_result: null,
  started_at: "2026-08-08T18:00:00.000Z",
  forward_seconds: 30,
  voicemail_seconds: null,
  voicemail_transcript: null,
  voicemail_intake: null,
} as unknown as Call;

function listed(): string[] {
  return Array.from(document.querySelectorAll('[role="menu"] [data-action]')).map(
    (el) => el.getAttribute("data-action") ?? "",
  );
}

describe("#712 the call row's menus", () => {
  it("right-click on the row opens the same list the ⋯ button opens", () => {
    const view = render(<CallRow call={call} />);
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Actions for the call from Maria Alvarez" }),
      { key: "Enter" },
    );
    const fromButton = listed();
    expect(fromButton).toEqual([
      "call-back",
      "text",
      "copy-number",
      "delete-call",
    ]);
    view.unmount();
    cleanup();

    const { container } = render(<CallRow call={call} />);
    fireEvent.contextMenu(container.firstElementChild as Element);
    expect(listed()).toEqual(fromButton);
  });

  it("a member who cannot delete still gets the ways to reach the caller", () => {
    state.canDelete = false;
    const { container } = render(<CallRow call={call} />);
    fireEvent.contextMenu(container.firstElementChild as Element);
    expect(listed()).toEqual(["call-back", "text", "copy-number"]);
  });

  it("a call with nobody to reach and nothing deletable has no menu at all", () => {
    state.canDelete = false;
    const withheld = {
      ...call,
      caller_e164: null,
      contact_id: null,
      conversation_id: null,
    } as Call;
    const { container } = render(<CallRow call={withheld} />);
    expect(
      screen.queryByRole("button", { name: /Actions for the call from/ }),
    ).toBeNull();
    const notPrevented = fireEvent.contextMenu(container.firstElementChild as Element);
    expect(notPrevented).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
