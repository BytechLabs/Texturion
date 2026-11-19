/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { keys } from "@/lib/api/keys";

import { Composer } from "./composer";

vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "workspace",
  useActiveCompany: () => ({ role: "owner" }),
}));

vi.mock("@/lib/api/client", () => ({
  apiFetch: () => Promise.resolve({ data: [] }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function showComposer(noteOnly = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  queryClient.setQueryData(keys.me, { memberships: [{ company_id: "workspace", role: "owner" }] });

  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Composer conversationId="thread" noteOnly={noteOnly} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

async function openMenu(name: string) {
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "ArrowDown" });
  return screen.findByRole("menu");
}

it("moves Quote and Note under Add to message and preserves the draft when switching", async () => {
  showComposer();
  expect(screen.queryByRole("button", { name: "Note" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Quote this job" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Ready to review" },
  });

  await openMenu("Add to message");
  expect(screen.queryByRole("menuitem", { name: "Quote this job" })).not.toBeNull();
  fireEvent.click(screen.getByRole("menuitem", { name: "Note" }));
  await waitFor(() => {
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Internal note" }));
  });

  await openMenu("Note");
  expect(screen.queryByRole("menuitem", { name: "Attach files to this note" })).not.toBeNull();
  fireEvent.click(screen.getByRole("menuitem", { name: "Text" }));
  const input = screen.getByRole("textbox", { name: "Message" });
  expect(input).toHaveProperty("value", "Ready to review");
  await waitFor(() => { expect(document.activeElement).toBe(input); });
});

it("provides attachments without a mode switch for a note-only member", () => {
  showComposer(true);
  expect(screen.queryByRole("button", { name: "Attach files to this note" })).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Add to message" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
});
