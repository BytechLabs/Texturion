/**
 * @vitest-environment happy-dom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiFetch }));
vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "company-1" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { AutoSaveNotes } from "./inline-field";

type Init = { method?: string; body?: unknown };

function patches(): unknown[] {
  return apiFetch.mock.calls
    .filter(([, init]) => (init as Init | undefined)?.method === "PATCH")
    .map(([, init]) => (init as Init).body);
}

function mountNotes() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AutoSaveNotes contactId="c1" value={null} />
    </QueryClientProvider>,
  );
  return screen.getByRole("textbox");
}

async function wait(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (_path: string, init?: Init) => ({
    id: "c1",
    ...(init?.body as object),
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AutoSaveNotes", () => {
  it("sends one PATCH for one typed character, not one per render", async () => {
    const notes = mountNotes();
    fireEvent.change(notes, { target: { value: "a" } });
    await wait(800);
    await wait(5000);
    expect(patches()).toEqual([{ notes: "a" }]);
  });

  it("sends the note at once when the field loses focus", async () => {
    const notes = mountNotes();
    fireEvent.change(notes, { target: { value: "Dog in yard" } });
    fireEvent.blur(notes);
    await wait(0);
    expect(patches()).toEqual([{ notes: "Dog in yard" }]);
  });
});
