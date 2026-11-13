/**
 * @vitest-environment happy-dom
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiFetch }));
vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "company-1" }));

import { useUpdateContact } from "@/lib/api/contacts";
import { ApiError } from "@/lib/api/error";

import { useDebouncedAutosave } from "./use-debounced-autosave";

type Init = { method?: string; body?: { notes?: string | null } };

function patches(): unknown[] {
  return apiFetch.mock.calls
    .filter(([, init]) => (init as Init | undefined)?.method === "PATCH")
    .map(([, init]) => (init as Init).body);
}

/** A notes field wired the way the app wires one: the real mutation, a fresh `save` every render. */
function mountNotes(initial = "") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(
    ({ value }: { value: string }) => {
      const update = useUpdateContact("c1");
      return useDebouncedAutosave({
        value,
        save: (notes) => update.mutateAsync({ notes }),
      });
    },
    { initialProps: { value: initial }, wrapper: Wrapper },
  );
}

async function wait(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (_path: string, init?: Init) => ({
    id: "c1",
    ...init?.body,
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useDebouncedAutosave", () => {
  it("(a) sends one PATCH 800ms after five keystrokes", async () => {
    const { result } = mountNotes();
    for (const draft of ["H", "He", "Hel", "Hell", "Hello"]) {
      act(() => result.current.setDraft(draft));
      await wait(100);
    }
    await wait(699);
    expect(patches()).toEqual([]);

    await wait(1);
    expect(patches()).toEqual([{ notes: "Hello" }]);
    await wait(5000);
    expect(patches()).toEqual([{ notes: "Hello" }]);
    expect(result.current.state).toBe("idle");
  });

  it("(b) unmounting inside the window sends exactly one PATCH with the last value", async () => {
    const { result, unmount } = mountNotes("Old");
    act(() => result.current.setDraft("Old n"));
    act(() => result.current.setDraft("Old note"));
    await wait(300);
    unmount();
    await wait(0);
    expect(patches()).toEqual([{ notes: "Old note" }]);
    await wait(5000);
    expect(patches()).toEqual([{ notes: "Old note" }]);
  });

  it("(c) a mounted field does not re-send while its PATCH is pending", async () => {
    const inFlight: Array<() => void> = [];
    apiFetch.mockImplementation(
      (_path: string, init?: Init) =>
        new Promise((resolve) => {
          inFlight.push(() => resolve({ id: "c1", ...init?.body }));
        }),
    );
    const { result, rerender } = mountNotes();
    act(() => result.current.setDraft("a"));
    await wait(800);
    expect(patches()).toEqual([{ notes: "a" }]);
    expect(result.current.state).toBe("saving");

    for (let i = 0; i < 5; i += 1) {
      rerender({ value: "" });
      await wait(1000);
    }
    act(() => result.current.onBlur());
    await wait(1000);
    expect(patches()).toEqual([{ notes: "a" }]);

    await act(async () => inFlight.forEach((finish) => finish()));
    await wait(0);
    expect(result.current.state).toBe("saved");
    rerender({ value: "a" });
    await wait(5000);
    expect(patches()).toEqual([{ notes: "a" }]);
  });

  it("(d) blur sends the edit at once", async () => {
    const { result } = mountNotes();
    act(() => result.current.setDraft("Gate code 4412"));
    act(() => result.current.onBlur());
    await wait(0);
    expect(patches()).toEqual([{ notes: "Gate code 4412" }]);
    await wait(800);
    expect(patches()).toEqual([{ notes: "Gate code 4412" }]);
  });

  it("sends a pending edit when the page is hidden", async () => {
    const { result } = mountNotes();
    act(() => result.current.setDraft("Back gate"));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await wait(0);
    expect(patches()).toEqual([{ notes: "Back gate" }]);
  });

  it("takes a teammate's change only while nothing of yours is unsent", async () => {
    const { result, rerender } = mountNotes("Original");
    rerender({ value: "Teammate" });
    expect(result.current.draft).toBe("Teammate");

    act(() => result.current.setDraft("Mine"));
    rerender({ value: "Teammate again" });
    expect(result.current.draft).toBe("Mine");
    await wait(800);
    expect(patches()).toEqual([{ notes: "Mine" }]);
  });

  it("reports the server's refusal and sends the same edit again on blur", async () => {
    const refusal = new ApiError("validation_failed", "Notes are too long.", 422);
    apiFetch.mockRejectedValueOnce(refusal);
    const { result } = mountNotes();
    act(() => result.current.setDraft("x"));
    await wait(800);
    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe(refusal);

    act(() => result.current.onBlur());
    await wait(0);
    expect(patches()).toEqual([{ notes: "x" }, { notes: "x" }]);
    expect(result.current.state).toBe("saved");
  });
});
