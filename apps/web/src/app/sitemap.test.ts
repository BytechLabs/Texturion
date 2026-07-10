import { describe, expect, it } from "vitest";

import sitemap from "@/app/sitemap";
import { BLOG_POSTS, blogPostPath } from "@/lib/marketing/blog";
import { LIVE_ROUTES, absoluteUrl } from "@/lib/marketing/site";

const expectedPaths = new Set<string>([
  ...Object.values(LIVE_ROUTES),
  ...BLOG_POSTS.map((post) => blogPostPath(post.slug)),
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
