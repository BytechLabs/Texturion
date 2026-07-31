/**
 * #461: "Why is member able to see all settings (sure they cant edit but they
 * can still see settings... why?)"
 *
 * Vectors shared with the Kotlin and Swift ports — three hand-maintained
 * section tables is how the clients drifted in the first place.
 */
import { describe, expect, it } from "vitest";

import {
  canSeeSettingsSection,
  settingsSectionMinimumRole,
  visibleSettingsSections,
  type MemberRole,
  type SettingsSectionId,
} from "./settings-visibility";

/** Every id the rule knows. A new section must be added here deliberately. */
const ALL: SettingsSectionId[] = [
  "workspace",
  "team",
  "numbers",
  "hours",
  "calling",
  "templates",
  "ai",
  "usage",
  "billing",
  "history",
  "notifications",
  "profile",
  "account",
  "devices",
  "help",
  "diagnostics",
];

/** What is a member's own, and therefore theirs to open. */
const PERSONAL: SettingsSectionId[] = [
  "profile",
  "account",
  "notifications",
  "devices",
  "help",
  "diagnostics",
];

describe("canSeeSettingsSection", () => {
  it("shows a member what is theirs", () => {
    for (const section of PERSONAL) {
      expect(canSeeSettingsSection(section, "member"), section).toBe(true);
    }
  });

  it("hides the business's settings from a member", () => {
    const businesses = ALL.filter((s) => !PERSONAL.includes(s));
    for (const section of businesses) {
      expect(canSeeSettingsSection(section, "member"), section).toBe(false);
    }
    // Guard the guard: if PERSONAL ever swallowed the list, the loop above
    // would assert nothing.
    expect(businesses.length).toBeGreaterThan(5);
  });

  it("shows an owner and an admin everything", () => {
    for (const role of ["owner", "admin"] as MemberRole[]) {
      for (const section of ALL) {
        expect(canSeeSettingsSection(section, role), `${role}/${section}`).toBe(
          true,
        );
      }
    }
  });

  it("keeps billing, team and numbers away from a member", () => {
    // Named explicitly because these are the three the complaint called out:
    // a plan they cannot change, roles they cannot set, a registration they
    // cannot file.
    expect(canSeeSettingsSection("billing", "member")).toBe(false);
    expect(canSeeSettingsSection("team", "member")).toBe(false);
    expect(canSeeSettingsSection("numbers", "member")).toBe(false);
  });

  it("treats templates as the business's words, like the away message", () => {
    // The away message, the text-back and the voicemail greeting are all
    // admin-gated already. A template is the same class of thing: words the
    // whole crew sends in the business's name. Using them is untouched — the
    // composer's picker is not this surface.
    expect(settingsSectionMinimumRole("templates")).toBe("admin");
  });

  it("every known section has a rule", () => {
    for (const section of ALL) {
      expect(["owner", "admin", "member"]).toContain(
        settingsSectionMinimumRole(section),
      );
    }
  });
});

describe("visibleSettingsSections", () => {
  it("filters in the caller's order and keeps the objects intact", () => {
    const rows = [
      { id: "billing" as SettingsSectionId, label: "Billing" },
      { id: "profile" as SettingsSectionId, label: "Profile" },
      { id: "team" as SettingsSectionId, label: "Team" },
      { id: "help" as SettingsSectionId, label: "Help" },
    ];
    expect(visibleSettingsSections(rows, (r) => r.id, "member")).toEqual([
      { id: "profile", label: "Profile" },
      { id: "help", label: "Help" },
    ]);
    expect(visibleSettingsSections(rows, (r) => r.id, "admin")).toHaveLength(4);
  });

  it("never returns an empty list for a member", () => {
    // A settings screen with nothing in it reads as broken. A member always
    // has their own profile, notifications and devices.
    const visible = visibleSettingsSections(ALL, (s) => s, "member");
    expect(visible.length).toBeGreaterThanOrEqual(4);
  });
});
