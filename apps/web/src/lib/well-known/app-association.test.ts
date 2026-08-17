import { describe, expect, it } from "vitest";

import {
  ANDROID_PACKAGE,
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
    expect(statement?.relation).toEqual([LOGIN_CREDS_RELATION]);
  });

  it("claims only login credentials, never URL handling", () => {
    // `handle_all_urls` would be a claim that the app opens links for this
    // domain — a different feature, granted by a different subsystem reading
    // the same file. Passkeys do not need it.
    const json = JSON.stringify(
      assetLinks({ LOONEXT_ANDROID_CERT_FINGERPRINTS: A_FINGERPRINT }),
    );
    expect(json).not.toContain("handle_all_urls");
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
  it("authorises nobody when no app id is configured", () => {
    expect(appleAppSiteAssociation({})).toEqual({ webcredentials: { apps: [] } });
  });

  it("claims webcredentials only, never applinks", () => {
    const document = appleAppSiteAssociation({
      LOONEXT_IOS_APP_IDS: "ABCDE12345.com.loonext.ios",
    });
    expect(Object.keys(document)).toEqual(["webcredentials"]);
    expect(document.webcredentials.apps).toEqual(["ABCDE12345.com.loonext.ios"]);
  });

  it("requires the team prefix, which is the half people forget", () => {
    // A bare bundle id is the commonest wrong answer here and Apple never says
    // so — the domain simply never associates.
    expect(isAppleAppId("com.loonext.ios")).toBe(false);
    expect(isAppleAppId("ABCDE12345.com.loonext.ios")).toBe(true);
    expect(appleAppIds({ LOONEXT_IOS_APP_IDS: "com.loonext.ios" })).toEqual([]);
  });
});
