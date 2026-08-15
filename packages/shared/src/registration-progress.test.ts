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

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/*
 * #228 — this module names keys, so the assertions resolve them through the
 * catalogue the card reads.
 */
function lookUp(table: unknown, key: string, lang: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[name];
  if (typeof value !== "string") throw new Error(`no ${lang} for ${key}`);
  return value;
}

const say = (key: string): string => lookUp(WEB_EN, key, "English");
const sayFr = (key: string): string => lookUp(WEB_FR, key, "French");

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
    // #228: `expected` is a catalogue key now, so the range is checked in the
    // words somebody reads rather than in the module's own English.
    const waiting = registrationProgress(snap("approved", "pending")).expected;
    expect(waiting).not.toBeNull();
    expect(say(waiting!)).toContain("3–7");
    // And says "sometimes longer", because it sometimes is — an estimate that
    // quietly expires is how somebody learns not to believe the next one.
    expect(say(waiting!)).toContain("sometimes longer");
    // The French keeps the hedge. A translation that promised a flat range
    // would make a firmer commitment in one language than in the other, about
    // a queue neither of them controls.
    expect(sayFr(waiting!)).toMatch(/parfois|plus long/i);
    expect(sayFr(waiting!)).toContain("3");

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

/*
 * #228 — every key this module can name, resolved.
 *
 * Written because a break-test found the gap: pointing an approved-stage title
 * at a key the catalogue has no answer for changed nothing, since the only
 * assertions that resolved anything read `expected`. A typo in a title or a
 * next-step reaches the screen as `domain.regStageApprovedTitle`, on the card
 * somebody opens precisely because they are anxious about a wait.
 */
describe("#228 every stage's words exist in both languages", () => {
  const SNAPSHOTS: Array<[string, RegistrationSnapshot | null]> = [
    ["needs_details", null],
    ["submitting", snap("approved", null)],
    ["under_review", snap("approved", "pending")],
    ["approved", snap("approved", "approved")],
    ["rejected", snap("rejected", null)],
  ];

  it("resolves title, next and expected for all five", () => {
    let resolved = 0;
    for (const [stage, snapshot] of SNAPSHOTS) {
      const progress = registrationProgress(snapshot);
      for (const key of [progress.title, progress.next, progress.expected]) {
        if (key === null) continue;
        resolved += 1;
        // Throws rather than returning a fallback, so a missing key fails here
        // instead of rendering its own name.
        expect(say(key).length, `${stage} -> ${key}`).toBeGreaterThan(0);
        expect(sayFr(key).length, `${stage} -> ${key}`).toBeGreaterThan(0);
        expect(sayFr(key), `${stage} -> ${key} is not translated`).not.toBe(say(key));
      }
    }
    // A loop that resolved nothing would agree with itself.
    expect(resolved).toBeGreaterThan(10);
  });

  it("gives every stage its own words", () => {
    // Five stages saying one sentence would satisfy every assertion above. The
    // whole point of this card is that the reader can tell which of the five
    // they are in.
    const titles = SNAPSHOTS.map(([, snapshot]) => say(registrationProgress(snapshot).title));
    expect(new Set(titles).size).toBe(SNAPSHOTS.length);
  });
});
