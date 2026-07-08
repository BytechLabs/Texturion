/**
 * The city area-code widget must seed its default frame to the visitor's
 * country, so a US visitor never lands on the Canadian day-one line and a
 * Canadian never lands on the US carrier-wait line. The per-result line still
 * reflects whatever number the visitor chooses to look up; these tests pin the
 * initial (untouched) frame, which is what a US or CA visitor first reads.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CountryProvider, type Country } from "@/components/marketing/country";

import { CityAreaCodeWidget } from "./city-area-code-widget";
import { CityAreaCodeWidgetStatic } from "./city-area-code-widget-static";

const render = (country: Country) =>
  renderToStaticMarkup(
    <CountryProvider initialCountry={country}>
      <CityAreaCodeWidget />
    </CountryProvider>,
  );

describe("city area-code widget seeds to the visitor's country (no cross-country leak)", () => {
  it("US default: a US number example and the carrier-wait line, no Canadian day-one copy", () => {
    const html = render("us");
    expect(html).toContain("Austin");
    expect(html).toContain("(512)");
    expect(html).toContain(
      "US number, receiving works day one; texting turns on in about a week.",
    );
    expect(html).not.toContain("the same day you sign up");
    expect(html).not.toContain("Canadian number");
    expect(html).not.toContain("Toronto");
  });

  it("CA: the Toronto example and the same-day line, no US carrier-wait copy", () => {
    const html = render("ca");
    expect(html).toContain("Toronto");
    expect(html).toContain("(416)");
    expect(html).toContain(
      "Canadian number, texting works the same day you sign up.",
    );
    expect(html).not.toContain("turns on in about a week");
    expect(html).not.toContain("Austin");
  });

  it("the static pre-hydration frame carries the US default only (no Canadian day-one copy)", () => {
    const html = renderToStaticMarkup(<CityAreaCodeWidgetStatic />);
    expect(html).toContain("Austin");
    expect(html).toContain("(512)");
    expect(html).toContain(
      "US number, receiving works day one; texting turns on in about a week.",
    );
    expect(html).not.toContain("the same day you sign up");
    expect(html).not.toContain("Canadian number");
  });

  it("no em-dashes or en-dash ranges in either country's frame", () => {
    for (const html of [
      render("us"),
      render("ca"),
      renderToStaticMarkup(<CityAreaCodeWidgetStatic />),
    ]) {
      expect(html).not.toContain("—");
      expect(html).not.toContain("–");
    }
  });
});
