import { buildLlmsTxt } from "@/lib/marketing/llms-txt";

/**
 * GET /llms.txt (#451) — the machine-readable description of the product.
 *
 * A ROUTE RATHER THAN A STATIC ASSET, which is the whole point of the issue. It
 * was `public/llms.txt`, typed by hand, and it drifted within a fortnight of the
 * AI features shipping while `sitemap.ts` — ten lines away in the same directory,
 * same audience, same content domain — could not, because it derives. This is that
 * pattern pointed at one more file.
 *
 * `force-static` so it is prerendered into the OpenNext build and served from the
 * edge exactly as the old asset was: nothing here reads a request, and paying for
 * an isolate to render a constant on every crawl would be a regression dressed up
 * as an improvement.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildLlmsTxt(), {
    headers: {
      // text/plain, and NOT text/markdown: the file uses markdown links because
      // they read well, but every consumer of llms.txt fetches it as plain text
      // and a markdown type invites a browser to try rendering it.
      "Content-Type": "text/plain; charset=utf-8",
      // Same hour the marketing HTML uses (next.config.ts s-maxage), so a deploy
      // that changes the product's description reaches crawlers on the same
      // schedule as the pages it describes.
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}
