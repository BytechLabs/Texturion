import { describe, expect, it } from "vitest";

import sitemap from "@/app/sitemap";
import { LIVE_ROUTES, absoluteUrl } from "@/lib/marketing/site";

import { FOOTER_COLUMNS } from "./footer-links";

const liveRoutePaths = new Set<string>(Object.values(LIVE_ROUTES));

describe("footer link inventory (BLUEPRINT §12 honesty guard)", () => {
  it("only links to routes in LIVE_ROUTES, zero dead links", () => {
    for (const column of FOOTER_COLUMNS) {
      for (const link of column.links) {
        expect(liveRoutePaths, `${column.heading} → ${link.label}`).toContain(
          link.href,
        );
      }
    }
  });

  it("never repeats an href across the footer", () => {
    const hrefs = FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("lists the full legal set in COPY §F order", () => {
    const legal = FOOTER_COLUMNS.find((c) => c.heading === "Legal");
    expect(legal?.links.map((l) => l.href)).toEqual([
      LIVE_ROUTES.terms,
      LIVE_ROUTES.privacy,
      LIVE_ROUTES.aup,
      LIVE_ROUTES.messaging,
      LIVE_ROUTES.subprocessors,
      LIVE_ROUTES.refunds,
    ]);
  });
});

describe("sitemap route inventory (BLUEPRINT §11.3 single source of truth)", () => {
  it("emits every LIVE_ROUTES path exactly once, as an absolute URL", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.sort()).toEqual(
      [...liveRoutePaths].map((path) => absoluteUrl(path)).sort(),
    );
  });
});
