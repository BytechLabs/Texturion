/**
 * #710: the web version and build id this deployment serves. A tab opened
 * before a deploy keeps running its old bundle, so it compares its own build
 * with this and offers a reload. Dotted so the middleware leaves it alone, and
 * never cached, because its one job is to say what is live now.
 */

export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    {
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
      build: process.env.NEXT_PUBLIC_WEB_BUILD_ID || null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
