/** @vitest-environment happy-dom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import { useLocalStorageFlag } from "./use-local-storage-flag";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function ServerFlag() {
  const [value] = useLocalStorageFlag("company-a", null);
  return <span>{String(value)}</span>;
}

it("renders the server snapshot before loading storage and publishes same-page writes", () => {
  window.localStorage.setItem("company-a", "1");
  expect(renderToString(<ServerFlag />)).toBe("<span>null</span>");

  const first = renderHook(() => useLocalStorageFlag("company-a", null));
  const second = renderHook(() => useLocalStorageFlag("company-a", null));
  expect(first.result.current[0]).toBe(true);
  expect(second.result.current[0]).toBe(true);

  act(() => first.result.current[1](false));

  expect(window.localStorage.getItem("company-a")).toBe("0");
  expect(second.result.current[0]).toBe(false);
});

it("keeps failed writes in memory for the selected key", () => {
  const storage = window.localStorage;
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new Error("Storage disabled");
  });
  const { result, rerender } = renderHook(({ key }) => useLocalStorageFlag(key, false), {
    initialProps: { key: "thread-a" },
  });
  expect(result.current[0]).toBe(false);

  act(() => result.current[1](true));
  expect(result.current[0]).toBe(true);
  expect(storage.getItem("thread-a")).toBeNull();

  rerender({ key: "thread-b" });
  expect(result.current[0]).toBe(false);
});
