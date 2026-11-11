import { describe, expect, it } from "vitest";

import { nextOptionIndex } from "./segmented-control";

describe("nextOptionIndex (#11, #733 keyboard)", () => {
  const COUNT = 4; // open · mine · all · closed

  it("moves forward with ArrowRight/ArrowDown and wraps at the end", () => {
    expect(nextOptionIndex("ArrowRight", 0, COUNT)).toBe(1);
    expect(nextOptionIndex("ArrowDown", 1, COUNT)).toBe(2);
    expect(nextOptionIndex("ArrowRight", 3, COUNT)).toBe(0);
  });

  it("moves back with ArrowLeft/ArrowUp and wraps at the start", () => {
    expect(nextOptionIndex("ArrowLeft", 2, COUNT)).toBe(1);
    expect(nextOptionIndex("ArrowUp", 1, COUNT)).toBe(0);
    expect(nextOptionIndex("ArrowLeft", 0, COUNT)).toBe(3);
  });

  it("jumps to the ends with Home/End", () => {
    expect(nextOptionIndex("Home", 2, COUNT)).toBe(0);
    expect(nextOptionIndex("End", 1, COUNT)).toBe(COUNT - 1);
  });

  it("returns the same index for any other key (a no-op the caller ignores)", () => {
    expect(nextOptionIndex("Enter", 2, COUNT)).toBe(2);
    expect(nextOptionIndex("a", 0, COUNT)).toBe(0);
    expect(nextOptionIndex("Tab", 3, COUNT)).toBe(3);
  });
});

