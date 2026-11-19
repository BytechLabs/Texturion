/** @vitest-environment happy-dom */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { UnreadTitleManager } from "@/components/notifications/unread-title-manager";
import { LocaleProvider } from "@/i18n/provider";

import { DocumentTitleProvider, useDocumentTitle } from "./document-title";

vi.mock("./use-unread-count", () => ({ useUnreadConversationCount: () => 2 }));

afterEach(() => {
  cleanup();
  document.title = "";
});

function ThreadTitle({ name }: { name: string }) {
  useDocumentTitle(name);
  return <h1>{name}</h1>;
}

function inbox(name: string | null) {
  return (
    <LocaleProvider userLocale="fr-CA">
      <DocumentTitleProvider baseName="Boîte de réception">
        {name && <ThreadTitle name={name} />}
        <UnreadTitleManager />
      </DocumentTitleProvider>
    </LocaleProvider>
  );
}

it("retitles the tab across threads and back to the inbox with the unread count", async () => {
  document.title = "Loonext";
  const { rerender, unmount } = render(inbox("Maria Alvarez"));
  await waitFor(() => expect(document.title).toBe("(2) Maria Alvarez · Loonext"));

  rerender(inbox("Priya Natarajan"));
  await waitFor(() => expect(document.title).toBe("(2) Priya Natarajan · Loonext"));

  rerender(inbox(null));
  await waitFor(() => expect(document.title).toBe("(2) Boîte de réception · Loonext"));

  unmount();
  expect(document.title).toBe("Loonext");
});
