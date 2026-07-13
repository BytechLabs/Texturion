/**
 * Visual breadcrumb trail (#130). The trail must mirror the BreadcrumbList
 * JSON-LD the same pages emit: every crumb but the last is a link; the last is
 * the current page (aria-current, no link).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Breadcrumbs } from "./breadcrumbs";

const TRAIL = [
  { name: "Home", path: "/" },
  { name: "Blog", path: "/blog" },
  { name: "How to text quotes", path: "/blog/how-to-text-quotes-to-customers" },
];

describe("Breadcrumbs", () => {
  it("links every crumb but the last, which is the current page", () => {
    const html = renderToStaticMarkup(<Breadcrumbs crumbs={TRAIL} />);
    // Earlier crumbs are links to their paths.
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/blog"');
    // The current page is NOT a link, and is marked aria-current.
    expect(html).not.toContain(
      'href="/blog/how-to-text-quotes-to-customers"',
    );
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("How to text quotes");
    // Accessible landmark for the trail.
    expect(html).toContain('aria-label="Breadcrumb"');
  });

  it("renders an ordered list of every crumb name", () => {
    const html = renderToStaticMarkup(<Breadcrumbs crumbs={TRAIL} />);
    expect(html).toContain("<ol");
    for (const crumb of TRAIL) expect(html).toContain(crumb.name);
  });

  it("renders nothing for an empty trail", () => {
    expect(renderToStaticMarkup(<Breadcrumbs crumbs={[]} />)).toBe("");
  });
});
