/**
 * #473 — the two files that let the native apps enrol passkeys against this
 * domain.
 *
 * Android's Credential Manager fetches `/.well-known/assetlinks.json` and
 * Apple's `webcredentials` fetches `/.well-known/apple-app-site-association`.
 * Both refuse the ceremony unless they find their own app named there. Neither
 * is optional, and neither can be faked: the values are cryptographic
 * identities issued by the stores.
 *
 * ## Why this is configuration rather than a checked-in constant
 *
 * The values do not exist yet and must not be invented. Nothing has been
 * uploaded to either store, and with Play App Signing the Android fingerprint
 * that finally matters is *created by Google at first upload*. A guessed value
 * would be a published claim that some app may act for this domain — false, and
 * false in the direction that matters.
 *
 * Unset, both files serve an empty list: a valid, honest "no app is authorised".
 * Set, the phones start working with no code change and no store release. That
 * asymmetry is the point — a web deploy takes minutes and an app update takes
 * weeks, so the half that can move fast is the half that carries the switch.
 *
 * The apps read these same files back as a capability probe before offering a
 * passkey at all, so an unconfigured domain shows no button rather than a button
 * that always fails.
 */

/** The package the Android statements are about. Matches `applicationId`. */
export const ANDROID_PACKAGE = "com.loonext.android";

/**
 * WebAuthn's relation. A passkey created by the app works on this site and vice
 * versa, which is the whole point: one second factor, not one per client.
 *
 * This relation ONLY. `common.handle_all_urls` would be a claim that the app
 * handles links for this domain — a different feature that does not exist. Asset
 * links are read by more than one subsystem and each relation grants something
 * real.
 */
export const LOGIN_CREDS_RELATION = "delegate_permission/common.get_login_creds";

export interface AssetLinkStatement {
  relation: string[];
  target: {
    namespace: string;
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
}

/**
 * Whether a value is a SHA-256 fingerprint in the colon-separated hex form
 * Google's tooling emits.
 *
 * Malformed entries are dropped rather than served, because a bad one fails
 * silently: Play services reads the file, matches nothing, and reports the same
 * generic refusal it reports for a missing file. A short correct list beats a
 * long inert one.
 */
export function isSha256Fingerprint(value: string): boolean {
  return /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value);
}

/**
 * Every certificate allowed to sign an Android build that may act for this
 * domain.
 *
 * More than one is normal and not a weakening: with Play App Signing the upload
 * certificate and the distribution certificate differ, and both must be listed
 * or half the builds fail.
 */
export function androidFingerprints(
  env: Record<string, string | undefined>,
): string[] {
  return (env.LOONEXT_ANDROID_CERT_FINGERPRINTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(isSha256Fingerprint);
}

export function assetLinks(
  env: Record<string, string | undefined>,
): AssetLinkStatement[] {
  const fingerprints = androidFingerprints(env);
  if (fingerprints.length === 0) return [];
  return [
    {
      relation: [LOGIN_CREDS_RELATION],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

/**
 * Whether a value is an Apple application identifier: a ten-character Team ID,
 * a dot, then the bundle id.
 *
 * Same reasoning as the fingerprint filter — Apple's fetcher does not report a
 * malformed entry, it just never associates.
 */
export function isAppleAppId(value: string): boolean {
  return /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/.test(value);
}

export function appleAppIds(env: Record<string, string | undefined>): string[] {
  return (env.LOONEXT_IOS_APP_IDS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(isAppleAppId);
}

/**
 * The apple-app-site-association document.
 *
 * `webcredentials` only. `applinks` and `appclips` are separate features with
 * separate consequences, and this domain claims neither.
 */
export function appleAppSiteAssociation(
  env: Record<string, string | undefined>,
): { webcredentials: { apps: string[] } } {
  return { webcredentials: { apps: appleAppIds(env) } };
}
