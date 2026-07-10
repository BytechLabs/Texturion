import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PLAN_MODULE_CARDS } from "@/lib/api/types";

import {
  ADDON_FINE_PRINT,
  PlanAddons,
  SELLABLE_ADDON_CARDS,
} from "./plan-addons";

describe("pricing add-ons strip (#28 truth guard)", () => {
  it("advertises exactly the sellable modules — regions_ca and the retired extra_storage never show", () => {
    // #97/#103: no "mms" card — pictures are included on every plan, not an
    // add-on. #121: no "extra_storage" card — storage is free.
    expect(SELLABLE_ADDON_CARDS.map((card) => card.id)).toEqual(["voice"]);
  });

  it("renders the catalog mirror's own cards, so prices/quantities are written once", () => {
    // Reference equality: the strip must not fork its own copy of any card.
    for (const card of SELLABLE_ADDON_CARDS) {
      expect(PLAN_MODULE_CARDS).toContain(card);
    }
  });

  it("carries fine print for every sellable add-on", () => {
    expect(Object.keys(ADDON_FINE_PRINT).sort()).toEqual(
      SELLABLE_ADDON_CARDS.map((card) => card.id).sort(),
    );
    // Missed-call text-back is the voice module's second half.
    expect(ADDON_FINE_PRINT.voice).toContain("text-back");
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

  it("renders every sellable label, price, and quantity line — and no Canada card", () => {
    const html = renderToStaticMarkup(<PlanAddons />);
    for (const card of SELLABLE_ADDON_CARDS) {
      expect(html).toContain(card.label);
      expect(html).toContain(card.price);
      if (card.detail) expect(html).toContain(card.detail);
    }
    expect(html).toContain("The add-ons, in plain words.");
    expect(html).not.toContain("Canada numbers");
  });
});
