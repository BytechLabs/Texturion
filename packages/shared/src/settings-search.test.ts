import { describe, expect, it } from "vitest";

import { SETTINGS_INDEX, searchSettings } from "./settings-search";
import { canSeeSettingsSection, type SettingsSectionId } from "./settings-visibility";

const everything = (_section: SettingsSectionId) => true;
const asRole = (role: "owner" | "admin" | "member") => (section: SettingsSectionId) =>
  canSeeSettingsSection(section, role);
const anchorsOf = (query: string, locale: "en" | "fr" = "en", canSee = everything) =>
  searchSettings(query, locale, canSee).map((r) => r.entry.anchor);

describe("#719 settings search", () => {
  it("SS-1: anchors are unique and every entry has a label", () => {
    const anchors = SETTINGS_INDEX.map((e) => e.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(new Set(SETTINGS_INDEX.map((e) => e.id)).size).toBe(SETTINGS_INDEX.length);
    for (const item of SETTINGS_INDEX) {
      expect(item.en[0], item.id).toBeTruthy();
      expect(item.fr[0], item.id).toBeTruthy();
    }
  });

  it("SS-2: 'time zone' finds every place a time zone is set or shown", () => {
    const found = anchorsOf("time zone");
    expect(found).toEqual(
      expect.arrayContaining([
        "time-zone", // workspace
        "business-hours", // hours and away reply
        "numbers-list", // per-number hours
        "closed-dates",
        "calendar-sync",
        "quiet-hours-row",
      ]),
    );
    // The workspace's own setting, named by its label, comes first.
    expect(found[0]).toBe("time-zone");
  });

  it("SS-3: the words people actually type find the time zone and the hours", () => {
    for (const word of ["time", "timezone", "tz"]) {
      expect(anchorsOf(word), word).toContain("time-zone");
    }
    expect(anchorsOf("hours")).toContain("business-hours");
    for (const word of ["quiet", "hours"]) {
      expect(anchorsOf(word), word).toContain("quiet-hours-row");
      expect(anchorsOf(word), word).toContain("time-zone");
    }
  });

  it("SS-4: logo and brand find branding", () => {
    expect(anchorsOf("logo")).toContain("workspace-name");
    expect(anchorsOf("brand")).toContain("workspace-name");
  });

  it("SS-5: French works, with or without accents and case", () => {
    expect(anchorsOf("fuseau", "fr")).toContain("time-zone");
    expect(anchorsOf("FUSEAU HORAIRE", "fr")).toContain("time-zone");
    expect(anchorsOf("etiquettes", "fr")).toContain("tags");
    expect(anchorsOf("Étiquettes", "fr")).toContain("tags");
    expect(anchorsOf("messagerie", "fr")).toContain("voicemail");
    // French words do not match in English, and the reverse.
    expect(anchorsOf("fuseau", "en")).not.toContain("time-zone");
  });

  it("SS-6: one typo is forgiven in a word of four letters or more, not before", () => {
    expect(anchorsOf("voicmail")).toContain("voicemail"); // dropped letter
    expect(anchorsOf("notifcations")).toContain("notification-types");
    expect(anchorsOf("tiem")).toContain("time-zone"); // swapped letters
    expect(anchorsOf("tmz")).not.toContain("time-zone"); // three letters: no guessing
    expect(anchorsOf("xyzzy")).toEqual([]);
  });

  it("SS-7: a label match ranks above a synonym match", () => {
    const results = searchSettings("voicemail", "en", everything);
    const firstSynonym = results.findIndex((r) => r.rank === 1);
    const lastLabel = results.map((r) => r.rank).lastIndexOf(0);
    expect(results[0]?.rank).toBe(0);
    if (firstSynonym !== -1) expect(lastLabel).toBeLessThan(firstSynonym);
  });

  it("SS-8: an empty or blank query matches nothing", () => {
    expect(searchSettings("", "en", everything)).toEqual([]);
    expect(searchSettings("   ", "en", everything)).toEqual([]);
  });

  it("SS-9: a member never sees an owner-only setting", () => {
    const member = asRole("member");
    for (const query of ["billing", "plan", "webhooks", "time zone", "numbers", "invoice", "api", "stripe", "caller id"]) {
      for (const result of searchSettings(query, "en", member)) {
        expect(canSeeSettingsSection(result.entry.section, "member"), `${query}: ${result.entry.id}`).toBe(true);
      }
    }
    expect(anchorsOf("billing", "en", member)).not.toContain("subscription");
    expect(anchorsOf("webhook", "en", member)).toEqual([]);
    expect(anchorsOf("time zone", "en", member)).not.toContain("time-zone");
    // Their own settings are still found.
    expect(anchorsOf("password", "en", member)).toContain("change-password");
    expect(anchorsOf("time zone", "en", member)).toContain("quiet-hours-row");
    // An owner finds the same words.
    expect(anchorsOf("billing", "en", asRole("owner"))).toContain("subscription");
  });
});
