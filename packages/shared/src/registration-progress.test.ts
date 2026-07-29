/**
 * #310 — the registration progress derivation three clients share.
 *
 * `RegistrationProgressTest.kt` and `RegistrationProgressTests.swift` assert
 * this same table. A drift means "under review" on the phone and "submitted"
 * on the laptop, which is worse than either alone — it teaches the customer to
 * distrust both at exactly the moment they are already wondering whether the
 * wait is broken.
 */
import { describe, expect, it } from "vitest";

import {
  isWaitingOnRegistration,
  registrationProgress,
  registrationStage,
  type RegistrationSnapshot,
} from "./registration-progress";

const snap = (
  brand: string | null,
  campaign: string | null,
): RegistrationSnapshot => ({
  brand: brand ? { status: brand } : null,
  campaign: campaign ? { status: campaign } : null,
});

describe("registrationStage", () => {
  it("needs details when nothing has been submitted", () => {
    expect(registrationStage(null)).toBe("needs_details");
    expect(registrationStage(snap(null, null))).toBe("needs_details");
  });

  it("follows the campaign, because the campaign is what unlocks texting", () => {
    // A brand approved with the campaign still under review is NOT further
    // along than the campaign says.
    expect(registrationStage(snap("approved", "pending"))).toBe("under_review");
    expect(registrationStage(snap("approved", "approved"))).toBe("approved");
  });

  it("treats an approved brand with no campaign yet as still on its way", () => {
    expect(registrationStage(snap("approved", null))).toBe("submitting");
  });

  it("makes a rejection the headline wherever it happens", () => {
    // The only state that needs them. Burying it under a cheerful campaign
    // status would be a lie of emphasis.
    expect(registrationStage(snap("rejected", "pending"))).toBe("rejected");
    expect(registrationStage(snap("approved", "rejected"))).toBe("rejected");
  });
});

describe("registrationProgress", () => {
  it("is never 0% once anything has been sent", () => {
    // A bar sitting at 0% for four days IS the spinner this replaces.
    for (const s of [
      snap(null, null),
      snap("submitted", null),
      snap("approved", "pending"),
    ]) {
      expect(registrationProgress(s).percent).toBeGreaterThan(0);
    }
  });

  it("only asks for action when something is actually required of them", () => {
    expect(registrationProgress(snap(null, null)).actionNeeded).toBe(true);
    expect(registrationProgress(snap("rejected", null)).actionNeeded).toBe(true);
    // Waiting is not a task. Marking it as one would put a permanent red dot
    // on a screen the person can do nothing about.
    expect(registrationProgress(snap("submitted", null)).actionNeeded).toBe(false);
    expect(registrationProgress(snap("approved", "pending")).actionNeeded).toBe(false);
  });

  it("quotes a range only while there is a wait to describe", () => {
    expect(registrationProgress(snap("approved", "pending")).expected).toContain("3–7");
    // And says "sometimes longer", because it sometimes is — an estimate that
    // quietly expires is how somebody learns not to believe the next one.
    expect(registrationProgress(snap("approved", "pending")).expected).toContain(
      "sometimes longer",
    );
    expect(registrationProgress(snap("approved", "approved")).expected).toBeNull();
    expect(registrationProgress(snap("rejected", null)).expected).toBeNull();
  });

  it("speaks the customer's language, not the state machine's", () => {
    const progress = registrationProgress(snap("approved", "pending"));
    // "brand approved / campaign pending" is true and means nothing to a
    // plumber.
    expect(progress.title.toLowerCase()).not.toContain("campaign");
    expect(progress.title.toLowerCase()).not.toContain("brand");
    expect(progress.title.toLowerCase()).not.toContain("10dlc");
  });

  it("always says what happens next", () => {
    for (const s of [
      snap(null, null),
      snap("submitted", null),
      snap("approved", "pending"),
      snap("approved", "approved"),
      snap("rejected", null),
    ]) {
      expect(registrationProgress(s).next.length).toBeGreaterThan(10);
    }
  });
});

describe("isWaitingOnRegistration", () => {
  it("is true only while the wait is genuinely on the carriers", () => {
    expect(isWaitingOnRegistration(snap("submitted", null))).toBe(true);
    expect(isWaitingOnRegistration(snap("approved", "pending"))).toBe(true);
  });

  it("is false when the workspace itself is the blocker", () => {
    // Telling somebody to go set up templates while WE are waiting on THEM
    // points away from the thing actually blocking them.
    expect(isWaitingOnRegistration(snap(null, null))).toBe(false);
    expect(isWaitingOnRegistration(snap("rejected", null))).toBe(false);
  });

  it("is false once it is live", () => {
    expect(isWaitingOnRegistration(snap("approved", "approved"))).toBe(false);
  });
});
