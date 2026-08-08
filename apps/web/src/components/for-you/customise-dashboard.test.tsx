/**
 * @vitest-environment happy-dom
 */
/**
 * #540 — the Customise panel.
 *
 * The switches themselves are Radix; what is worth asserting is the product
 * decisions layered on top. Opened for real rather than rendered to a string,
 * because the two things most worth checking — that toggling sends the WHOLE set
 * and that no queue section is on offer — are only observable once it is open.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This app's vitest does not set `globals`, so testing-library's automatic
// cleanup never registers and renders stack across tests.
afterEach(cleanup);

const state: { hidden: string[]; isError: boolean } = {
  hidden: [],
  isError: false,
};
const mutate = vi.fn();

vi.mock("@/lib/api/me-company", () => ({
  useHiddenPanels: () => state.hidden,
  useSetHiddenPanels: () => ({ mutate, isError: state.isError }),
}));

import {
  DASHBOARD_PANEL_IDS,
  DASHBOARD_PANEL_LABELS,
  DASHBOARD_TILE_LABELS,
} from "@loonext/shared";

import { CustomiseDashboard } from "./customise-dashboard";

beforeEach(() => {
  state.hidden = [];
  state.isError = false;
  mutate.mockClear();
});

/** Render and open the panel, the way a member reaches it. */
function open() {
  render(<CustomiseDashboard />);
  fireEvent.click(screen.getByRole("button", { name: /Customise this screen/ }));
}

describe("CustomiseDashboard (#540)", () => {
  it("is one quiet control until it is opened", () => {
    // Applying: Zen of Clarity — a secondary action collapsed behind one
    // affordance. Five switches beside the work would compete with the work.
    render(<CustomiseDashboard />);
    expect(
      screen.getByRole("button", { name: /Customise this screen/ }),
    ).toBeTruthy();
    expect(screen.queryByText(DASHBOARD_PANEL_LABELS.pipeline)).toBeNull();
  });

  it("lists every panel, each with the reason it exists", () => {
    open();
    for (const id of DASHBOARD_PANEL_IDS) {
      expect(screen.getByText(DASHBOARD_PANEL_LABELS[id])).toBeTruthy();
    }
    // A switch with only a name is a guess for anybody who has not already read
    // both cards it might refer to.
    expect(screen.getByText(/Which channels are actually bringing work in/)).toBeTruthy();
  });

  it("shows a panel as ON when it is not hidden, and OFF when it is", () => {
    // The switch reads "is this on my screen", not "is this hidden" — a control
    // whose sense is inverted from its label is the classic settings bug.
    state.hidden = ["pipeline"];
    open();
    const pipeline = screen.getByRole("switch", {
      name: DASHBOARD_PANEL_LABELS.pipeline,
    });
    const satisfaction = screen.getByRole("switch", {
      name: DASHBOARD_PANEL_LABELS.satisfaction,
    });
    expect(pipeline.getAttribute("aria-checked")).toBe("false");
    expect(satisfaction.getAttribute("aria-checked")).toBe("true");
  });

  it("sends the WHOLE set when something is switched off", () => {
    // PUT, not PATCH: the body describes the screen they want. A delta against a
    // state two clients disagree about merges into a layout neither asked for.
    state.hidden = ["pipeline"];
    open();
    fireEvent.click(
      screen.getByRole("switch", { name: DASHBOARD_PANEL_LABELS.recent_calls }),
    );
    expect(mutate).toHaveBeenCalledWith(["pipeline", "recent_calls"]);
  });

  it("sends the set without the panel when something is switched back on", () => {
    state.hidden = ["pipeline", "recent_calls"];
    open();
    fireEvent.click(
      screen.getByRole("switch", { name: DASHBOARD_PANEL_LABELS.pipeline }),
    );
    expect(mutate).toHaveBeenCalledWith(["recent_calls"]);
  });

  it("has no Save button — the screen behind it is the feedback", () => {
    open();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("says it went back when a save fails, rather than that it is pending", () => {
    // The toggle is optimistic, so by the time this appears the panel has
    // already moved. "Saving…" would be a lie and "Failed" would not say what
    // state the screen is now in.
    state.isError = true;
    open();
    expect(screen.getByText(/back the way it was/)).toBeTruthy();
  });

  it("marks the trigger when panels are put away", () => {
    render(<CustomiseDashboard />);
    expect(
      screen.queryByRole("button", { name: /put away/ }),
    ).toBeNull();
    cleanup();

    state.hidden = ["pipeline"];
    render(<CustomiseDashboard />);
    expect(screen.getByRole("button", { name: /1 panel put away/ })).toBeTruthy();
    cleanup();

    state.hidden = ["pipeline", "recent_calls"];
    render(<CustomiseDashboard />);
    expect(
      screen.getByRole("button", { name: /2 panels put away/ }),
    ).toBeTruthy();
  });
});

describe("what CustomiseDashboard refuses to offer (#540)", () => {
  it("never lists a queue section", () => {
    // THE LINE. The queue is the work; hiding "Unassigned" is a way to stop
    // seeing leads nobody has claimed. Asserted against the tile labels rather
    // than a hand-written list, so a new queue section cannot end up on this
    // panel by accident later.
    open();
    for (const label of Object.values(DASHBOARD_TILE_LABELS)) {
      expect(screen.queryByRole("switch", { name: label })).toBeNull();
    }
    expect(screen.getAllByRole("switch")).toHaveLength(
      DASHBOARD_PANEL_IDS.length,
    );
  });

  it("says so on the panel rather than leaving somebody hunting for a switch", () => {
    open();
    expect(screen.getByText(/The queue always stays/)).toBeTruthy();
  });
});
