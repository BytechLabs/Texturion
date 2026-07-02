import { describe, expect, it } from "vitest";
import {
  estimateSegments,
  GSM7_CONCAT_SEGMENT_UNITS,
  GSM7_SINGLE_SEGMENT_UNITS,
  UCS2_CONCAT_SEGMENT_UNITS,
  UCS2_SINGLE_SEGMENT_UNITS,
} from "./segments";

describe("estimateSegments — GSM-7 basic", () => {
  it("empty string is zero segments", () => {
    expect(estimateSegments("")).toEqual({
      encoding: "GSM-7",
      segments: 0,
      unitsUsed: 0,
      unitsPerSegment: GSM7_SINGLE_SEGMENT_UNITS,
    });
  });

  it("exactly 160 GSM-7 chars fit one segment", () => {
    expect(estimateSegments("a".repeat(160))).toEqual({
      encoding: "GSM-7",
      segments: 1,
      unitsUsed: 160,
      unitsPerSegment: 160,
    });
  });

  it("161 GSM-7 chars concatenate to 2 segments of 153", () => {
    expect(estimateSegments("a".repeat(161))).toEqual({
      encoding: "GSM-7",
      segments: 2,
      unitsUsed: 161,
      unitsPerSegment: GSM7_CONCAT_SEGMENT_UNITS,
    });
  });

  it("153-boundary math: 306 → 2 segments, 307 → 3, 459 → 3, 460 → 4", () => {
    expect(estimateSegments("a".repeat(306)).segments).toBe(2);
    expect(estimateSegments("a".repeat(307)).segments).toBe(3);
    expect(estimateSegments("a".repeat(459)).segments).toBe(3);
    expect(estimateSegments("a".repeat(460)).segments).toBe(4);
  });

  it("é is GSM-7 basic (1 septet)", () => {
    expect(estimateSegments("é")).toEqual({
      encoding: "GSM-7",
      segments: 1,
      unitsUsed: 1,
      unitsPerSegment: 160,
    });
    // 160 of them still fit a single segment.
    expect(estimateSegments("é".repeat(160)).segments).toBe(1);
  });

  it("ç is GSM-7 basic (1 septet) per GSM0338.TXT 0x09", () => {
    expect(estimateSegments("ç")).toEqual({
      encoding: "GSM-7",
      segments: 1,
      unitsUsed: 1,
      unitsPerSegment: 160,
    });
  });

  it("newline and other 0x00–0x1F basic chars are 1 septet", () => {
    expect(estimateSegments("a\nb")).toEqual({
      encoding: "GSM-7",
      segments: 1,
      unitsUsed: 3,
      unitsPerSegment: 160,
    });
  });
});

describe("estimateSegments — GSM-7 extension table", () => {
  it("€ is GSM-7 but costs 2 septets (ESC + char)", () => {
    expect(estimateSegments("€")).toEqual({
      encoding: "GSM-7",
      segments: 1,
      unitsUsed: 2,
      unitsPerSegment: 160,
    });
  });

  it("all extension chars cost 2: 80 € = 160 septets = 1 segment, 81 = 2", () => {
    expect(estimateSegments("€".repeat(80))).toEqual({
      encoding: "GSM-7",
      segments: 1,
      unitsUsed: 160,
      unitsPerSegment: 160,
    });
    expect(estimateSegments("€".repeat(81)).segments).toBe(2);
    expect(estimateSegments("[~]{}\\^|€\f")).toEqual({
      encoding: "GSM-7",
      segments: 1,
      unitsUsed: 20,
      unitsPerSegment: 160,
    });
  });

  it("mixed basic + extension counts septets exactly", () => {
    // "Price: $5 [deal] ~50% off €" — 4 extension chars ([, ], ~, €) cost 2.
    const text = "Price: $5 [deal] ~50% off €";
    expect(estimateSegments(text)).toEqual({
      encoding: "GSM-7",
      segments: 1,
      unitsUsed: text.length + 4,
      unitsPerSegment: 160,
    });
  });

  it("an ESC pair never straddles a 153-septet boundary (wasted septet adds a segment)", () => {
    // 152a + € + 152a = 306 septets — naive ceil(306/153) would say 2, but the
    // € cannot split across segments: seg1 = 152a (+1 wasted), seg2 = € + 151a,
    // seg3 = the remaining 1a.
    const text = "a".repeat(152) + "€" + "a".repeat(152);
    expect(estimateSegments(text)).toEqual({
      encoding: "GSM-7",
      segments: 3,
      unitsUsed: 306,
      unitsPerSegment: 153,
    });
    // With the € fully inside a segment the same septet count packs into 2.
    expect(estimateSegments("a".repeat(151) + "€" + "a".repeat(153)).segments).toBe(2);
  });
});

describe("estimateSegments — UCS-2 fallback", () => {
  it("a single emoji forces UCS-2 and counts 2 UTF-16 code units", () => {
    expect(estimateSegments("😀")).toEqual({
      encoding: "UCS-2",
      segments: 1,
      unitsUsed: 2,
      unitsPerSegment: UCS2_SINGLE_SEGMENT_UNITS,
    });
  });

  it("one non-GSM char switches the whole message to UCS-2", () => {
    // 159 GSM chars + 1 emoji = 161 UTF-16 units → 3 UCS-2 segments,
    // not a GSM-7 message with an exception.
    const text = "a".repeat(159) + "😀";
    expect(estimateSegments(text)).toEqual({
      encoding: "UCS-2",
      segments: 3,
      unitsUsed: 161,
      unitsPerSegment: UCS2_CONCAT_SEGMENT_UNITS,
    });
  });

  it("70/71 boundary: 70 UCS-2 units fit one segment, 71 spill to 2 of 67", () => {
    expect(estimateSegments("中".repeat(70))).toEqual({
      encoding: "UCS-2",
      segments: 1,
      unitsUsed: 70,
      unitsPerSegment: 70,
    });
    expect(estimateSegments("中".repeat(71))).toEqual({
      encoding: "UCS-2",
      segments: 2,
      unitsUsed: 71,
      unitsPerSegment: 67,
    });
  });

  it("67-boundary math: 134 units → 2 segments, 135 → 3", () => {
    expect(estimateSegments("中".repeat(134)).segments).toBe(2);
    expect(estimateSegments("中".repeat(135)).segments).toBe(3);
  });

  it("a surrogate pair never straddles a 67-unit boundary", () => {
    // 66 BMP + emoji(2) + 66 BMP = 134 units — naive ceil gives 2, but the
    // pair cannot split: seg1 = 66 (+1 wasted), seg2 = emoji + 65, seg3 = 1.
    const text = "中".repeat(66) + "😀" + "中".repeat(66);
    expect(estimateSegments(text)).toEqual({
      encoding: "UCS-2",
      segments: 3,
      unitsUsed: 134,
      unitsPerSegment: 67,
    });
    // Same units with the pair aligned inside a segment packs into 2.
    expect(estimateSegments("中".repeat(65) + "😀" + "中".repeat(67)).segments).toBe(2);
  });

  it("uppercase Ç is outside the GSM0338 basic table and forces UCS-2", () => {
    expect(estimateSegments("Ça va").encoding).toBe("UCS-2");
  });

  it("mixed real-world content: GSM text plus one emoji", () => {
    const text = "On our way! ETA 4:30 😀";
    expect(estimateSegments(text)).toEqual({
      encoding: "UCS-2",
      segments: 1,
      unitsUsed: 23, // 21 BMP chars + surrogate pair (2)
      unitsPerSegment: 70,
    });
  });
});
