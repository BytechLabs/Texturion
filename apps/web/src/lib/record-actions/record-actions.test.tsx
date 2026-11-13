/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The builders live beside the surfaces that use them. Mocked so importing
// them pulls in no data layer: only the action DEFINITIONS are under test.
vi.mock("@/components/calls/call-button", () => ({
  usePlaceCall: () => ({ place: vi.fn(), busy: false }),
}));

import { buildCallActions } from "@/components/calls/call-actions";
import { buildContactActions } from "@/components/contacts/contact-record-actions";
import { buildScheduledActions } from "@/components/scheduled/scheduled-view";
import { buildTaskActions } from "@/components/tasks/task-actions";
import {
  buildConversationActions,
  statusChoices,
} from "@/components/thread/conversation-actions";
import { buildMessageActions } from "@/components/thread/message-actions";
import {
  RecordContextMenu,
  RecordOverflowMenu,
} from "@/components/ui/record-menu";
import { makeTranslate } from "@/i18n/translate";

import { actionIds, submenuItems, type RecordAction } from "./types";

afterEach(cleanup);

const t = makeTranslate("en");

/** Every handler a builder asks for, as a no-op. Only WHAT is offered is under test. */
function noopRun<T>(): T {
  return new Proxy({}, { get: () => () => {} }) as T;
}

function ids(menuRoot: ParentNode = document): string[] {
  return Array.from(
    menuRoot.querySelectorAll('[role="menu"] [data-action]'),
  ).map((el) => el.getAttribute("data-action") ?? "");
}

/** What the ⋯ button lists. */
function fromOverflow(actions: RecordAction[]): string[] {
  const view = render(<RecordOverflowMenu actions={actions} label="More" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "More" }), { key: "Enter" });
  const listed = ids();
  view.unmount();
  cleanup();
  return listed;
}

/** What a right-click on the record's row lists. */
function fromContextMenu(actions: RecordAction[]): string[] {
  const view = render(
    <RecordContextMenu actions={actions}>
      <div data-testid="row">row</div>
    </RecordContextMenu>,
  );
  fireEvent.contextMenu(screen.getByTestId("row"));
  const listed = ids();
  view.unmount();
  cleanup();
  return listed;
}

/**
 * The contract for every record type, for one viewer: the ⋯ menu and the
 * right-click menu list the same actions in the same order, and that order is
 * `expected`. A viewer with nothing allowed gets no menu from either.
 */
function expectOneList(label: string, actions: RecordAction[], expected: string[]) {
  it(`${label}: ⋯ and right-click list the same actions, in order`, () => {
    expect(actionIds(actions)).toEqual(expected);
    if (expected.length === 0) {
      render(
        <RecordContextMenu actions={actions}>
          <div data-testid="row">row</div>
        </RecordContextMenu>,
      );
      const notPrevented = fireEvent.contextMenu(screen.getByTestId("row"));
      expect(screen.queryByRole("menu")).toBeNull();
      expect(notPrevented).toBe(true);
      cleanup();
      const overflow = render(<RecordOverflowMenu actions={actions} label="More" />);
      expect(overflow.container.innerHTML).toBe("");
      return;
    }
    expect(fromOverflow(actions)).toEqual(expected);
    expect(fromContextMenu(actions)).toEqual(expected);
  });
}

