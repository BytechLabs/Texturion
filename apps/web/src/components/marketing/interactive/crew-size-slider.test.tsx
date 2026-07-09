import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PLAN_PRICING } from "@/lib/api/types";

import { CrewSizeSlider, MAX_CREW, loonextPrice } from "./crew-size-slider";
import { CrewSizeSliderStatic } from "./crew-size-slider-static";

// Starter's included seats is always a real number (5); Pro's is null =
// unlimited (#83), so it never bounds the slider.
const STARTER_SEATS = PLAN_PRICING.starter.seats ?? 0;

describe("crew-size slider plan figures trace to PLAN_PRICING (finding 5)", () => {
  it("prices the crew from the shared constants, never a retyped literal", () => {
    // At or below Starter's seat ceiling: Starter's flat price.
    expect(loonextPrice(1)).toEqual({
      plan: "Starter",
      price: PLAN_PRICING.starter.monthlyDollars,
    });
    expect(loonextPrice(STARTER_SEATS)).toEqual({
      plan: "Starter",
      price: PLAN_PRICING.starter.monthlyDollars,
    });
    // One over the ceiling and up: Pro's flat price.
    expect(loonextPrice(STARTER_SEATS + 1)).toEqual({
      plan: "Pro",
      price: PLAN_PRICING.pro.monthlyDollars,
    });
    expect(loonextPrice(MAX_CREW)).toEqual({
      plan: "Pro",
      price: PLAN_PRICING.pro.monthlyDollars,
    });
  });

  it("offers a fixed marketing crew range; Pro's seats are unlimited (#83)", () => {
    // Pro no longer caps seats, so the slider's ceiling is a fixed marketing
    // range decoupled from the plan.
    expect(PLAN_PRICING.pro.seats).toBeNull();
    expect(MAX_CREW).toBe(10);
  });

  it("renders the derived Pro price at the default 6-person crew", () => {
    const html = renderToStaticMarkup(<CrewSizeSlider />);
    expect(html).toContain(`$${PLAN_PRICING.pro.monthlyDollars}/mo`);
    // The slider caps at the fixed marketing ceiling.
    expect(html).toContain(`max="${MAX_CREW}"`);
  });

  it("keeps the static frame's figure in lockstep with the interactive one", () => {
    const html = renderToStaticMarkup(<CrewSizeSliderStatic />);
    // The static default (6 people) is Pro — the same derived price.
    expect(html).toContain(`$${PLAN_PRICING.pro.monthlyDollars}/mo`);
    // The max-crew tick mirrors the interactive slider's MAX_CREW tick.
    expect(html).toContain(`<span>${MAX_CREW}</span>`);
  });
});
