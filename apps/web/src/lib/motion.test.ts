import { afterEach, describe, expect, it, vi } from "vitest";

import { prefersReducedMotion } from "./motion";

describe("prefersReducedMotion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when the reduce-motion query matches", () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
    }));
    vi.stubGlobal("window", { matchMedia });
    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("returns false when the query does not match", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(prefersReducedMotion()).toBe(false);
  });

  it("is SSR-safe when matchMedia is unavailable", () => {
    vi.stubGlobal("window", {} as unknown);
    expect(prefersReducedMotion()).toBe(false);
  });
});