describe("#712 conversation", () => {
  const base = {
    t,
    state: {
      status: "open" as const,
      isSpam: false,
      pinned: false,
      unread: false,
      muted: false,
      followed: false,
      snoozedUntil: null,
      snoozeKind: null,
      assignedUserId: null,
    },
    members: [{ id: "u-1", name: "Sam", isYou: true }],
    blocked: false,
    unblocking: false,
    surface: { openHref: "/inbox/c-1", hasGallery: false, hasCatchUp: false },
    run: noopRun<Parameters<typeof buildConversationActions>[0]["run"]>(),
  };
  const build = (canWrite: boolean, canDelete: boolean) =>
    buildConversationActions({ ...base, viewer: { canWrite, canDelete } });

  expectOneList("owner on an inbox row", build(true, true), [
    "open", "open-new-tab", "mark-unread", "assign", "close", "pin", "snooze",
    "follow-up", "mute", "follow", "spam", "block", "delete",
  ]);
  expectOneList("member on an inbox row (no records.delete)", build(true, false), [
    "open", "open-new-tab", "mark-unread", "assign", "close", "pin", "snooze",
    "follow-up", "mute", "follow", "spam", "block",
  ]);
  expectOneList("read-only on an inbox row", build(false, false), [
    "open", "open-new-tab", "mark-unread", "snooze", "follow-up", "mute", "follow",
  ]);

  const header = buildConversationActions({
    ...base,
    viewer: { canWrite: true, canDelete: true },
    surface: { hasGallery: true, hasCatchUp: true },
    optOut: { optedOut: false, carrierEnforced: false },
  });
  expectOneList("owner in the thread header", header, [
    "mark-unread", "catch-up", "assign", "close", "pin", "snooze", "follow-up",
    "mute", "follow", "attachments", "spam", "block", "delete", "opt-out",
  ]);

  it("follows the #710 grouping: state, then alerts, attachments, and the spam/block/delete group last", () => {
    const list = actionIds(header);
    const groupOf = (id: string) => header.find((a) => a.id === id)?.group;
    expect(groupOf(list[0]!)).toBe("state");
    expect(groupOf(list[list.length - 1]!)).toBe("danger");
    expect(list.indexOf("mute")).toBeGreaterThan(list.indexOf("snooze"));
    expect(list.indexOf("attachments")).toBeGreaterThan(list.indexOf("follow"));
    expect(list.indexOf("spam")).toBeGreaterThan(list.indexOf("attachments"));
    expect(header.find((a) => a.id === "delete")?.destructive).toBe(true);
  });

  it("swaps Snooze for Bring back while deferred, and the opt-out for the carrier note after a STOP", () => {
    const deferred = buildConversationActions({
      ...base,
      state: { ...base.state, snoozedUntil: "2026-12-01T09:00:00Z" },
      viewer: { canWrite: true, canDelete: false },
      optOut: { optedOut: true, carrierEnforced: true },
    });
    const listed = actionIds(deferred);
    expect(listed).toContain("unsnooze");
    expect(listed).not.toContain("snooze");
    expect(listed).not.toContain("follow-up");
    expect(listed).toContain("carrier-stop");
    expect(listed).not.toContain("opt-out");
    expect(listed).not.toContain("opt-in");
  });

  it("#722: offers Close and Reopen only when the server's list has them", () => {
    const withMoves = (status: "open" | "closed", allowedActions: string[]) =>
      actionIds(
        buildConversationActions({
          ...base,
          state: { ...base.state, status, allowedActions },
          viewer: { canWrite: true, canDelete: false },
        }),
      );
    expect(withMoves("open", ["mark_waiting", "close"])).toContain("close");
    expect(withMoves("open", ["mark_waiting"])).not.toContain("close");
    expect(withMoves("closed", ["reopen"])).toContain("reopen");
    expect(withMoves("closed", [])).not.toContain("reopen");
  });

  it("#722: the status picker offers the current status and each allowed move's target", () => {
    expect(statusChoices("open", ["mark_waiting", "close"], true)).toEqual([
      "open", "waiting", "closed",
    ]);
    expect(statusChoices("closed", ["reopen"], true)).toEqual(["open", "closed"]);
    expect(statusChoices("open", [], true)).toEqual(["open"]);
    expect(statusChoices("open", undefined, true)).toEqual([
      "new", "open", "waiting", "closed",
    ]);
    expect(statusChoices("open", undefined, false)).toEqual(["open"]);
  });
});

describe("#712 message", () => {
  const base = {
    t,
    message: { body: "Running late", direction: "inbound" as const, pinned: false },
    promotable: true,
    retryable: false,
    retrying: false,
    deleting: false,
    run: noopRun<Parameters<typeof buildMessageActions>[0]["run"]>(),
  };
  expectOneList("owner", buildMessageActions({ ...base, canDelete: true }), [
    "copy-text", "make-task", "pin", "delete",
  ]);
  expectOneList("member (no records.delete)", buildMessageActions({ ...base, canDelete: false }), [
    "copy-text", "make-task", "pin",
  ]);
  expectOneList(
    "owner on a failed send",
    buildMessageActions({
      ...base,
      message: { body: "On my way", direction: "outbound", pinned: true },
      promotable: false,
      retryable: true,
      canDelete: true,
    }),
    ["copy-text", "retry", "pin", "delete"],
  );
  it("names the delete for a note as a note", () => {
    const note = buildMessageActions({
      ...base,
      message: { body: "x", direction: "note", pinned: false },
      canDelete: true,
    });
    expect(note.find((a) => a.id === "delete")?.label).toBe("Delete note");
  });
});

