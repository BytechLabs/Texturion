import { assetLinks } from "@/lib/well-known/app-association";

/**
 * Digital Asset Links, served at /.well-known/assetlinks.json.
 *
 * #473 — what lets the Android app enrol a passkey against this domain.
 * Credential Manager fetches this before showing the sheet and refuses the
 * ceremony unless it finds a statement naming the calling package and the
 * SHA-256 of the certificate that signed the installed APK.
 *
 * The statements themselves, and why they come from configuration rather than
 * a checked-in constant, live in `lib/well-known/app-association`. Nothing but
 * the response shape belongs here: Next type-checks `route.ts` against an
 * allowlist of export names, so a named helper exported from this file fails
 * the build.
 *
 * `force-dynamic` because the whole design is that this file turns on without a
 * code change — prerendering it would freeze the empty list into the bundle.
 */

export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(JSON.stringify(assetLinks(process.env), null, 2), {
    headers: {
      // Google's verifier requires exactly this content type.
      "content-type": "application/json",
      // Short: this file turning on is how passkeys start working, and a day of
      // staleness is a day of a fixed feature still looking broken.
      "cache-control": "public, max-age=300",
    },
  });
}
