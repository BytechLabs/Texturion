import { describe, expect, it } from "vitest";

import {
  NO_BASEMAP_NOTICE,
  readBasemap,
} from "./basemap";

/**
 * #428 — the tile source.
 *
 * The whole module is one rule: WE FAIL TOWARD NO BASEMAP, NEVER TOWARD SOMEBODY
 * ELSE'S GOODWILL. Most of these tests are that rule asked from a different angle,
 * because the failure they prevent is silent — a map that draws is
 * indistinguishable from a map that draws *legally*.
 */

const LICENSED = {
  NEXT_PUBLIC_MAP_TILE_URL: "https://tiles.example.com/{z}/{x}/{y}.png?key=abc",
  NEXT_PUBLIC_MAP_TILE_ATTRIBUTION: "© Example Maps © OpenStreetMap contributors",
};

describe("readBasemap — a configured provider", () => {
  it("returns the URL and attribution together", () => {
    const basemap = readBasemap(LICENSED);
    expect(basemap?.url).toBe(LICENSED.NEXT_PUBLIC_MAP_TILE_URL);
    expect(basemap?.attribution).toContain("Example Maps");
    expect(basemap?.maxZoom).toBe(19);
  });

  it("honours a provider's own max zoom", () => {
    expect(
      readBasemap({ ...LICENSED, NEXT_PUBLIC_MAP_TILE_MAX_ZOOM: "22" })?.maxZoom,
    ).toBe(22);
  });

  it("ignores a nonsense max zoom rather than rendering a broken map", () => {
    for (const value of ["", "abc", "0", "-5"]) {
      expect(
        readBasemap({ ...LICENSED, NEXT_PUBLIC_MAP_TILE_MAX_ZOOM: value })?.maxZoom,
        value,
      ).toBe(19);
    }
  });
});

describe("readBasemap — every unconfigured shape is NO basemap", () => {
  it("returns null when nothing is set", () => {
    expect(readBasemap({})).toBeNull();
  });

  it("returns null for a URL with no attribution", () => {
    // A tile source with no credit is the same licensing problem wearing a
    // different provider's name, so half-configured is treated as unconfigured.
    expect(
      readBasemap({ NEXT_PUBLIC_MAP_TILE_URL: LICENSED.NEXT_PUBLIC_MAP_TILE_URL }),
    ).toBeNull();
  });

  it("returns null for an attribution with no URL", () => {
    expect(
      readBasemap({
        NEXT_PUBLIC_MAP_TILE_ATTRIBUTION: LICENSED.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION,
      }),
    ).toBeNull();
  });

  it("treats whitespace-only values as absent", () => {
    expect(
      readBasemap({
        NEXT_PUBLIC_MAP_TILE_URL: "   ",
        NEXT_PUBLIC_MAP_TILE_ATTRIBUTION: "  ",
      }),
    ).toBeNull();
  });
});

describe("readBasemap — the OSM standard tiles (D160)", () => {
  it("serves them when configured with the credit and its link", () => {
    const basemap = readBasemap({
      NEXT_PUBLIC_MAP_TILE_URL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      NEXT_PUBLIC_MAP_TILE_ATTRIBUTION:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    expect(basemap?.url).toContain("tile.openstreetmap.org");
    expect(basemap?.attribution).toContain("openstreetmap.org/copyright");
  });

  it("still refuses them without the credit", () => {
    expect(
      readBasemap({
        NEXT_PUBLIC_MAP_TILE_URL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      }),
    ).toBeNull();
  });
});

describe("the no-basemap notice", () => {
  it("says the pins are still right, and who can fix the background", () => {
    // The state is a configuration an owner completes, not a fault to apologise
    // for — and the crew needs to know the pin positions are unaffected.
    expect(NO_BASEMAP_NOTICE).toMatch(/pins are exact/i);
    expect(NO_BASEMAP_NOTICE).toMatch(/owner/i);
    expect(NO_BASEMAP_NOTICE).not.toMatch(/error|sorry|failed|broken/i);
  });
});
