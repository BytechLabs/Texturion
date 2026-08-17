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

import {
  ANDROID_APP_LINK_PATHS,
  APPLE_APP_LINK_COMPONENTS,
} from "@loonext/shared";

/** The package the Android statements are about. Matches `applicationId`. */
export const ANDROID_PACKAGE = "com.loonext.android";

/**
 * WebAuthn's relation. A passkey created by the app works on this site and vice
 * versa, which is the whole point: one second factor, not one per client.
 */
export const LOGIN_CREDS_RELATION = "delegate_permission/common.get_login_creds";

/**
 * #613 — Android App Links. What lets Play services verify that this domain
 * agrees the app may handle its https links.
 *
 * A SECOND relation on the same statement rather than a second statement, which
 * is how Google's own tooling reads it: one target, every relation it is
 * trusted for.
 *
 * This authorises the app to be a VERIFIED handler; it does not decide WHICH
 * paths it handles. That scoping lives in the manifest's intent filter, from the
 * same shared list Apple's components are built from — see
 * packages/shared/src/app-links.ts for why the list is narrow.
 */
export const HANDLE_URLS_RELATION = "delegate_permission/common.handle_all_urls";

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
      relation: [LOGIN_CREDS_RELATION, HANDLE_URLS_RELATION],
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

export interface AppleAppSiteAssociation {
  applinks: {
    details: { appIDs: string[]; components: { "/": string }[] }[];
  };
  webcredentials: { apps: string[] };
}

/**
 * The apple-app-site-association document.
 *
 * TWO features from one file, and Apple fetches it once for both.
 *
 * `webcredentials` (#473) is what lets a passkey enrolled in the app be the
 * same credential the web app sees. `applinks` (#613) is what makes a tap on
 * an https link open the app — declared in the entitlement since the app was
 * built, routed by `parsePushRoute` since then, and never once working, because
 * nothing served this file at all. An unassociated domain is indistinguishable
 * from an ordinary web link: no error, no warning, every tap quietly landing in
 * Safari.
 *
 * `appclips` is a third feature this domain does not claim.
 *
 * ## Both halves stay inert without an app id
 *
 * `details` is omitted entirely rather than listed with an empty `appIDs`,
 * because those are different claims: an empty details list says "no app handles
 * these paths", and a detail naming no app is a malformed one Apple may or may
 * not ignore. The narrow reading is the safe one.
 */
export function appleAppSiteAssociation(
  env: Record<string, string | undefined>,
): AppleAppSiteAssociation {
  const apps = appleAppIds(env);
  return {
    applinks: {
      details:
        apps.length === 0
          ? []
          : [
              {
                appIDs: apps,
                components: APPLE_APP_LINK_COMPONENTS.map((path) => ({
                  "/": path,
                })),
              },
            ],
    },
    webcredentials: { apps },
  };
}

/**
 * The manifest's intent-filter paths, re-exported so the Android guard and the
 * Apple document are visibly reading one list.
 */
export { ANDROID_APP_LINK_PATHS };
