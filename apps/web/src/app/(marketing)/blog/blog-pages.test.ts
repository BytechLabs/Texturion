import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildRss, escapeXml } from "@/lib/marketing/blog-rss";
import { BLOG_POSTS, blogPostPath } from "@/lib/marketing/blog";
import { absoluteUrl } from "@/lib/marketing/site";

const BLOG_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Post directories on disk (everything except the index page and the feed). */
function postDirsOnDisk(): string[] {
  return readdirSync(BLOG_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "rss.xml")
    .map((entry) => entry.name);
}

describe("BLOG_POSTS registry invariants (#127)", () => {
  it("has unique kebab-case slugs", () => {
    const slugs = BLOG_POSTS.map((post) => post.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("keeps display dates in sync with ISO dates, newest first", () => {
    let prev = Infinity;
    for (const post of BLOG_POSTS) {
      expect(post.datePublishedIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const stamp = Date.parse(`${post.datePublishedIso}T12:00:00Z`);
      expect(Number.isNaN(stamp)).toBe(false);
      expect(stamp).toBeLessThanOrEqual(prev);
      prev = stamp;

      const display = new Date(stamp).toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      expect(post.datePublished).toBe(display);
    }
  });

  it("keeps meta descriptions within limits and reading times honest", () => {
    for (const post of BLOG_POSTS) {
      expect(post.description.length).toBeGreaterThan(40);
      expect(post.description.length).toBeLessThanOrEqual(160);
      expect(post.readingMinutes).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(post.readingMinutes)).toBe(true);
    }
  });

  it("follows the house rule: no em/en dashes in customer-facing copy", () => {
    for (const post of BLOG_POSTS) {
      expect(post.title).not.toMatch(/[–—]/);
      expect(post.description).not.toMatch(/[–—]/);
      expect(post.dateline).not.toMatch(/[–—]/);
    }
  });
});

describe("blog routes match the registry (zero dead links, both ways)", () => {
  it("every registry post has a page.tsx on disk", () => {
    for (const post of BLOG_POSTS) {
      const pagePath = path.join(BLOG_DIR, post.slug, "page.tsx");
      expect(existsSync(pagePath), `missing route for ${post.slug}`).toBe(true);
    }
  });

  it("every post authors its prose in content.mdx (#130)", () => {
    for (const post of BLOG_POSTS) {
      const mdxPath = path.join(BLOG_DIR, post.slug, "content.mdx");
      expect(existsSync(mdxPath), `missing content.mdx for ${post.slug}`).toBe(
        true,
      );
    }
  });

  it("every post directory on disk has a registry entry", () => {
    const registered = new Set(BLOG_POSTS.map((post) => post.slug));
    for (const dir of postDirsOnDisk()) {
      expect(registered.has(dir), `unregistered post directory ${dir}`).toBe(
        true,
      );
    }
  });
});

describe("/blog/rss.xml", () => {
  it("lists every post with its absolute permalink", () => {
    const rss = buildRss();
    expect(rss).toContain("<rss version=\"2.0\"");
    for (const post of BLOG_POSTS) {
      expect(rss).toContain(`<link>${absoluteUrl(blogPostPath(post.slug))}</link>`);
    }
  });

  it("escapes XML entities in authored text", () => {
    expect(escapeXml(`Quotes & "photos" <fast>`)).toBe(
      "Quotes &amp; &quot;photos&quot; &lt;fast&gt;",
    );
  });
});
