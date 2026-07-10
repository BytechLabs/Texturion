import { buildRss } from "@/lib/marketing/blog-rss";

/**
 * /blog/rss.xml (#127): statically built (the BLOG_POSTS registry only
 * changes with a deploy) and advertised from the blog index via
 * alternates.types. The feed builder lives in lib/marketing/blog-rss.ts;
 * route modules may only export HTTP methods and route config.
 */

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildRss(), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
