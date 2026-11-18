/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n/provider";
import type { ConversationListItem } from "@/lib/api/types";

import { ConversationRow } from "./conversation-row";

vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "company-1" }));
vi.mock("@/components/thread/conversation-actions", () => ({
  useConversationActions: () => ({ actions: [], dialogs: null }),
}));
vi.mock("./member-avatar", () => ({ useMemberNames: () => new Map([["member-1", "Sam"]]) }));

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
