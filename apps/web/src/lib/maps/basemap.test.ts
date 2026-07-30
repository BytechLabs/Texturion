import { describe, expect, it } from "vitest";

import {
  isUnlicensedTileHost,
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

describe("readBasemap — the OSM host cannot be configured back in", () => {
  it("refuses tile.openstreetmap.org even with perfect attribution", () => {
    // This is the point of the module. The violation has to be impossible to
    // reintroduce quietly — by a copied .env, a tutorial, or a well-meant
    // "restore the map" fix — not merely removed once.
    expect(
      readBasemap({
        NEXT_PUBLIC_MAP_TILE_URL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        NEXT_PUBLIC_MAP_TILE_ATTRIBUTION: "© OpenStreetMap contributors",
      }),
    ).toBeNull();
  });

  it("refuses every subdomain form a Leaflet template uses", () => {
    for (const url of [
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.org/1/2/3.png",
      "http://tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://TILE.OPENSTREETMAP.ORG/{z}/{x}/{y}.png",
    ]) {
      expect(isUnlicensedTileHost(url), url).toBe(true);
    }
  });

  it("does not refuse a lookalike domain that merely contains the string", () => {
    // Over-blocking would be its own bug: a provider whose hostname happens to
    // contain the phrase is licensed and must work.
    for (const url of [
      "https://tiles.example.com/tile.openstreetmap.org.png",
      "https://tile.openstreetmap.org.evil.example.com/{z}/{x}/{y}.png",
      "https://my-tile-openstreetmap-org.example.com/{z}/{x}/{y}.png",
    ]) {
      expect(isUnlicensedTileHost(url), url).toBe(false);
    }
  });

  it("still permits a provider that SERVES OSM data under its own terms", () => {
    // OSM *data* is fine and widely resold; it is OSM's donated *tile servers*
    // that are not ours to use. Blocking the data would be the wrong lesson.
    expect(
      isUnlicensedTileHost("https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=k"),
    ).toBe(false);
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
