/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n/provider";
import type { Message } from "@/lib/api/types";

import { MessageBubble } from "./message-bubble";

const message: Message = {
  id: "m1",
  conversation_id: "c1",
  direction: "inbound",
  body: "Is Tuesday free?",
  status: "received",
  segments: 1,
  encoding: "GSM-7",
  sent_by_user_id: null,
  error_code: null,
  error_detail: null,
  telnyx_message_id: null,
  done_at: null,
  done_by_user_id: null,
  pinned_at: null,
  pinned_by_user_id: null,
  created_at: "2026-11-17T15:00:00.000Z",
  attachments: [],
};

vi.mock("@/lib/api/messages", () => ({
  useRetryMessage: () => ({ mutate: vi.fn(), isPending: false }),
  useSetMessageDone: () => ({ mutate: vi.fn() }),
  useSetMessagePinned: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/api/trash", () => ({
  useDeleteMessage: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/use-records-delete", () => ({
  useCanDeleteRecords: () => false,
  useDeletedToast: () => vi.fn(),
}));

afterEach(cleanup);

it("describes each repeated action with that message's sender and text", () => {
  const { container } = render(
    <>
      <MessageBubble
        message={message}
        isLastOfCluster={false}
        conversationId="c1"
        contactName="Maria"
        reaction="👍"
      />
      <MessageBubble
        message={{
          ...message,
          id: "m2",
          direction: "outbound",
          body: "Tuesday works.",
          status: "delivered",
        }}
        isLastOfCluster
        conversationId="c1"
        contactName="Maria"
        senderName="Dana"
      />
    </>,
  );
  expect(screen.getByRole("button", {
    name: "Mark done",
    description: "Maria: Is Tuesday free?",
  })).toBeInstanceOf(Element);
  expect(screen.getByRole("button", {
    name: "More actions",
    description: "Dana: Tuesday works.",
  })).toBeInstanceOf(Element);
  expect(screen.getByText("👍").textContent).toBe("👍");
  expect(container.querySelector("time.sr-only")?.getAttribute("datetime")).toBe(message.created_at);
});

it("speaks the automated sender in French", () => {
  render(
    <LocaleProvider userLocale="fr-CA">
      <MessageBubble
        message={{ ...message, direction: "outbound", status: "sent", body: "À bientôt." }}
        isLastOfCluster
        conversationId="c1"
        contactName="Maria"
        senderName="Envoyé automatiquement"
      />
    </LocaleProvider>,
  );
  expect(screen.getByRole("button", {
    name: "Plus d'actions",
    description: "Envoyé automatiquement : À bientôt.",
  })).toBeInstanceOf(Element);
});
