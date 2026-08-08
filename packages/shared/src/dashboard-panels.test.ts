import { describe, expect, it } from "vitest";

import {
  DASHBOARD_PANEL_IDS,
  DASHBOARD_PANEL_LABELS,
  DASHBOARD_PANEL_NOTES,
  DASHBOARD_PANELS_DEFAULT,
  isPanelVisible,
  normaliseHiddenPanels,
} from "./dashboard-panels";
import { DASHBOARD_TILE_LABELS } from "./dashboard-tiles";

describe("dashboard panels (#540)", () => {
  it("hides nothing by default", () => {
    // A new member gets the whole screen and takes things off it. The other
    // direction — an opt-in dashboard — means a new card is invisible to every
    // existing member forever, which is how a feature ships to nobody.
    expect(DASHBOARD_PANELS_DEFAULT).toEqual([]);
  });

  it("offers no queue section as hideable", () => {
    // THE LINE. Hiding unclaimed work is not a preference — it is a way to stop
    // seeing leads nobody has answered. If a tile id ever appears in the panel
    // list this test is the thing that says so.
    for (const tile of Object.keys(DASHBOARD_TILE_LABELS)) {
      expect(DASHBOARD_PANEL_IDS as readonly string[]).not.toContain(tile);
    }
  });

  it("drops an id it no longer renders instead of refusing the set", () => {
    // A client one release behind, or a card we withdrew. The member gets a
    // working dashboard showing one panel they had put away — recoverable in a
    // tap — rather than an error where their screen used to be.
    expect(normaliseHiddenPanels(["pipeline", "crystal_ball"])).toEqual([
      "pipeline",
    ]);
  });

  it("collapses duplicates", () => {
    expect(normaliseHiddenPanels(["pipeline", "pipeline"])).toEqual(["pipeline"]);
  });

  it("stores the declared order, not the clicking order", () => {
    // Otherwise the same screen has several stored spellings and nothing that
    // compares two sets can be trusted.
    expect(normaliseHiddenPanels(["recent_calls", "response_time"])).toEqual([
      "response_time",
      "recent_calls",
    ]);
  });

  it("survives an empty and a fully hidden set", () => {
    expect(normaliseHiddenPanels([])).toEqual([]);
    expect(normaliseHiddenPanels([...DASHBOARD_PANEL_IDS])).toEqual([
      ...DASHBOARD_PANEL_IDS,
    ]);
  });

  it("reports a panel visible unless it is in the set", () => {
    expect(isPanelVisible([], "pipeline")).toBe(true);
    expect(isPanelVisible(["pipeline"], "pipeline")).toBe(false);
    expect(isPanelVisible(["pipeline"], "satisfaction")).toBe(true);
  });

  it("names and explains every panel", () => {
    // A switch with no label is a switch nobody touches, and a missing entry
    // would render as an empty row rather than as a crash.
    for (const id of DASHBOARD_PANEL_IDS) {
      expect(DASHBOARD_PANEL_LABELS[id]?.length).toBeGreaterThan(2);
      // A sentence, so it ends like one — the notes sit under the names and a
      // fragment there reads as truncation.
      expect(DASHBOARD_PANEL_NOTES[id]).toMatch(/\.$/);
    }
    expect(Object.keys(DASHBOARD_PANEL_LABELS).sort()).toEqual(
      [...DASHBOARD_PANEL_IDS].sort(),
    );
    expect(Object.keys(DASHBOARD_PANEL_NOTES).sort()).toEqual(
      [...DASHBOARD_PANEL_IDS].sort(),
    );
  });
});
