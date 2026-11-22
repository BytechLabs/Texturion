/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n/provider";
import type { ConversationListItem } from "@/lib/api/types";

import { ConversationRow } from "./conversation-row";

vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "company-1" }));
vi.mock("@/components/thread/conversation-actions", () => ({
  useConversationActions: () => ({ actions: [], dialogs: null }),
}));
vi.mock(import("./member-avatar"), async (importOriginal) => ({
  ...await importOriginal(),
  useMemberNames: () => new Map([["member-1", "Sam"]]),
}));

const AT = "2026-11-01T12:00:00Z";
const ROW: ConversationListItem = {
  id: "conversation-1",
  company_id: "company-1",
  contact_id: "contact-1",
  phone_number_id: "line-1",
  status: "open",
  is_spam: true,
  assigned_user_id: "member-1",
  pinned_at: AT,
  pinned_by_user_id: "member-1",
  emergency_at: AT,
  muted: true,
  closed_at: null,
  created_at: AT,
  updated_at: AT,
  last_message_at: AT,
  contact: { id: "contact-1", name: "Dana", phone_e164: "+14165550100" },
  tags: [{ id: "tag-1", name: "Heating", color: null }],
  unread: true,
  last_message: null,
};

afterEach(cleanup);

it.each([
  { locale: "en", name: "Conversation with Dana, urgent, unread, pinned, muted, assigned to Sam, spam, tagged Heating" },
  { locale: "fr-CA", name: "Conversation avec Dana, urgente, non lue, épinglée, en sourdine, assignée à Sam, indésirable, étiquetée Heating" },
])("announces the row's visible state in $locale", ({ locale, name }) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LocaleProvider userLocale={locale}>
        <ConversationRow conversation={ROW} active={false} spamView />
      </LocaleProvider>
    </QueryClientProvider>,
  );

  const link = screen.getByRole("link", { name: `${name}. (416) 555-0100` });
  expect(link.getAttribute("href")).toBe("/inbox/conversation-1");
});

const timestamp = "2026-11-17T20:00:00.000Z";
const conversation: ConversationListItem = {
  id: "thread",
  company_id: "workspace",
  contact_id: "customer",
  phone_number_id: "line",
  status: "open",
  is_spam: false,
  assigned_user_id: null,
  pinned_at: null,
  pinned_by_user_id: null,
  last_message_at: timestamp,
  closed_at: null,
  emergency_at: null,
  created_at: timestamp,
  updated_at: timestamp,
  contact: { id: "customer", name: "Dana", phone_e164: "+16135550100" },
  tags: [],
  unread: false,
  last_message: {
    id: "incoming",
    direction: "inbound",
    body: "Did you get my text?",
    created_at: timestamp,
    has_attachments: false,
    attachment_count: 0,
    attachment_kind: null,
  },
};

describe("ConversationRow delivery state", () => {
  it.each([["en", "Not delivered"], ["fr-CA", "Non livré"]])(
    "shows the failed send alongside a newer incoming preview in %s",
    (locale, label) => {
      const queryClient = new QueryClient();
      const row = (lastOutboundFailedAt: string | null) => (
        <QueryClientProvider client={queryClient}>
          <LocaleProvider userLocale={locale}>
            <ConversationRow
              conversation={{ ...conversation, last_outbound_failed_at: lastOutboundFailedAt }}
              active={false}
              spamView={false}
            />
          </LocaleProvider>
        </QueryClientProvider>
      );
      const { rerender } = render(row(timestamp));
      expect(screen.getByText(label)).toBeInstanceOf(Element);
      expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInstanceOf(Element);
      expect(screen.getByText("Did you get my text?")).toBeInstanceOf(Element);

      rerender(row(null));
      expect(screen.queryByText(label)).toBeNull();
    },
  );
});
