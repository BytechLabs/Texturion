/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { loadDraft, loadFailedSend } from "@/lib/messaging/composer-drafts";
import { Composer } from "./composer";

const { apiFetch, toastError } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({ apiFetch }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "company-1",
  useActiveCompany: () => ({
    companyId: "company-1",
    userId: "user-1",
    role: "owner",
  }),
}));

const CONVERSATION_ID = "conversation-1";

function renderComposer() {
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Composer conversationId={CONVERSATION_ID} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  apiFetch.mockReset();
  toastError.mockClear();
});

it("reopens a private draft in Note mode with Save note", () => {
  const first = renderComposer();
  fireEvent.click(screen.getByRole("button", { name: "Note" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Internal note" }), {
    target: { value: "Keep the price private." },
  });
  first.unmount();

  renderComposer();
  const noteTab = screen.getByRole("button", { name: "Note" });
  expect(noteTab.getAttribute("aria-pressed")).toBe("true");
  expect(noteTab.classList.contains("bg-app-amber-bg")).toBe(true);
  const note = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Internal note" });
  expect(note.value).toBe("Keep the price private.");
  expect(screen.getByRole("button", { name: "Save note" })).toBeTruthy();
});

it("stores a failed text and its retry key when the composer has unmounted", async () => {
  const request = Promise.withResolvers<never>();
  apiFetch.mockImplementation((path: string) => path === "/v1/messages/send"
    ? request.promise
    : Promise.reject(new Error("No fixture for this query")));
  const first = renderComposer();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "I'll call in the morning." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(apiFetch.mock.calls.filter(
    ([path]) => path === "/v1/messages/send",
  )).toHaveLength(1));
  first.unmount();
  request.reject(new Error("Gateway timeout"));

  await waitFor(() => expect(toastError).toHaveBeenCalledOnce());
  expect(loadDraft(CONVERSATION_ID)).toBe("I'll call in the morning.");
  expect(loadFailedSend(CONVERSATION_ID)?.key).toEqual(expect.any(String));
});
