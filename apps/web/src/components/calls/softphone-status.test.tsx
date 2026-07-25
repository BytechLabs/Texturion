/**
 * The softphone indicator must tell the truth about whether this browser will
 * ring. A registration that was REFUSED once read exactly like one still in
 * progress, so a member watched a hopeful pulsing "Connecting…" while every
 * incoming call went unanswered.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Hoisted mock state the hook reads; each test seeds it before rendering.
const state: { ready: boolean; error: string | null } = {
  ready: false,
  error: null,
};

vi.mock("@/lib/softphone/provider", () => ({
  useSoftphone: () => state,
}));

import { SoftphoneStatus } from "./softphone-status";

function render(next: { ready: boolean; error: string | null }): string {
  state.ready = next.ready;
  state.error = next.error;
  // React escapes apostrophes in the rendered markup; decode so the assertions
  // read as the words a member actually sees.
  return renderToStaticMarkup(<SoftphoneStatus />).replaceAll("&#x27;", "'");
}

describe("SoftphoneStatus", () => {
  it("says the phone is ready once registered", () => {
    const html = render({ ready: true, error: null });
    expect(html).toContain("Ready");
    expect(html).not.toContain("Can't ring");
  });

  it("says connecting only while an attempt is still outstanding", () => {
    const html = render({ ready: false, error: null });
    expect(html).toContain("Connecting…");
    // The pulse is what reads as progress; it belongs only to this state.
    expect(html).toContain("animate-pulse");
  });

  it("says the phone cannot ring once registration has failed", () => {
    const html = render({ ready: false, error: "Your browser can't receive calls right now." });
    expect(html).toContain("Can't ring");
    expect(html).not.toContain("Connecting…");
    // A failed phone holds a steady dot: there is no progress to report.
    expect(html).not.toContain("animate-pulse");
  });

  it("never reports a failure once the phone is registered", () => {
    // The reducer clears `error` on ready, but a stale error must not be able
    // to contradict a working phone even if one survived.
    const html = render({ ready: true, error: "stale" });
    expect(html).toContain("Ready");
    expect(html).not.toContain("Can't ring");
  });
});
