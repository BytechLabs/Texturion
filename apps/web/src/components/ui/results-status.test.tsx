/** @vitest-environment happy-dom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n/provider";

import { ResultsStatus } from "./results-status";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("announces settled searches with the same count, in the current language", async () => {
  vi.useFakeTimers();
  function search(query: string, count: number | null) {
    return (
      <LocaleProvider userLocale="fr-CA">
        <ResultsStatus query={query} count={count} />
      </LocaleProvider>
    );
  }

  const { rerender } = render(search("Map", 2));
  const status = screen.getByRole("status");
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(status.textContent).toBe("");

  rerender(search("Maple", null));
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(status.textContent).toBe("");
  rerender(search("Maple", 2));
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(status.textContent).toBe("2 résultats affichés pour « Maple »");

  rerender(search("Birch", 2));
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(status.textContent).toBe("2 résultats affichés pour « Birch »");
});
