/**
 * @vitest-environment happy-dom
 *
 * #501 — the middle of the referral programme, which was missing entirely.
 *
 * Two properties matter more than the mechanics. A hostile `?ref=` must never
 * reach storage or the API, because the parameter is attacker-controlled on a
 * public marketing page. And the attribution must EXPIRE, because #399's reward
 * is a real free month and a window that never closes eventually pays somebody
 * for a signup they had nothing to do with.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  captureReferralCode,
  clearReferralCode,
  readReferralCode,
  referralCodeForCreate,
  referralCodeFromSearch,
} from "./capture";

const CODE = "ABCD2345"; // eight of the shared alphabet
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("#501 referralCodeFromSearch", () => {
  it("reads a well-shaped code, with or without the leading question mark", () => {
    expect(referralCodeFromSearch(`?ref=${CODE}`)).toBe(CODE);
    expect(referralCodeFromSearch(`ref=${CODE}`)).toBe(CODE);
  });

  it("normalises case and the formatting people add by hand", () => {
    expect(referralCodeFromSearch("?ref=abcd-2345")).toBe(CODE);
    expect(referralCodeFromSearch("?ref= abcd 2345 ")).toBe(CODE);
  });

  it("returns null for anything that is not one of our codes", () => {
    expect(referralCodeFromSearch("")).toBeNull();
    expect(referralCodeFromSearch("?utm_source=x")).toBeNull();
    expect(referralCodeFromSearch("?ref=")).toBeNull();
    expect(referralCodeFromSearch("?ref=SHORT")).toBeNull();
    // O and 1 are excluded from the alphabet precisely because they are
    // misread; a code containing one was mistyped, not folded.
    expect(referralCodeFromSearch("?ref=ABCD234O")).toBeNull();
  });

  it("refuses hostile values without touching them", () => {
    // The parameter is attacker-controlled. Shape-checking here is what keeps
    // the value that reaches storage and the API a code rather than a payload.
    expect(
      referralCodeFromSearch("?ref=" + encodeURIComponent("<script>x</script>")),
    ).toBeNull();
    expect(referralCodeFromSearch(`?ref=${"A".repeat(5000)}`)).toBeNull();
  });
});

describe("#501 capture and read", () => {
  it("remembers a captured code across later page loads", () => {
    expect(captureReferralCode(`?ref=${CODE}`)).toBe(CODE);
    expect(readReferralCode()).toBe(CODE);
  });

  it("leaves an existing attribution alone on a page with no ref", () => {
    // The whole journey being tracked is landing page -> signup -> onboarding,
    // and only the first of those carries the parameter.
    captureReferralCode(`?ref=${CODE}`);
    expect(captureReferralCode("?utm_source=x")).toBeNull();
    expect(readReferralCode()).toBe(CODE);
  });

  it("lets the most recent link win", () => {
    captureReferralCode(`?ref=${CODE}`);
    captureReferralCode("?ref=WXYZ6789");
    expect(readReferralCode()).toBe("WXYZ6789");
  });

  it("expires after the window, and deletes rather than ignoring", () => {
    const start = 1_000_000_000_000;
    captureReferralCode(`?ref=${CODE}`, start);
    expect(readReferralCode(start + 29 * DAY)).toBe(CODE);
    expect(readReferralCode(start + 31 * DAY)).toBeNull();
    // Gone, not merely unread: a stale attribution should stop existing at the
    // moment it stops counting.
    expect(window.localStorage.getItem("loonext:referral")).toBeNull();
  });

  it("restarts the clock on a fresh touch", () => {
    const start = 1_000_000_000_000;
    captureReferralCode(`?ref=${CODE}`, start);
    captureReferralCode(`?ref=${CODE}`, start + 20 * DAY);
    expect(readReferralCode(start + 40 * DAY)).toBe(CODE);
  });

  it("ignores storage written by hand", () => {
    window.localStorage.setItem("loonext:referral", "not json");
    expect(readReferralCode()).toBeNull();
    window.localStorage.setItem(
      "loonext:referral",
      JSON.stringify({ code: "<script>", savedAt: Date.now() }),
    );
    expect(readReferralCode()).toBeNull();
    // No timestamp reads as expired, not as fresh.
    window.localStorage.setItem(
      "loonext:referral",
      JSON.stringify({ code: CODE }),
    );
    expect(readReferralCode()).toBeNull();
  });
});

describe("#501 referralCodeForCreate", () => {
  it("spreads the field only when there is something to send", () => {
    expect(referralCodeForCreate()).toEqual({});
    captureReferralCode(`?ref=${CODE}`);
    expect(referralCodeForCreate()).toEqual({ referral_code: CODE });
  });

  it("is empty again once the workspace has been created", () => {
    // Otherwise the same owner's SECOND workspace carries the same
    // attribution, and one introduction gets paid for twice.
    captureReferralCode(`?ref=${CODE}`);
    clearReferralCode();
    expect(referralCodeForCreate()).toEqual({});
  });
});
