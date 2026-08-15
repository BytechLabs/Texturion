import { describe, expect, it } from "vitest";

import { segmentMeter, segmentTooltip } from "./segment-meter";

import { EN as WEB_EN, FR_CA as WEB_FR } from "@/i18n/catalog";

/** #228 — the module names keys now, so the tests resolve them. */
function resolver(table: unknown) {
  return (key: string, vars: Record<string, string> = {}): string => {
    const [section, name] = key.split(".");
    const text = (table as Record<string, Record<string, string>>)[section]?.[name];
    if (typeof text !== "string") throw new Error(`no entry for ${key}`);
    return Object.entries(vars).reduce(
      (out, [token, value]) => out.split(`{${token}}`).join(value),
      text,
    );
  };
}

const sayEn = resolver(WEB_EN);
const sayFr = resolver(WEB_FR);


describe("segmentMeter", () => {
  it("stays hidden while the message fits in a single part", () => {
    expect(segmentMeter("", false, sayEn).visible).toBe(false);
    expect(segmentMeter("a".repeat(120), false, sayEn).visible).toBe(false);
    expect(segmentMeter("a".repeat(160), false, sayEn).visible).toBe(false); // still 1 part
  });

  it("appears once the message splits into 2+ parts", () => {
    const state = segmentMeter("a".repeat(161), false, sayEn); // 161 → 2 parts
    expect(state.visible).toBe(true);
    expect(state.segments).toBe(2);
    expect(state.label).toBe("Sent in 2 parts");
    expect(state.warn).toBe(false);
  });

  it("counts GSM-7 concatenation at 153 per segment", () => {
    // 161 chars → 2 parts (single-part limit is 160).
    expect(segmentMeter("a".repeat(161), false, sayEn).segments).toBe(2);
    expect(segmentMeter("a".repeat(161), false, sayEn).label).toBe("Sent in 2 parts");
    // 306 = 2×153 → still 2; 307 → 3.
    expect(segmentMeter("a".repeat(306), false, sayEn).segments).toBe(2);
    expect(segmentMeter("a".repeat(307), false, sayEn).segments).toBe(3);
  });

  it("turns amber at 4 segments", () => {
    // 3×153 = 459 → 3 segments (no warn); 460 → 4 segments (warn).
    expect(segmentMeter("a".repeat(459), false, sayEn).warn).toBe(false);
    const warned = segmentMeter("a".repeat(460), false, sayEn);
    expect(warned.segments).toBe(4);
    expect(warned.warn).toBe(true);
  });

  it("switches to UCS-2 for emoji (70/67 limits)", () => {
    const emoji = "🙂"; // astral: 2 UTF-16 units
    const short = segmentMeter(emoji.repeat(35), false, sayEn); // 70 units
    expect(short.encoding).toBe("UCS-2");
    expect(short.segments).toBe(1);
    const long = segmentMeter(emoji.repeat(36), false, sayEn); // 72 units → concat
    expect(long.segments).toBe(2);
  });
});

describe("segmentMeter with media", () => {
  it("an attachment makes it MMS: always visible, flat 3 parts", () => {
    // Counting the text alone said a photo captioned "ok" cost nothing.
    const meter = segmentMeter("ok", true, sayEn);
    expect(meter.visible).toBe(true);
    expect(meter.segments).toBe(3);
    expect(meter.label).toBe("MMS · sent in 3 parts");
    expect(meter.warn).toBe(false);
  });

  it("a long body with media is still the flat MMS count, never amber", () => {
    const meter = segmentMeter("x".repeat(700), true, sayEn);
    expect(meter.segments).toBe(3);
    expect(meter.warn).toBe(false);
  });

  it("without media nothing changes", () => {
    expect(segmentMeter("ok", false, sayEn).visible).toBe(false);
  });
});

describe("#228 how many parts, in French", () => {
  /*
   * ONE and MANY are separate keys, and this is the test that says why.
   *
   * French agrees the noun with the count - "1 partie", "2 parties" - so a
   * single sentence with an "s" appended cannot be translated. If somebody
   * ever folds these back into one key, the singular case below is what goes
   * red.
   */
  it("agrees the noun with the count", () => {
    const one = segmentMeter("a".repeat(160), false, sayFr);
    const many = segmentMeter("a".repeat(161), false, sayFr);
    expect(one.segments).toBe(1);
    expect(many.segments).toBe(2);
    expect(sayFr("thread.sentInOnePart")).toContain("partie");
    expect(sayFr("thread.sentInOnePart")).not.toContain("parties");
    expect(many.label).toContain("parties");
    expect(many.label).toContain("2");
    expect(many.label).not.toMatch(/\{/);
  });

  it("says MMS is three parts in French too", () => {
    // The flat MMS rate is the one a photo with "ok" on it gets billed at,
    // so it has to be legible to the person attaching the photo.
    const meter = segmentMeter("ok", true, sayFr);
    expect(meter.visible).toBe(true);
    expect(meter.label).toContain("3");
    expect(meter.label).not.toMatch(/\{/);
    expect(meter.label).not.toContain("thread.");
  });

  it("splits the tooltip the same way", () => {
    expect(segmentTooltip(1, sayFr)).toContain("compte 1.");
    expect(segmentTooltip(4, sayFr)).toContain("compte 4.");
    for (const say of [sayEn, sayFr]) {
      for (const parts of [1, 2, 9]) {
        const tip = segmentTooltip(parts, say);
        expect(tip).not.toContain("thread.");
        expect(tip).not.toMatch(/\{/);
      }
    }
  });
});
