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
import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/*
 * #228 — the tables above name catalogue keys, so the copy assertions resolve
 * them through the catalogue the switches actually read.
 */
function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[
    name
  ];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

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
    // would render as an empty row rather than as a crash. Since #228 these
    // tables hold catalogue KEYS, so the check is that every id has one on
    // both sides — the words themselves are checked below, in both languages.
    for (const id of DASHBOARD_PANEL_IDS) {
      expect(DASHBOARD_PANEL_LABELS[id]?.length).toBeGreaterThan(2);
      expect(DASHBOARD_PANEL_NOTES[id]?.length).toBeGreaterThan(2);
    }
    expect(Object.keys(DASHBOARD_PANEL_LABELS).sort()).toEqual(
      [...DASHBOARD_PANEL_IDS].sort(),
    );
    expect(Object.keys(DASHBOARD_PANEL_NOTES).sort()).toEqual(
      [...DASHBOARD_PANEL_IDS].sort(),
    );
  });

  it("reads in both languages (#228)", () => {
    for (const id of DASHBOARD_PANEL_IDS) {
      const label = DASHBOARD_PANEL_LABELS[id];
      const note = DASHBOARD_PANEL_NOTES[id];
      for (const [language, table] of [
        ["English", WEB_EN],
        ["French", WEB_FR],
      ] as const) {
        expect(look(table, label), `${language} for ${label}`).not.toBe("");
        // A sentence, so it ends like one — the notes sit under the names and a
        // fragment there reads as truncation. True of the French too.
        expect(look(table, note), `${language} for ${note}`).toMatch(/\.$/);
      }
      // Only the notes. A one-word label can legitimately be identical in
      // both languages — "Satisfaction" is the French for it — so asserting a
      // difference there would be asserting a worse translation. A whole
      // sentence coinciding is always the English left in place.
      expect(look(WEB_FR, note), `${note} is not translated`).not.toBe(
        look(WEB_EN, note),
      );
    }
  });

  it("gives each panel its own name", () => {
    // Two switches reading the same word is a picker you cannot use, and it
    // would pass every assertion above.
    const names = DASHBOARD_PANEL_IDS.map((id) =>
      look(WEB_EN, DASHBOARD_PANEL_LABELS[id]),
    );
    expect(new Set(names).size).toBe(DASHBOARD_PANEL_IDS.length);
  });
});
