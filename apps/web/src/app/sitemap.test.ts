import { describe, expect, it } from "vitest";

import sitemap from "@/app/sitemap";
import { LIVE_ROUTES, absoluteUrl } from "@/lib/marketing/site";

const liveRoutePaths = new Set<string>(Object.values(LIVE_ROUTES));

describe("sitemap route inventory (BLUEPRINT §11.3 single source of truth)", () => {
  it("emits every LIVE_ROUTES path exactly once, as an absolute URL", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.sort()).toEqual(
      [...liveRoutePaths].map((path) => absoluteUrl(path)).sort(),
    );
  });
});
