import { describe, expect, it } from "vitest";

import {
  MARKUP_TOOLS,
  arrowHead,
  circleFromDrag,
  isDeliberateDrag,
  markedUpFileName,
  markupStrokeWidth,
} from "./photo-markup";

/**
 * #294 — the arithmetic behind an arrow and a circle.
 *
 * Shared and tested here because three clients draw the same marks, and three
 * hand-written versions of the same trigonometry is three chances for one of them to
 * point an arrowhead slightly the wrong way.
 */

describe("the tool set (#294)", () => {
  it("is an arrow and a circle, and nothing else", () => {
    // Anything more is a drawing app, which this is not. A tech has three seconds
    // and one thumb.
    expect([...MARKUP_TOOLS]).toEqual(["arrow", "circle"]);
  });
});

describe("how thick to draw (#294)", () => {
  it("scales with the photo, so a big one is not drawn with a hairline", () => {
    // A 3px line on a 4000px photo is invisible at the size anybody views it.
    expect(markupStrokeWidth(4000, 3000)).toBeGreaterThan(markupStrokeWidth(800, 600));
  });

  it("never disappears and never covers what it points at", () => {
    expect(markupStrokeWidth(40, 30)).toBeGreaterThanOrEqual(3);
    expect(markupStrokeWidth(20000, 20000)).toBeLessThanOrEqual(18);
  });

  it("measures the SHORT edge, so a panorama is not drawn with a fence post", () => {
    expect(markupStrokeWidth(8000, 600)).toBe(markupStrokeWidth(600, 600));
  });

  it("survives a size it cannot use", () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(markupStrokeWidth(bad, bad), String(bad)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("the arrowhead (#294)", () => {
  it("sits behind the tip, on the side the shaft came from", () => {
    // Pointing right: both barbs must be to the LEFT of the tip, or the head is on
    // the wrong end and the arrow points backwards.
    const [a, b] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    expect(a.x).toBeLessThan(100);
    expect(b.x).toBeLessThan(100);
    // And symmetric about the shaft.
    expect(a.y).toBeCloseTo(-b.y, 6);
  });

  it("turns with the shaft", () => {
    // Pointing down: the barbs sit ABOVE the tip.
    const [a, b] = arrowHead({ x: 0, y: 0 }, { x: 0, y: 100 }, 4);
    expect(a.y).toBeLessThan(100);
    expect(b.y).toBeLessThan(100);
    expect(a.x).toBeCloseTo(-b.x, 6);
  });

  it("gives a short jab a visible head and a long drag a sane one", () => {
    const short = arrowHead({ x: 0, y: 0 }, { x: 12, y: 0 }, 4);
    const long = arrowHead({ x: 0, y: 0 }, { x: 4000, y: 0 }, 4);
    const shortHead = 12 - short[0].x;
    const longHead = 4000 - long[0].x;
    expect(shortHead).toBeGreaterThan(0);
    // Capped, or a drag across a whole photo grows a comical head.
    expect(longHead).toBeLessThan(400);
  });

  it("draws nothing rather than NaN for a zero-length drag", () => {
    // A tap has no direction to point in, and dividing by its length is how a
    // photo ends up with an invisible mark that still breaks an export.
    const [a, b] = arrowHead({ x: 50, y: 50 }, { x: 50, y: 50 }, 4);
    expect(a).toEqual({ x: 50, y: 50 });
    expect(b).toEqual({ x: 50, y: 50 });
    expect(Number.isNaN(a.x)).toBe(false);
  });
});

describe("the circle (#294)", () => {
  it("is centred on the drag, whichever corner it started from", () => {
    const forward = circleFromDrag({ x: 10, y: 20 }, { x: 110, y: 220 });
    const backward = circleFromDrag({ x: 110, y: 220 }, { x: 10, y: 20 });
    expect(forward).toEqual(backward);
    expect(forward).toEqual({ cx: 60, cy: 120, rx: 50, ry: 100 });
  });
});

describe("was that drag meant? (#294)", () => {
  it("ignores a tap, so scrolling does not leave a dot on a job record", () => {
    expect(isDeliberateDrag({ x: 10, y: 10 }, { x: 12, y: 11 }, 1000, 1000)).toBe(false);
  });

  it("accepts a real drag", () => {
    expect(isDeliberateDrag({ x: 10, y: 10 }, { x: 300, y: 300 }, 1000, 1000)).toBe(true);
  });

  it("judges against the photo, so the same flick means the same thing", () => {
    // 40px is a deliberate mark on a 600px photo and a twitch on a 4000px one.
    const drag = [{ x: 0, y: 0 }, { x: 40, y: 0 }] as const;
    expect(isDeliberateDrag(drag[0], drag[1], 600, 600)).toBe(true);
    expect(isDeliberateDrag(drag[0], drag[1], 4000, 4000)).toBe(false);
  });

  it("says no rather than throwing on a size it cannot use", () => {
    expect(isDeliberateDrag({ x: 0, y: 0 }, { x: 99, y: 99 }, 0, 0)).toBe(false);
  });
});

describe("what the marked-up file is called (#294)", () => {
  it("keeps the name recognisable and says it was marked", () => {
    expect(markedUpFileName("boiler.jpg")).toBe("boiler-marked.jpg");
  });

  it("always ends .jpg, because the bytes are always re-encoded", () => {
    // Keeping .png on JPEG bytes would be a lie the type check downstream catches,
    // and the customer would see a rejected upload for no reason they could act on.
    expect(markedUpFileName("plate.png")).toBe("plate-marked.jpg");
    expect(markedUpFileName("no-extension")).toBe("no-extension-marked.jpg");
  });

  it("has an answer for a name that is nothing but an extension", () => {
    expect(markedUpFileName(".jpg")).toBe("photo-marked.jpg");
    expect(markedUpFileName("   ")).toBe("marked-up.jpg");
  });
});
