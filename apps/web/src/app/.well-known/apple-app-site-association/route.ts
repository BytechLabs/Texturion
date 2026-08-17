import { appleAppSiteAssociation } from "@/lib/well-known/app-association";

/**
 * The apple-app-site-association file, served at
 * /.well-known/apple-app-site-association.
 *
 * #473 — what lets the iOS app enrol a passkey against this domain. Apple
 * fetches it through its own CDN when the app declares
 * `webcredentials:app.loonext.com`, and `ASAuthorizationPlatformPublicKeyCredentialProvider`
 * fails until the app's identifier appears here.
 *
 * TWO THINGS APPLE IS STRICT ABOUT, and both are properties of this handler
 * rather than of the document: the path has NO file extension, and the response
 * must be `application/json` served directly — a redirect, or a 404 page with a
 * 200, and the domain silently never associates.
 *
 * The contents, and why they come from configuration, live in
 * `lib/well-known/app-association`. Only the response shape belongs here: Next
 * type-checks `route.ts` against an allowlist of export names.
 */

export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(
    JSON.stringify(appleAppSiteAssociation(process.env), null, 2),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=300",
      },
    },
  );
}
