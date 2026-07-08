import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PLAN_MODULE_CARDS } from "@/lib/api/types";

import {
  ADDON_FINE_PRINT,
  PlanAddons,
  SELLABLE_ADDON_CARDS,
} from "./plan-addons";

describe("pricing add-ons strip (#28 truth guard)", () => {
  it("advertises exactly the sellable modules — regions_ca is not purchasable and never shown", () => {
    expect(SELLABLE_ADDON_CARDS.map((card) => card.id)).toEqual([
      "mms",
      "voice",
      "extra_storage",
    ]);
  });

  it("renders the catalog mirror's own cards, so prices/quantities are written once", () => {
    // Reference equality: the strip must not fork its own copy of any card.
    for (const card of SELLABLE_ADDON_CARDS) {
      expect(PLAN_MODULE_CARDS).toContain(card);
    }
  });

  it("carries fine print for every sellable add-on, incl. the MMS cap-and-drop", () => {
    expect(Object.keys(ADDON_FINE_PRINT).sort()).toEqual(
      SELLABLE_ADDON_CARDS.map((card) => card.id).sort(),
    );
    // The over-cap behavior (photo dropped, text still sends) must be
    // disclosed before purchase (#24).
    expect(ADDON_FINE_PRINT.mms).toContain("dropped");
    expect(ADDON_FINE_PRINT.mms).toContain("still sends as text");
    // An outbound MMS meters as a flat 3 segments (MMS_SEGMENTS in
    // apps/api/src/messaging/media.ts; DECISIONS.md D5) — the allowance
    // cost must be disclosed, not denied (#24).
    expect(ADDON_FINE_PRINT.mms).toContain("three texts");
    // The composer has NO pre-send cap warning: the drop is only reported
    // after the send (thread/mms-gate.ts), and the advance alert is the
    // owner's 80% email (billing/usage-alerts.ts). Don't advertise a
    // warning that doesn't ship.
    expect(ADDON_FINE_PRINT.mms).not.toContain("warns you before");
    expect(ADDON_FINE_PRINT.mms).toContain("80%");
    // Missed-call text-back is the voice module's second half.
    expect(ADDON_FINE_PRINT.voice).toContain("text-back");
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
