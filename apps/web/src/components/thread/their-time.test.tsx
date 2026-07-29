import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DestinationClock } from "@/lib/api/types";

import { TheirTime } from "./their-time";

/**
 * #225 — the composer's "what time is it there" line.
 *
 * The two things worth pinning are both about restraint: it appears ONLY when
 * it is quiet there (a clock on screen all day is furniture, and furniture is
 * not read), and it never claims more certainty than the rung it came from.
 */
const clock = (over: Partial<DestinationClock> = {}): DestinationClock => ({
  timezone: "America/Toronto",
  source: "area_code",
  local_hour: 21,
  quiet: true,
  ...over,
});

const render = (value: DestinationClock | null) =>
  renderToStaticMarkup(<TheirTime clock={value} />);

describe("TheirTime", () => {
  it("says nothing during the day", () => {
    // The whole design: silent when the answer would not change anything.
    expect(render(clock({ local_hour: 14, quiet: false }))).toBe("");
  });

  it("says nothing when the clock could not be resolved", () => {
    expect(render(null)).toBe("");
  });

  it("gives the hour in plain twelve-hour terms when it is quiet", () => {
    const html = render(clock({ local_hour: 21 }));
    expect(html).toContain("9pm");
    expect(html).toContain("where they are");
  });

  it("handles midnight and noon without saying 0", () => {
    expect(render(clock({ local_hour: 0 }))).toContain("12am");
    // Noon is never quiet under the default window, but Texas Sundays make it
    // reachable — and "0pm" would be the giveaway that nobody checked.
    expect(render(clock({ local_hour: 12, quiet: true }))).toContain("12pm");
  });

  it("names the rung, because an area code is a guess that can be wrong", () => {
    expect(render(clock({ source: "area_code" }))).toContain("from their area code");
    expect(render(clock({ source: "contact" }))).toContain("set on their contact");
  });

  it("admits it when the answer is really our own clock", () => {
    // The weakest rung. Letting this read as the customer's time would be
    // presenting our timezone as theirs.
    expect(render(clock({ source: "company" }))).toContain("we don&#x27;t know theirs");
  });
});