describe("#712 call", () => {
  const base = {
    t,
    callerName: "Dana",
    hasVoicemail: true,
    conversationId: "c-1" as string | null,
    contactId: "k-1" as string | null,
    callerE164: "+12125550123" as string | null,
    // What a call row passes (#734): the row keeps one action, the menu the rest.
    messageHref: "/inbox/c-1" as string | null,
    contactHref: "/contacts/k-1" as string | null,
    detailsHref: "/calls/s-1" as string | null,
    calling: false,
    deletingCall: false,
    deletingVoicemail: false,
    run: noopRun<Parameters<typeof buildCallActions>[0]["run"]>(),
  };
  expectOneList("owner", buildCallActions({ ...base, canDelete: true }), [
    "call-back", "text", "copy-number", "contact", "details", "delete-voicemail", "delete-call",
  ]);
  expectOneList("member (no records.delete)", buildCallActions({ ...base, canDelete: false }), [
    "call-back", "text", "copy-number", "contact", "details",
  ]);
  expectOneList(
    "member on a call from a withheld number",
    buildCallActions({
      ...base,
      canDelete: false,
      conversationId: null,
      contactId: null,
      callerE164: null,
      messageHref: null,
      contactHref: null,
    }),
    ["details"],
  );
  expectOneList(
    "owner on a call with no voicemail",
    buildCallActions({ ...base, canDelete: true, hasVoicemail: false }),
    ["call-back", "text", "copy-number", "contact", "details", "delete-call"],
  );
});

describe("#712 task", () => {
  const base = {
    t,
    task: { done: false, due_at: null },
    deleting: false,
    now: new Date("2026-11-10T12:00:00Z"),
    run: noopRun<Parameters<typeof buildTaskActions>[0]["run"]>(),
  };
  const row = { ...base, openHref: "/tasks?task=t-1", canCopyLink: true };
  expectOneList("owner on a row", buildTaskActions({ ...row, hasAccess: true, canDelete: true }), [
    "open", "copy-link", "done", "due", "delete",
  ]);
  expectOneList("member on a row", buildTaskActions({ ...row, hasAccess: true, canDelete: false }), [
    "open", "copy-link", "done", "due",
  ]);
  expectOneList(
    "member without access to the source thread (#107)",
    buildTaskActions({ ...row, hasAccess: false, canDelete: false }),
    ["open", "copy-link"],
  );
  expectOneList(
    "owner in the detail panel",
    buildTaskActions({ ...base, hasAccess: true, canDelete: true, canCopyLink: false }),
    ["done", "due", "delete"],
  );
  expectOneList(
    "member without access in the detail panel: nothing, so no menu (#713)",
    buildTaskActions({ ...base, hasAccess: false, canDelete: false, canCopyLink: false }),
    [],
  );
});

describe("#712 task: due date without dragging (WCAG 2.5.7)", () => {
  it("offers the calendar's moves from the one list, so a chip, a card and the panel all have them", () => {
    const list = buildTaskActions({
      t,
      task: { done: false, due_at: null },
      hasAccess: true,
      canDelete: false,
      deleting: false,
      canCopyLink: false,
      now: new Date("2026-11-10T12:00:00Z"),
      run: noopRun<Parameters<typeof buildTaskActions>[0]["run"]>(),
    });
    const due = list.find((action) => action.id === "due");
    expect(due && submenuItems(due).map((move) => move.id)).toEqual(["-1", "1", "7"]);
  });
});

describe("#712 contact", () => {
  const base = {
    t,
    optedOut: false,
    carrierEnforced: false,
    blocked: false,
    unblocking: false,
    calling: false,
    openHref: "/contacts/k-1",
    run: noopRun<Parameters<typeof buildContactActions>[0]["run"]>(),
  };
  expectOneList(
    "owner",
    buildContactActions({ ...base, viewer: { canBlock: true, canDelete: true } }),
    ["open", "text", "call", "copy-number", "block", "opt-out", "delete"],
  );
  expectOneList(
    "member",
    buildContactActions({ ...base, viewer: { canBlock: true, canDelete: false } }),
    ["open", "text", "call", "copy-number", "block", "opt-out"],
  );
  expectOneList(
    "read-only",
    buildContactActions({ ...base, viewer: { canBlock: false, canDelete: false } }),
    ["open", "text", "call", "copy-number", "opt-out"],
  );
  expectOneList(
    "owner on a contact who sent STOP: a note, not a button",
    buildContactActions({
      ...base,
      optedOut: true,
      carrierEnforced: true,
      viewer: { canBlock: true, canDelete: true },
    }),
    ["open", "text", "call", "copy-number", "block", "carrier-stop", "delete"],
  );
  expectOneList(
    "owner on a contact opted out in the office: can opt back in",
    buildContactActions({
      ...base,
      optedOut: true,
      viewer: { canBlock: true, canDelete: true },
    }),
    ["open", "text", "call", "copy-number", "block", "opt-in", "delete"],
  );
});

describe("#712 scheduled text", () => {
  const list = buildScheduledActions({
    t,
    cancelling: false,
    run: noopRun<Parameters<typeof buildScheduledActions>[0]["run"]>(),
  });
  expectOneList("any member", list, ["open", "cancel"]);
});
