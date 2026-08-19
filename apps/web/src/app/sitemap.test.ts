import { describe, expect, it } from "vitest";

import sitemap from "@/app/sitemap";
import { BLOG_POSTS, blogPostPath } from "@/lib/marketing/blog";
import { LIVE_ROUTES, absoluteUrl } from "@/lib/marketing/site";
import { TRANSLATED_PAGES } from "@/lib/marketing/translated-pages";

const expectedPaths = new Set<string>([
  ...Object.values(LIVE_ROUTES),
  ...BLOG_POSTS.map((post) => blogPostPath(post.slug)),
  // D138 — the French pages come from the registry that also drives their
  // hreflang, so this stays a check that the sitemap matches the routes that
  // exist rather than a second list of them.
  ...TRANSLATED_PAGES.map((page) => page.fr),
]);

describe("sitemap route inventory (BLUEPRINT §11.3 single source of truth)", () => {
  it("emits every LIVE_ROUTES path and every blog post exactly once, as absolute URLs", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.sort()).toEqual(
      [...expectedPaths].map((path) => absoluteUrl(path)).sort(),
    );
  });
});
