/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { SearchConversationHit, SearchResult } from "@/lib/api/types";

import { SearchResults } from "./search-results";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock(import("@/lib/api/client"), () => ({ apiFetch }));
vi.mock(import("@/lib/company/provider"), () => ({ useCompanyId: () => "company" }));
vi.mock(import("@/components/settings/settings-link-guard"), () => ({
  useCanOpenSettings: () => () => true,
}));

const time = "2026-11-17T12:00:00Z";
const emptyPage: SearchResult = {
  conversations: [],
  contacts: [],
  tasks: [],
  attachments: [],
  templates: [],
  voicemails: [],
  next_cursor: null,
};

function conversation(number: number): SearchConversationHit {
  return {
    id: `thread-${number}`,
    status: "open",
    is_spam: false,
    last_message_at: time,
    contact: { id: `contact-${number}`, name: `Customer ${number}`, phone_e164: "+14165550123" },
    matched_message_id: `message-${number}`,
    matched_at: time,
    direction: "inbound",
    snippet: "<b>Maple</b> Street",
  };
}

function openSearch(first: SearchResult, next?: SearchResult) {
  apiFetch.mockImplementation((_path, { searchParams }) =>
    Promise.resolve(searchParams.cursor ? next : first),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SearchResults q="Maple" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
});

it("loads page two into the Inbox and keeps the first twenty conversations", async () => {
  openSearch(
    {
      ...emptyPage,
      conversations: Array.from({ length: 20 }, (_, index) => conversation(index + 1)),
      next_cursor: "page-two",
    },
    { ...emptyPage, conversations: [conversation(20), conversation(21)] },
  );

  await expect(screen.findByRole("link", { name: /Customer 20/ })).resolves.toBeInstanceOf(Element);
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await expect(screen.findByRole("link", { name: /Customer 21/ })).resolves.toBeInstanceOf(Element);
  expect(screen.getAllByRole("link")).toHaveLength(21);
  expect(apiFetch.mock.calls[1][1].searchParams.cursor).toBe("page-two");
});

it("opens a matched contact's thread and shows separate task and voicemail hits", async () => {
  openSearch({
    ...emptyPage,
    contacts: [{
      id: "pat",
      name: "Pat Rivera",
      phone_e164: "+14165550123",
      matched_line: "81 Maple Street",
      conversation: { id: "pat-thread", status: "open", last_message_at: time },
    }],
    tasks: [{
      id: "task",
      title: "Maple installation",
      conversation_id: null,
      done: false,
      matched_at: time,
    }],
    voicemails: [{
      id: "voicemail",
      call_session_id: "call",
      contact_id: null,
      caller_e164: null,
      started_at: time,
      snippet: "Maple Street",
    }],
  });

  expect((await screen.findByRole("link", { name: /Pat Rivera/ })).getAttribute("href")).toBe("/inbox/pat-thread");
  expect(screen.getByRole("link", { name: /Pat Rivera.*81 Maple Street/ })).toBeInstanceOf(Element);
  expect(screen.getByRole("link", { name: "Maple installation" }).getAttribute("href")).toBe("/tasks?task=task");
  expect(screen.getByRole("link", { name: /Voicemail.*Maple Street/ }).getAttribute("href")).toBe("/calls/call");
  expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toContain("/inbox/new?contact=pat");
});
