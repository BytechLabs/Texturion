import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NotFound, { metadata } from "./not-found";

/**
 * Root 404 guards: branded (wordmark + v4 palette), self-contained (inline
 * styles only, nothing that needs the .mkt-scope wrapper), honest copy with
 * both escape hatches (/ and /pricing), and no em-dashes anywhere.
 */

const html = renderToStaticMarkup(<NotFound />);

describe("root not-found page", () => {
  it("is titled for the root '%s · Loonext' template", () => {
    expect(metadata.title).toBe("Page not found");
  });

  it("carries the Loonext wordmark and the plain 404 line", () => {
    expect(html).toContain("Loonext");
    expect(html).toContain("404");
    expect(html).toContain("That page doesn");
  });

  it("links back to the home page and to /pricing", () => {
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/pricing"');
  });

  it("inlines the v4 palette instead of leaning on scoped classes", () => {
    expect(html).toContain("#FBFCFE"); // ground
    expect(html).toContain("#10173B"); // ink
    expect(html).toContain("#2740DE"); // link/action
    // Self-contained: no Tailwind/marketing class names on the page.
    expect(html).not.toContain('class="mkt-');
    expect(html).not.toContain("var(--");
  });

  it("uses no em-dashes or en-dashes", () => {
    expect(html).not.toMatch(/—|–/);
    expect(String(metadata.title)).not.toMatch(/—|–/);
  });
});
