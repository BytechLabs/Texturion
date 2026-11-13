/**
 * @vitest-environment happy-dom
 */
/**
 * useIsXl and useIsBelowMd answer on the first render. Everything that asks
 * renders only on the client, so waiting for an effect only drew the wrong
 * layout first: the sheet on a wide screen, the desktop header on a phone.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useIsBelowMd } from "./use-is-below-md";
import { useIsXl } from "./use-is-xl";

afterEach(cleanup);

/** A matchMedia that answers `matches` for every query and can announce a change. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const state = { matches };
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        media: query,
        get matches() {
          return state.matches;
        },
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) =>
          listeners.delete(listener),
      }) as unknown as MediaQueryList,
  );
  return (next: boolean) =>
    act(() => {
      state.matches = next;
      for (const listener of listeners) listener();
    });
}

function recorder(hook: () => boolean) {
  const seen: boolean[] = [];
  function Probe() {
    seen.push(hook());
    return null;
  }
  return { seen, Probe };
}

describe.each([
  ["useIsXl", useIsXl],
  ["useIsBelowMd", useIsBelowMd],
] as const)("%s", (_name, hook) => {
  it("is true on the first render when the query matches", () => {
    stubMatchMedia(true);
    const { seen, Probe } = recorder(hook);
    render(<Probe />);
    expect(seen[0]).toBe(true);
    expect(new Set(seen)).toEqual(new Set([true]));
  });

  it("follows the viewport after that", () => {
    const change = stubMatchMedia(false);
    const { seen, Probe } = recorder(hook);
    render(<Probe />);
    expect(seen.at(-1)).toBe(false);
    change(true);
    expect(seen.at(-1)).toBe(true);
  });

  it("is false, and does not throw, where matchMedia does not exist", () => {
    const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
    Object.defineProperty(window, "matchMedia", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      const { seen, Probe } = recorder(hook);
      render(<Probe />);
      expect(seen).toEqual([false]);
    } finally {
      if (original) Object.defineProperty(window, "matchMedia", original);
      else delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });
});
