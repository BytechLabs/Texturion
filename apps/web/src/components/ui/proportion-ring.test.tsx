/**
 * #540 — the ring's geometry and its label.
 *
 * A ring is the one thing on this dashboard a test can genuinely check without a
 * browser: the arc length IS the value, so a wrong dash offset is a wrong number
 * drawn confidently. What cannot be checked here is whether it looks right at
 * 40px, which is why it was also opened in a browser.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProportionRing } from "./proportion-ring";

/** The drawn arc's dashoffset, or null when no arc was drawn at all. */
function offset(html: string): number | null {
  const matches = [...html.matchAll(/stroke-dashoffset="([\d.]+)"/g)];
  return matches.length ? Number(matches[matches.length - 1]![1]) : null;
}
function circumference(html: string): number {
  const m = html.match(/stroke-dasharray="([\d.]+)"/);
  return m ? Number(m[1]) : 0;
}

describe("ProportionRing", () => {
  it("draws nothing but the track at zero", () => {
    // An arc of length zero still paints a round cap at the top — a dot that
    // reads as "one of these is done" when none are.
    const html = renderToStaticMarkup(
      <ProportionRing value={0} total={10} label="0 of 10 answered" />,
    );
    expect(offset(html)).toBeNull();
  });

  it("closes the ring completely when everything is done", () => {
    const html = renderToStaticMarkup(
      <ProportionRing value={10} total={10} label="10 of 10 answered" />,
    );
    expect(offset(html)).toBeCloseTo(0, 5);
  });

  it("draws half the ring at half", () => {
    const html = renderToStaticMarkup(
      <ProportionRing value={5} total={10} label="5 of 10 answered" />,
    );
    expect(offset(html)).toBeCloseTo(circumference(html) / 2, 5);
  });

  it("does not run a second lap when the caller over-reports", () => {
    // 12 of 10 is a bug upstream, and the honest drawing of it is a full ring
    // rather than an arc that has wrapped round and looks like 2 of 10.
    const html = renderToStaticMarkup(
      <ProportionRing value={12} total={10} label="12 of 10 answered" />,
    );
    expect(offset(html)).toBeCloseTo(0, 5);
  });

  it("survives a total of zero without dividing by it", () => {
    const html = renderToStaticMarkup(
      <ProportionRing value={0} total={0} label="nothing yet" />,
    );
    expect(html).not.toContain("NaN");
    expect(offset(html)).toBeNull();
  });

  it("starts at the top, where a reader expects a ring to start", () => {
    const html = renderToStaticMarkup(
      <ProportionRing value={1} total={4} label="1 of 4 answered" size={44} />,
    );
    expect(html).toContain("rotate(-90 22 22)");
  });

  it("says a sentence rather than a percentage", () => {
    // A ring with no text is nothing at all to a screen reader, and "62 percent"
    // is not what a person would say out loud about it.
    const html = renderToStaticMarkup(
      <ProportionRing
        value={34}
        total={41}
        centre="34"
        label="34 of 41 new customers answered"
      />,
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="34 of 41 new customers answered"');
    // And the number survives with the colours off, as real text inside.
    expect(html).toContain(">34<");
  });
});
