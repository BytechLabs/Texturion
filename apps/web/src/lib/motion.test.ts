import { afterEach, describe, expect, it, vi } from "vitest";

import {
  prefersReducedMotion,
  reducedMotionScrollBehavior,
} from "./motion";

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

  it("turns an explicit smooth scroll into an immediate one when motion is reduced", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    expect(reducedMotionScrollBehavior("smooth")).toBe("auto");
  });

  it("keeps smooth scrolling when the reader did not reduce motion", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(reducedMotionScrollBehavior("smooth")).toBe("smooth");
  });

  it("never rewrites an already-immediate scroll", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    expect(reducedMotionScrollBehavior("auto")).toBe("auto");
    expect(reducedMotionScrollBehavior("instant")).toBe("instant");
  });
});
