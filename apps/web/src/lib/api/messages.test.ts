import { describe, expect, it, vi } from "vitest";

import type { ConversationListItem, Message } from "./types";

// messages.ts transitively imports the API client, whose env module validates
// NEXT_PUBLIC_* at import time. Stub the required values (test fixtures, not
// product configuration) before dynamically importing the module under test.
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.local");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "stub-publishable-key");
vi.stubEnv("NEXT_PUBLIC_API_URL", "https://stub-api.local");

const { sentConversationPatch } = await import("./messages");

// ---------------------------------------------------------------------------
// Fixtures (mirroring cache.test.ts)
// ---------------------------------------------------------------------------

const T1 = "2026-06-01T10:00:00.000Z";
const T2 = "2026-06-01T11:00:00.000Z";

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
    pinned_at: null,
    pinned_by_user_id: null,
    created_at: createdAt,
    attachments: [],
    ...overrides,
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
    pinned_at: null,
    pinned_by_user_id: null,
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

// ---------------------------------------------------------------------------
// sentConversationPatch (#55) — the list row after the viewer's own send
// ---------------------------------------------------------------------------

describe("sentConversationPatch", () => {
  it("bumps the sort key AND replaces the preview snippet with the sent message", () => {
    const row = listItem("conv-1", T1);
    const sent = message("msg-new", T2, { body: "On my way!" });

    const patched = sentConversationPatch(row, sent);

    expect(patched.last_message_at).toBe(T2);
    expect(patched.last_message).toEqual({
      id: "msg-new",
      direction: "outbound",
      body: "On my way!",
      created_at: T2,
      has_attachments: false,
    });
  });

  it("clears the unread dot — the sender just read the thread they replied in", () => {
    const row = listItem("conv-1", T1, { unread: true });
    const patched = sentConversationPatch(row, message("msg-new", T2));
    expect(patched.unread).toBe(false);
  });

  it("marks the snippet as carrying attachments when the sent row kept its media", () => {
    const row = listItem("conv-1", T1);
    const sent = message("msg-new", T2, {
      attachments: [
        { id: "att-1", content_type: "image/jpeg", size_bytes: 1024 },
      ],
    });
    expect(sentConversationPatch(row, sent).last_message?.has_attachments).toBe(
      true,
    );
  });

  it("does not mutate the input row", () => {
    const row = listItem("conv-1", T1, { unread: true });
    sentConversationPatch(row, message("msg-new", T2));
    expect(row.unread).toBe(true);
    expect(row.last_message_at).toBe(T1);
    expect(row.last_message?.id).toBe("message-conv-1");
  });
});
