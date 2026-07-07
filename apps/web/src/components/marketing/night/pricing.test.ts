import { describe, expect, it } from "vitest";

import { PLAN_MODULE_CARDS } from "@/lib/api/types";

import { ADDON_LINE, PLANS } from "./pricing";

describe("homepage plan cards (#70 unit-language guard)", () => {
  it("states the allowances in plain 'texts', matching /pricing's numbers", () => {
    const starter = PLANS.find((plan) => plan.name === "Starter");
    const pro = PLANS.find((plan) => plan.name === "Pro");
    expect(starter?.items).toContain("500 texts a month");
    expect(pro?.items).toContain("2,500 texts a month");
  });

  it("never uses 'segments' jargon in a plan line item (CONVERSION.md §3)", () => {
    for (const plan of PLANS) {
      for (const item of plan.items) {
        expect(item.toLowerCase()).not.toContain("segment");
      }
    }
  });
});

describe("homepage add-ons line (#28 truth guard)", () => {
  it("quotes every sellable add-on's catalog price, written once from the mirror", () => {
    for (const card of PLAN_MODULE_CARDS) {
      if (card.id === "regions_ca") continue;
      expect(ADDON_LINE).toContain(
        `${card.label.toLowerCase()} ${card.price}`,
      );
    }
  });

  it("never advertises the unsellable regions_ca module", () => {
    expect(ADDON_LINE.toLowerCase()).not.toContain("canada");
  });

  it("makes the opt-in promise explicit", () => {
    expect(ADDON_LINE).toContain("off until you turn them on");
    expect(ADDON_LINE).toContain("You only pay for what you turn on.");
  });
});
