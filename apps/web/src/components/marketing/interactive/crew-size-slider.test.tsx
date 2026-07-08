import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PLAN_PRICING } from "@/lib/api/types";

import { CrewSizeSlider, MAX_CREW, loonextPrice } from "./crew-size-slider";
import { CrewSizeSliderStatic } from "./crew-size-slider-static";

describe("crew-size slider plan figures trace to PLAN_PRICING (finding 5)", () => {
  it("prices the crew from the shared constants, never a retyped literal", () => {
    // At or below Starter's seat ceiling: Starter's flat price.
    expect(loonextPrice(1)).toEqual({
      plan: "Starter",
      price: PLAN_PRICING.starter.monthlyDollars,
    });
    expect(loonextPrice(PLAN_PRICING.starter.seats)).toEqual({
      plan: "Starter",
      price: PLAN_PRICING.starter.monthlyDollars,
    });
    // One over the ceiling and up: Pro's flat price.
    expect(loonextPrice(PLAN_PRICING.starter.seats + 1)).toEqual({
      plan: "Pro",
      price: PLAN_PRICING.pro.monthlyDollars,
    });
    expect(loonextPrice(MAX_CREW)).toEqual({
      plan: "Pro",
      price: PLAN_PRICING.pro.monthlyDollars,
    });
  });

  it("offers a crew up to Pro's included-seat ceiling", () => {
    expect(MAX_CREW).toBe(PLAN_PRICING.pro.seats);
  });

  it("renders the derived Pro price at the default 6-person crew", () => {
    const html = renderToStaticMarkup(<CrewSizeSlider />);
    expect(html).toContain(`$${PLAN_PRICING.pro.monthlyDollars}/mo`);
    // The slider caps at the derived ceiling.
    expect(html).toContain(`max="${MAX_CREW}"`);
  });

  it("keeps the static frame's figure in lockstep with the interactive one", () => {
    const html = renderToStaticMarkup(<CrewSizeSliderStatic />);
    // The static default (6 people) is Pro — the same derived price.
    expect(html).toContain(`$${PLAN_PRICING.pro.monthlyDollars}/mo`);
    // The max-crew tick derives from Pro's seat ceiling, matching the
    // interactive slider's MAX_CREW tick — never a retyped literal.
    expect(html).toContain(`<span>${PLAN_PRICING.pro.seats}</span>`);
  });
});
