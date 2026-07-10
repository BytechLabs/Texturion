import { BLOG_POSTS, blogPostPath } from "@/lib/marketing/blog";
import { LIVE_ROUTES, SITE_URL, absoluteUrl } from "@/lib/marketing/site";

/**
 * RSS 2.0 for /blog/rss.xml (#127), generated from the BLOG_POSTS registry,
 * the same source of truth as the index page and the sitemap. Lives outside
 * the route file because Next route modules may only export HTTP methods and
 * route config, and the builder is unit-tested directly.
 */

/** Minimal XML text escape for element content we author ourselves. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildRss(): string {
  const items = BLOG_POSTS.map((post) => {
    const url = absoluteUrl(blogPostPath(post.slug));
    // Midday UTC keeps the calendar date stable in every RSS reader timezone.
    const pubDate = new Date(
      `${post.datePublishedIso}T12:00:00Z`,
    ).toUTCString();
    return [
      "    <item>",
      `      <title>${escapeXml(post.title)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      `      <pubDate>${pubDate}</pubDate>`,
      `      <description>${escapeXml(post.description)}</description>`,
      "    </item>",
    ].join("\n");
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>The Loonext blog</title>
    <link>${absoluteUrl(LIVE_ROUTES.blog)}</link>
    <atom:link href="${SITE_URL}/blog/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Plain-English guides on customer texting for small service crews.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
}
