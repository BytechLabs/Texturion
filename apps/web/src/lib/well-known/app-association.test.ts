import { describe, expect, it } from "vitest";

import { APPLE_APP_LINK_COMPONENTS } from "@loonext/shared";

import {
  ANDROID_PACKAGE,
  HANDLE_URLS_RELATION,
  LOGIN_CREDS_RELATION,
  androidFingerprints,
  appleAppIds,
  appleAppSiteAssociation,
  assetLinks,
  isAppleAppId,
  isSha256Fingerprint,
} from "./app-association";

/**
 * #473 — the two files that decide whether a phone can enrol a passkey.
 *
 * What these hold is the honesty of the unconfigured state. Both files are
 * PUBLISHED SECURITY CLAIMS: a statement here says some app may act for this
 * domain. Nothing has been uploaded to either store, so the true answer today
 * is "no app", and the failure mode worth guarding is a plausible-looking
 * placeholder shipping as if it were real.
 */

const A_FINGERPRINT =
  "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:" +
  "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";

describe("assetlinks.json", () => {
  it("authorises nobody when no fingerprint is configured", () => {
    // The state the domain is in today, and the one that must not drift into a
    // guess. An empty list is a valid statement file meaning exactly this.
    expect(assetLinks({})).toEqual([]);
    expect(assetLinks({ LOONEXT_ANDROID_CERT_FINGERPRINTS: "" })).toEqual([]);
  });

  it("names the package and the relation WebAuthn actually checks", () => {
    const [statement] = assetLinks({
      LOONEXT_ANDROID_CERT_FINGERPRINTS: A_FINGERPRINT,
    });
    expect(statement?.target.package_name).toBe(ANDROID_PACKAGE);
    expect(statement?.relation).toEqual([
      LOGIN_CREDS_RELATION,
      HANDLE_URLS_RELATION,
    ]);
  });

  it("grants URL handling on the same statement, not a second one", () => {
    // #613 added `handle_all_urls` — App Links, a different feature read by a
    // different subsystem out of the same file. It is a second relation on ONE
    // target rather than a second statement, which is how Google's own tooling
    // reads it: one target, every relation it is trusted for.
    //
    // This authorises the app to be a verified handler. It does NOT decide
    // which paths it handles — the manifest's intent filter does, from the
    // shared list. app-links.test.ts holds those two together.
    const statements = assetLinks({
      LOONEXT_ANDROID_CERT_FINGERPRINTS: A_FINGERPRINT,
    });
    expect(statements).toHaveLength(1);
    expect(statements[0]?.relation).toContain(HANDLE_URLS_RELATION);
  });

  it("still authorises nobody when no fingerprint is configured", () => {
    // The inert default matters more now than it did for passkeys alone: an
    // empty file is a domain that agrees no app may handle its links.
    expect(assetLinks({})).toEqual([]);
  });

  it("carries both certificates when Play App Signing produces two", () => {
    const second = A_FINGERPRINT.replace(/^AA/, "BB");
    const [statement] = assetLinks({
      LOONEXT_ANDROID_CERT_FINGERPRINTS: `${A_FINGERPRINT}, ${second}`,
    });
    expect(statement?.target.sha256_cert_fingerprints).toEqual([
      A_FINGERPRINT,
      second,
    ]);
  });

  it("drops a malformed fingerprint rather than serving it", () => {
    // A bad entry fails silently at the far end: Play services matches nothing
    // and reports the same refusal it reports for a missing file. Serving it
    // would turn a typo into an afternoon of debugging the app.
    expect(androidFingerprints({ LOONEXT_ANDROID_CERT_FINGERPRINTS: "nope" })).toEqual(
      [],
    );
    expect(
      androidFingerprints({
        LOONEXT_ANDROID_CERT_FINGERPRINTS: `nope, ${A_FINGERPRINT}`,
      }),
    ).toEqual([A_FINGERPRINT]);
  });

  it("accepts the exact shape Google's tooling emits, and no other", () => {
    expect(isSha256Fingerprint(A_FINGERPRINT)).toBe(true);
    // SHA-1 is 20 bytes. It is what most Android documentation shows first, and
    // it is not what WebAuthn accepts.
    expect(isSha256Fingerprint(A_FINGERPRINT.slice(0, 59))).toBe(false);
    // Lowercase hex is a real paste from some tools; callers upcase first.
    expect(isSha256Fingerprint(A_FINGERPRINT.toLowerCase())).toBe(false);
  });
});

describe("apple-app-site-association", () => {
  it("authorises nobody, for either feature, when no app id is configured", () => {
    expect(appleAppSiteAssociation({})).toEqual({
      applinks: { details: [] },
      webcredentials: { apps: [] },
    });
  });

  it("omits the detail entirely rather than listing one with no app", () => {
    // Different claims. An empty `details` says "no app handles these paths";
    // a detail naming no app is malformed, and Apple's fetcher reports neither.
    const document = appleAppSiteAssociation({});
    expect(document.applinks.details).toEqual([]);
  });

  it("carries both features once an app id exists", () => {
    // #473 put webcredentials here; #613 added applinks. Apple fetches this
    // file once for both, which is why they share a document rather than a
    // route.
    const document = appleAppSiteAssociation({
      LOONEXT_IOS_APP_IDS: "ABCDE12345.com.loonext.ios",
    });
    expect(document.webcredentials.apps).toEqual(["ABCDE12345.com.loonext.ios"]);
    expect(document.applinks.details[0]?.appIDs).toEqual([
      "ABCDE12345.com.loonext.ios",
    ]);
    // `appclips` is a third feature this domain does not claim.
    expect(Object.keys(document).sort()).toEqual(["applinks", "webcredentials"]);
  });

  it("claims named paths and never the wildcard", () => {
    // The whole risk of this feature in one assertion. `*` would take
    // /q/<token> — a customer's quote page, opened from a text — away from the
    // browser and hand it to an app that cannot render it and that the customer
    // cannot log into.
    const document = appleAppSiteAssociation({
      LOONEXT_IOS_APP_IDS: "ABCDE12345.com.loonext.ios",
    });
    const components = document.applinks.details[0]?.components ?? [];
    expect(components.length).toBeGreaterThan(0);
    for (const component of components) {
      expect(component["/"]).not.toBe("*");
      expect(component["/"].startsWith("/")).toBe(true);
    }
    expect(components.map((c) => c["/"])).toEqual([
      ...APPLE_APP_LINK_COMPONENTS,
    ]);
  });

  it("requires the team prefix, which is the half people forget", () => {
    // A bare bundle id is the commonest wrong answer here and Apple never says
    // so — the domain simply never associates.
    expect(isAppleAppId("com.loonext.ios")).toBe(false);
    expect(isAppleAppId("ABCDE12345.com.loonext.ios")).toBe(true);
    expect(appleAppIds({ LOONEXT_IOS_APP_IDS: "com.loonext.ios" })).toEqual([]);
  });
});
