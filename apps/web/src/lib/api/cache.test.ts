import { describe, expect, it } from "vitest";

import {
  emptyThread,
  listApplyConversation,
  listPatchConversation,
  listSetUnread,
  snippetFromMessage,
  threadApplyStatus,
  threadPatchMessage,
  threadUpsertMessages,
  type ConversationListData,
  type ThreadData,
} from "./cache";
import type {
  ConversationListItem,
  Message,
  MessageStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function message(
  id: string,
  createdAt: string,
  overrides: Partial<Message> = {},
): Message {
  return {
    id,
    conversation_id: "conv-1",
    direction: "outbound",
    body: `body-${id}`,
    status: "queued",
    segments: null,
    encoding: null,
    sent_by_user_id: "user-1",
    error_code: null,
    error_detail: null,
    telnyx_message_id: null,
    done_at: null,
    done_by_user_id: null,
    created_at: createdAt,
    attachments: [],
    ...overrides,
  };
}

function thread(pages: Message[][]): ThreadData {
  return {
    pages: pages.map((data, index) => ({
      data,
      next_cursor: index === pages.length - 1 ? null : `cursor-${index}`,
    })),
    pageParams: pages.map((_, index) =>
      index === 0 ? undefined : `cursor-${index - 1}`,
    ),
  };
}

function listItem(
  id: string,
  lastMessageAt: string,
  overrides: Partial<ConversationListItem> = {},
): ConversationListItem {
  return {
    id,
    company_id: "company-1",
    contact_id: `contact-${id}`,
    phone_number_id: "number-1",
    status: "open",
    is_spam: false,
    assigned_user_id: null,
    last_message_at: lastMessageAt,
    closed_at: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: lastMessageAt,
    contact: {
      id: `contact-${id}`,
      name: `Contact ${id}`,
      phone_e164: "+14165550100",
    },
    tags: [],
    unread: false,
    last_message: {
      id: `message-${id}`,
      direction: "inbound",
      body: `snippet-${id}`,
      created_at: lastMessageAt,
      has_attachments: false,
    },
    ...overrides,
  };
}

function list(pages: ConversationListItem[][]): ConversationListData {
  return {
    pages: pages.map((data, index) => ({
      data,
      next_cursor: index === pages.length - 1 ? null : `cursor-${index}`,
    })),
    pageParams: pages.map((_, index) =>
      index === 0 ? undefined : `cursor-${index - 1}`,
    ),
  };
}

const T1 = "2026-06-01T10:00:00.000Z";
const T2 = "2026-06-01T11:00:00.000Z";
const T3 = "2026-06-01T12:00:00.000Z";
const T4 = "2026-06-01T13:00:00.000Z";

// ---------------------------------------------------------------------------
// Thread reducers (message.created / message.status / send results)
// ---------------------------------------------------------------------------

describe("threadUpsertMessages", () => {
  it("prepends an unseen message into page 1, newest first", () => {
    const existing = thread([[message("m2", T2), message("m1", T1)]]);
    const next = threadUpsertMessages(existing, [message("m3", T3)]);
    expect(next.pages[0].data.map((m) => m.id)).toEqual(["m3", "m2", "m1"]);
  });

  it("replaces an existing message in place instead of duplicating it", () => {
    const existing = thread([
      [message("m2", T2), message("m1", T1, { status: "queued" })],
    ]);
    const next = threadUpsertMessages(existing, [
      message("m1", T1, { status: "delivered" }),
    ]);
    expect(next.pages[0].data.map((m) => m.id)).toEqual(["m2", "m1"]);
    expect(next.pages[0].data[1].status).toBe("delivered");
  });

  it("replaces on later pages too (page-1 merges never duplicate history)", () => {
    const existing = thread([
      [message("m3", T3)],
      [message("m2", T2), message("m1", T1)],
    ]);
    const next = threadUpsertMessages(existing, [
      message("m2", T2, { status: "delivered" }),
      message("m4", T4),
    ]);
    expect(next.pages[0].data.map((m) => m.id)).toEqual(["m4", "m3"]);
    expect(next.pages[1].data.map((m) => m.id)).toEqual(["m2", "m1"]);
    expect(next.pages[1].data[0].status).toBe("delivered");
  });

  it("keeps (created_at, id) DESC ordering when merging older fetches", () => {
    const existing = thread([[message("m3", T3)]]);
    const next = threadUpsertMessages(existing, [
      message("m1", T1),
      message("m4", T4),
      message("m2", T2),
    ]);
    expect(next.pages[0].data.map((m) => m.id)).toEqual([
      "m4",
      "m3",
      "m2",
      "m1",
    ]);
  });

  it("seeds an empty thread when none is cached", () => {
    const next = threadUpsertMessages(undefined, [message("m1", T1)]);
    expect(next.pages[0].data.map((m) => m.id)).toEqual(["m1"]);
    expect(next.pages[0].next_cursor).toBeNull();
  });

  it("returns the same reference when nothing changed", () => {
    const m1 = message("m1", T1);
    const existing = thread([[m1]]);
    expect(threadUpsertMessages(existing, [m1])).toBe(existing);
    expect(threadUpsertMessages(existing, [])).toBe(existing);
  });

  it("emptyThread produces a mergeable single page", () => {
    const seeded = threadUpsertMessages(emptyThread(), [message("m1", T1)]);
    expect(seeded.pages).toHaveLength(1);
    expect(seeded.pages[0].data[0].id).toBe("m1");
  });
});

describe("threadPatchMessage / threadApplyStatus", () => {
  it("patches one message by id across pages", () => {
    const existing = thread([
      [message("m3", T3)],
      [message("m2", T2), message("m1", T1)],
    ]);
    const next = threadApplyStatus(existing, "m2", "failed" as MessageStatus);
    expect(next.pages[1].data[0].status).toBe("failed");
    expect(next.pages[0]).toBe(existing.pages[0]); // untouched page kept by reference
  });

  it("returns the same reference when the message is not cached", () => {
    const existing = thread([[message("m1", T1)]]);
    expect(threadPatchMessage(existing, "missing", { status: "sent" })).toBe(
      existing,
    );
  });
});

// ---------------------------------------------------------------------------
// Conversation-list reducers (message.created / conversation.updated)
// ---------------------------------------------------------------------------

describe("listApplyConversation", () => {
  it("bumps an updated conversation to the top of page 1 (reorder, no refetch)", () => {
    const existing = list([[listItem("c1", T3), listItem("c2", T2)]]);
    const next = listApplyConversation(
      existing,
      listItem("c2", T4, { unread: true }),
      {},
    );
    expect(next.pages[0].data.map((row) => row.id)).toEqual(["c2", "c1"]);
    expect(next.pages[0].data[0].unread).toBe(true);
  });

  it("moves a row from a later page to page 1 when its key moved forward", () => {
    const existing = list([
      [listItem("c1", T3)],
      [listItem("c2", T1)],
    ]);
    const next = listApplyConversation(existing, listItem("c2", T4), {});
    expect(next.pages[0].data.map((row) => row.id)).toEqual(["c2", "c1"]);
    expect(next.pages[1].data).toHaveLength(0);
  });

  it("inserts a brand-new conversation that matches the list's filters", () => {
    const existing = list([[listItem("c1", T2)]]);
    const next = listApplyConversation(existing, listItem("c9", T3), {
      status: "open",
    });
    expect(next.pages[0].data.map((row) => row.id)).toEqual(["c9", "c1"]);
  });

  it("removes a row that no longer matches the list's filters", () => {
    const existing = list([[listItem("c1", T3), listItem("c2", T2)]]);
    const closed = listItem("c1", T3, {
      status: "closed",
      closed_at: T3,
    });
    const next = listApplyConversation(existing, closed, { status: "open" });
    expect(next.pages[0].data.map((row) => row.id)).toEqual(["c2"]);
  });

  it("never inserts spam into a non-spam list (SPEC §6 threading step 3)", () => {
    const existing = list([[listItem("c1", T2)]]);
    const spam = listItem("c9", T3, { is_spam: true });
    expect(listApplyConversation(existing, spam, {})).toBe(existing);
  });

  it("removes a row that turned spam from the default list", () => {
    const existing = list([[listItem("c1", T3), listItem("c2", T2)]]);
    const next = listApplyConversation(
      existing,
      listItem("c1", T3, { is_spam: true, status: "closed", closed_at: T3 }),
      {},
    );
    expect(next.pages[0].data.map((row) => row.id)).toEqual(["c2"]);
  });

  it("matches assignee and tag filters", () => {
    const existing = list([[]]);
    const mine = listItem("c1", T2, {
      assigned_user_id: "user-9",
      tags: [{ id: "tag-1", name: "Won", color: null }],
    });
    expect(
      listApplyConversation(existing, mine, { assigned_user_id: "user-9" })
        .pages[0].data,
    ).toHaveLength(1);
    expect(
      listApplyConversation(existing, mine, { assigned_user_id: "user-0" }),
    ).toBe(existing);
    expect(
      listApplyConversation(existing, mine, { tag_id: "tag-1" }).pages[0].data,
    ).toHaveLength(1);
    expect(listApplyConversation(existing, mine, { tag_id: "tag-2" })).toBe(
      existing,
    );
  });

  it("patches in place but never inserts when the filter is not client-evaluable (q)", () => {
    const withRow = list([[listItem("c1", T2)]]);
    const patched = listApplyConversation(withRow, listItem("c1", T3), {
      q: "leak",
    });
    expect(patched.pages[0].data[0].last_message_at).toBe(T3);

    const withoutRow = list([[listItem("c2", T2)]]);
    expect(
      listApplyConversation(withoutRow, listItem("c9", T3), { q: "leak" }),
    ).toBe(withoutRow);
  });
});

describe("listPatchConversation / listSetUnread", () => {
  it("patches fields in place without reordering", () => {
    const existing = list([[listItem("c1", T3), listItem("c2", T2)]]);
    const next = listPatchConversation(existing, "c2", {
      status: "waiting",
    });
    expect(next.pages[0].data.map((row) => row.id)).toEqual(["c1", "c2"]);
    expect(next.pages[0].data[1].status).toBe("waiting");
  });

  it("clears the unread flag when a thread is opened", () => {
    const existing = list([[listItem("c1", T3, { unread: true })]]);
    const next = listSetUnread(existing, "c1", false);
    expect(next.pages[0].data[0].unread).toBe(false);
  });

  it("returns the same reference for unknown conversations", () => {
    const existing = list([[listItem("c1", T3)]]);
    expect(listSetUnread(existing, "missing", true)).toBe(existing);
  });
});

describe("snippetFromMessage", () => {
  it("maps a message to the G4 list-row snippet embed", () => {
    expect(
      snippetFromMessage(
        message("m1", T1, { direction: "note", body: "check the valves" }),
      ),
    ).toEqual({
      id: "m1",
      direction: "note",
      body: "check the valves",
      created_at: T1,
      has_attachments: false,
    });
  });

  it("flags attachments (and tolerates the bare compose row's missing array)", () => {
    const withMedia = message("m2", T1, {
      body: "",
      attachments: [{ id: "a1", content_type: "image/jpeg", size_bytes: 100 }],
    });
    expect(snippetFromMessage(withMedia).has_attachments).toBe(true);

    const bare = message("m3", T1);
    delete bare.attachments;
    expect(snippetFromMessage(bare).has_attachments).toBe(false);
  });
});
