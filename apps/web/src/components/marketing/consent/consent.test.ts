import { describe, expect, it } from "vitest";

import {
  CONSENT_CHANGE_EVENT,
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  consentCookieString,
  consentSignals,
  isConsentChoice,
  pushConsentUpdate,
  readStoredConsent,
  saveConsentChoice,
  type ConsentWindow,
} from "./consent";

describe("isConsentChoice", () => {
  it("accepts exactly the two choices", () => {
    expect(isConsentChoice("granted")).toBe(true);
    expect(isConsentChoice("denied")).toBe(true);
    expect(isConsentChoice("yes")).toBe(false);
    expect(isConsentChoice("")).toBe(false);
    expect(isConsentChoice(null)).toBe(false);
    expect(isConsentChoice(undefined)).toBe(false);
  });
});

describe("readStoredConsent (#124)", () => {
  it("reads the choice out of a full document.cookie string", () => {
    expect(
      readStoredConsent(`a=b; ${CONSENT_COOKIE}=granted; c=d`),
    ).toBe("granted");
    expect(readStoredConsent(`${CONSENT_COOKIE}=denied`)).toBe("denied");
  });
  it("returns null when nothing valid is stored", () => {
    expect(readStoredConsent("")).toBeNull();
    expect(readStoredConsent(null)).toBeNull();
    expect(readStoredConsent(undefined)).toBeNull();
    expect(readStoredConsent("a=b; c=d")).toBeNull();
    expect(readStoredConsent(`${CONSENT_COOKIE}=maybe`)).toBeNull();
    expect(readStoredConsent(`${CONSENT_COOKIE}=`)).toBeNull();
  });
  it("never matches a foreign cookie whose name merely contains ours", () => {
    // The "." in the name must not act as a regex wildcard, and a prefixed
    // name (xloonext.consent) must not satisfy the boundary.
    expect(readStoredConsent("loonextXconsent=granted")).toBeNull();
    expect(readStoredConsent(`x${CONSENT_COOKIE}=granted`)).toBeNull();
  });
});

describe("consentCookieString (#124)", () => {
  it("serializes the choice with the 180-day lifetime, host-only, Lax", () => {
    const cookie = consentCookieString("granted", false);
    expect(cookie).toContain(`${CONSENT_COOKIE}=granted`);
    expect(cookie).toContain(`Max-Age=${CONSENT_MAX_AGE_SECONDS}`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain");
    expect(cookie).not.toContain("Secure");
  });
  it("adds Secure only on https (localhost previews still persist)", () => {
    expect(consentCookieString("denied", true)).toContain("; Secure");
  });
  it("round-trips through readStoredConsent", () => {
    // A document.cookie READ returns only "name=value" pairs.
    expect(readStoredConsent(`${CONSENT_COOKIE}=denied`)).toBe("denied");
  });
});

describe("consentSignals (#124)", () => {
  it("moves the four Consent Mode v2 signals as one unit", () => {
    expect(consentSignals("granted")).toEqual({
      ad_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
      analytics_storage: "granted",
      security_storage: "granted",
    });
  });
  it("keeps security_storage granted even when everything else is denied", () => {
    const denied = consentSignals("denied");
    expect(denied.ad_storage).toBe("denied");
    expect(denied.ad_user_data).toBe("denied");
    expect(denied.ad_personalization).toBe("denied");
    expect(denied.analytics_storage).toBe("denied");
    expect(denied.security_storage).toBe("granted");
  });
});

describe("pushConsentUpdate (#124)", () => {
  it("pushes ONE genuine Arguments object (the gtag calling convention)", () => {
    const dataLayer: unknown[] = [];
    pushConsentUpdate(dataLayer, "granted");
    expect(dataLayer).toHaveLength(1);
    const entry = dataLayer[0] as ArrayLike<unknown>;
    // GTM matches on a real Arguments object; a plain array is ignored.
    expect(Array.isArray(entry)).toBe(false);
    expect(entry).toHaveLength(3);
    expect(entry[0]).toBe("consent");
    expect(entry[1]).toBe("update");
    expect(entry[2]).toEqual(consentSignals("granted"));
  });
});

function fakeWindow(protocol: string): ConsentWindow & {
  events: Event[];
} {
  const events: Event[] = [];
  return {
    document: { cookie: "" },
    location: { protocol },
    dispatchEvent(event: Event) {
      events.push(event);
      return true;
    },
    events,
  };
}

describe("saveConsentChoice (#124)", () => {
  it("writes the cookie, seeds + updates the dataLayer, and notifies", () => {
    const win = fakeWindow("https:");
    saveConsentChoice(win, "denied");
    expect(win.document.cookie).toContain(`${CONSENT_COOKIE}=denied`);
    expect(win.document.cookie).toContain("; Secure");
    expect(win.dataLayer).toHaveLength(1);
    const entry = win.dataLayer?.[0] as ArrayLike<unknown>;
    expect(entry[1]).toBe("update");
    expect(entry[2]).toEqual(consentSignals("denied"));
    expect(win.events).toHaveLength(1);
    expect(win.events[0].type).toBe(CONSENT_CHANGE_EVENT);
  });
  it("appends to an existing dataLayer instead of replacing it", () => {
    const win = fakeWindow("http:");
    win.dataLayer = [{ existing: true }];
    saveConsentChoice(win, "granted");
    expect(win.dataLayer).toHaveLength(2);
    expect(win.document.cookie).not.toContain("Secure");
  });
  it("still updates the dataLayer when the cookie write throws", () => {
    const win = fakeWindow("https:");
    Object.defineProperty(win.document, "cookie", {
      set() {
        throw new Error("blocked");
      },
    });
    saveConsentChoice(win, "granted");
    expect(win.dataLayer).toHaveLength(1);
    expect(win.events).toHaveLength(1);
  });
});
