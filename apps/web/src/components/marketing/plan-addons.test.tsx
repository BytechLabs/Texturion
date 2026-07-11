import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PLAN_MODULE_CARDS } from "@/lib/api/types";

import { ADDON_CARDS, ADDON_FINE_PRINT, PlanAddons } from "./plan-addons";

describe("pricing add-ons strip (#28 truth guard)", () => {
  it("#134/D42: the catalog holds exactly one add-on, Canada numbers (voice retired — calling is included)", () => {
    // #97/#103: no "mms" card — pictures are included on every plan, not an
    // add-on. #121: no "extra_storage" card — storage is free. #134: no
    // "voice" card — calling is included on every plan.
    expect(ADDON_CARDS.map((card) => card.id)).toEqual(["regions_ca"]);
  });

  it("renders the catalog mirror's own cards, so prices/quantities are written once", () => {
    // Reference equality: the strip must not fork its own copy of any card.
    for (const card of ADDON_CARDS) {
      expect(PLAN_MODULE_CARDS).toContain(card);
    }
  });

  it("carries fine print for every add-on, and the Canada card states it can't be bought yet", () => {
    expect(Object.keys(ADDON_FINE_PRINT).sort()).toEqual(
      ADDON_CARDS.map((card) => card.id).sort(),
    );
    // The API refuses to sell regions_ca until multi-region provisioning
    // ships — the strip says so instead of advertising a toggle that
    // doesn't exist.
    expect(ADDON_FINE_PRINT.regions_ca).toContain("isn't switchable on");
    expect(ADDON_FINE_PRINT.regions_ca).toContain("we sell it when it works");
  });

  it("#103: never advertises a Picture-messages add-on (pictures are included)", () => {
    const html = renderToStaticMarkup(<PlanAddons />);
    expect(html).not.toContain("Picture messages");
  });

  it("#121: never advertises an Extra-storage add-on or a storage cap (storage is free)", () => {
    const html = renderToStaticMarkup(<PlanAddons />);
    expect(html).not.toContain("Extra storage");
    expect(html).not.toMatch(/\bGB\b/);
    expect(html).not.toContain("stop being saved");
    expect(html).not.toContain("included storage");
  });

  it("#134: never advertises a Calling add-on — calling is included on every plan", () => {
    const html = renderToStaticMarkup(<PlanAddons />);
    expect(html).not.toContain("Calling is the only add-on");
    expect(html).not.toContain("$8");
    expect(html).toContain("calling included");
  });

  it("renders the one add-on's label, price, and fine print", () => {
    const html = renderToStaticMarkup(<PlanAddons />);
    for (const card of ADDON_CARDS) {
      expect(html).toContain(card.label);
      expect(html).toContain(card.price);
      if (card.detail) expect(html).toContain(card.detail);
    }
    expect(html).toContain("The add-ons, in plain words.");
    expect(html).toContain("Canada numbers is the only add-on that exists");
  });
});
