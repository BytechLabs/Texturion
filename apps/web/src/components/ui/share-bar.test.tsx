import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ShareBar } from "./share-bar";

/** The widths, which are the whole claim the picture makes. */
function widths(html: string): number[] {
  return [...html.matchAll(/width:\s*([\d.]+)%/g)].map((m) => Number(m[1]));
}

function render(
  segments: { label: string; value: number }[],
  total: number,
): string {
  return renderToStaticMarkup(
    <ShareBar
      segments={segments.map((s) => ({ ...s, className: "bg-app-olive" }))}
      total={total}
      label="test"
    />,
  );
}

describe("ShareBar (#540)", () => {
  it("splits the whole by value", () => {
    expect(widths(render([{ label: "won", value: 3 }], 10))).toEqual([30]);
    expect(
      widths(
        render(
          [
            { label: "won", value: 5 },
            { label: "out", value: 3 },
          ],
          10,
        ),
      ),
    ).toEqual([50, 30]);
  });

  it("leaves the unaccounted remainder as track rather than inflating a part", () => {
    // 5 won and 3 still out of 10 quoted means 2 went quiet. That gap is the
    // honest picture, and stretching the parts to fill the bar would hide the one
    // number an owner should chase.
    const w = widths(
      render(
        [
          { label: "won", value: 5 },
          { label: "out", value: 3 },
        ],
        10,
      ),
    );
    expect(w.reduce((a, b) => a + b, 0)).toBe(80);
  });

  it("draws nothing at all when there is no whole", () => {
    // A month with no quotes. An empty track reads as a panel that failed to
    // load rather than as a quiet month.
    expect(render([{ label: "won", value: 0 }], 0)).toBe("");
  });

  it("does not let parts run off the end when they exceed the whole", () => {
    // The parts and the total are separate figures from the server, and a lagging
    // window can disagree with itself by one.
    const w = widths(
      render(
        [
          { label: "won", value: 8 },
          { label: "out", value: 8 },
        ],
        10,
      ),
    );
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
    // The FIRST segment keeps its true share; the overflow is taken off the one
    // that could not fit, rather than both being scaled into a shape neither
    // figure supports.
    expect(w[0]).toBe(80);
    expect(w[1]).toBe(20);
  });

  it("omits a zero segment instead of drawing a hairline", () => {
    // A 0% span still paints a 1px sliver at some zoom levels, which reads as a
    // small amount of something rather than none of it.
    const html = render(
      [
        { label: "won", value: 0 },
        { label: "out", value: 4 },
      ],
      10,
    );
    expect(widths(html)).toEqual([40]);
  });

  it("ignores a negative part rather than reversing the bar", () => {
    expect(widths(render([{ label: "won", value: -5 }], 10))).toEqual([]);
  });

  it("announces a sentence, not a set of percentages", () => {
    const html = renderToStaticMarkup(
      <ShareBar
        segments={[{ label: "won", value: 5, className: "bg-app-olive" }]}
        total={10}
        label="5 of 10 quotes came back yes"
      />,
    );
    expect(html).toContain('role="img"');
    expect(html).toContain("5 of 10 quotes came back yes");
    expect(html).not.toContain("50 percent");
  });
});
