/**
 * #490 — the count an owner is shown when deciding whether to reinstate.
 *
 * The rendering rules matter more than the markup here, because this is a
 * message shown to somebody whose payment has lapsed. Getting the tone wrong is
 * the failure mode, not getting the layout wrong.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const missed = vi.hoisted(() => ({
  data: undefined as { count: number; since: string; last_at: string | null } | undefined,
}));

vi.mock("@/lib/api/billing", () => ({
  useMissedWhileOff: () => missed,
}));

const { MissedWhileOff } = await import("./missed-while-off");

function render(
  show: boolean,
  data?: { count: number; last_at: string | null },
): string {
  missed.data = data
    ? { count: data.count, since: "2026-05-01T00:00:00.000Z", last_at: data.last_at }
    : undefined;
  return renderToStaticMarkup(<MissedWhileOff show={show} />);
}

describe("MissedWhileOff", () => {
  it("says how many called, and when it last happened", () => {
    const today = new Date().toISOString();
    const html = render(true, { count: 7, last_at: today });
    expect(html).toContain("7 customers called");
    expect(html).toContain("today");
  });

  it("counts one customer as a person, not as a row", () => {
    const html = render(true, { count: 1, last_at: null });
    expect(html).toContain("1 customer called");
    expect(html).not.toContain("1 customers");
  });

  it("renders NOTHING when nobody called", () => {
    // An empty state here would be an argument AGAINST reinstating, which is a
    // screen nobody needed us to build.
    expect(render(true, { count: 0, last_at: null })).toBe("");
  });

  it("renders nothing on a healthy workspace, and does not even ask", () => {
    // The query is disabled by the same flag: this is an aggregate over the
    // busiest table in the product, and a paying workspace must never pay for
    // a question it is not asking.
    expect(render(false, { count: 9, last_at: null })).toBe("");
  });

  it("renders nothing while the answer is still unknown", () => {
    // No skeleton, no error box. This is a supporting fact on somebody else's
    // screen, and a billing page showing a broken box where a count should be
    // looks like the billing itself is broken.
    expect(render(true, undefined)).toBe("");
  });

  it("never blames the reader or dramatises the loss", () => {
    // The reader has almost certainly stopped paying because money is tight.
    // A product that shouts about what their lapse cost them is kicking
    // somebody who is already down — and the bare number is more persuasive
    // than any sentence we could write about it.
    const html = render(true, { count: 12, last_at: new Date().toISOString() }).toLowerCase();
    for (const word of ["lost", "losing", "missed out", "wasted", "failed", "warning", "urgent"]) {
      expect(html, `copy must not say "${word}"`).not.toContain(word);
    }
  });

  it("never tells the owner what the caller was not told", () => {
    // The caller hears that the number isn't taking calls, and nothing about
    // why. This copy describes that truthfully — if it ever claimed the caller
    // was told about billing, it would be describing a disclosure we
    // deliberately do not make.
    const html = render(true, { count: 3, last_at: null }).toLowerCase();
    // The apostrophe is HTML-escaped by renderToStaticMarkup, so this asserts
    // the part of the sentence that survives the entity.
    expect(html).toContain("taking calls");
    expect(html).not.toContain("suspend");
  });
});
