import { describe, expect, it } from "vitest";

import { segmentMeter } from "./segment-meter";

describe("segmentMeter", () => {
  it("stays hidden at or under 120 characters", () => {
    expect(segmentMeter("").visible).toBe(false);
    expect(segmentMeter("a".repeat(120)).visible).toBe(false);
  });

  it("appears past 120 characters with the parts label", () => {
    const state = segmentMeter("a".repeat(121));
    expect(state.visible).toBe(true);
    expect(state.segments).toBe(1);
    expect(state.label).toBe("Sent in 1 part");
    expect(state.warn).toBe(false);
  });

  it("counts GSM-7 concatenation at 153 per segment", () => {
    // 161 chars → 2 parts (single-part limit is 160).
    expect(segmentMeter("a".repeat(161)).segments).toBe(2);
    expect(segmentMeter("a".repeat(161)).label).toBe("Sent in 2 parts");
    // 306 = 2×153 → still 2; 307 → 3.
    expect(segmentMeter("a".repeat(306)).segments).toBe(2);
    expect(segmentMeter("a".repeat(307)).segments).toBe(3);
  });

  it("turns amber at 4 segments", () => {
    // 3×153 = 459 → 3 segments (no warn); 460 → 4 segments (warn).
    expect(segmentMeter("a".repeat(459)).warn).toBe(false);
    const warned = segmentMeter("a".repeat(460));
    expect(warned.segments).toBe(4);
    expect(warned.warn).toBe(true);
  });

  it("switches to UCS-2 for emoji (70/67 limits)", () => {
    const emoji = "🙂"; // astral: 2 UTF-16 units
    const short = segmentMeter(emoji.repeat(35)); // 70 units
    expect(short.encoding).toBe("UCS-2");
    expect(short.segments).toBe(1);
    const long = segmentMeter(emoji.repeat(36)); // 72 units → concat
    expect(long.segments).toBe(2);
  });
});
