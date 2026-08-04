/**
 * #461: "Why is member able to see all settings (sure they cant edit but they
 * can still see settings... why?)"
 *
 * Vectors shared with the Kotlin and Swift ports — three hand-maintained
 * section tables is how the clients drifted in the first place.
 */
import { describe, expect, it } from "vitest";

import { CAPABILITIES, MEMBER_ROLES } from "./capabilities";

import {
  canSeeSettingsSection,
  settingsSectionCapability,
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
  "whatsNew",
  "diagnostics",
];

/** What is a member's own, and therefore theirs to open. */
const PERSONAL: SettingsSectionId[] = [
  "profile",
  "account",
  "notifications",
  "devices",
  "help",
  // #321: everybody paying for the product is entitled to know it got
  // better, so this is personal like the five above it.
  "whatsNew",
  "diagnostics",
];

describe("canSeeSettingsSection", () => {
  it("shows a member what is theirs", () => {
    for (const section of PERSONAL) {
      expect(canSeeSettingsSection(section, "member"), section).toBe(true);
    }
  });

  it("hides the business's settings from a member", () => {
    // #286 moved `team` out of this set. It is now a READ of who is in the
    // crew — "a new member can identify the owner and the rest of the crew
    // without asking" is an Acceptance line, and gating it made that
    // unmeetable. Every control on that screen is still owner/admin, and every
    // mutation is still refused server-side.
    const businesses = ALL.filter(
      (s) => !PERSONAL.includes(s) && s !== "team",
    );
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

  it("keeps billing and numbers away from a member", () => {
    // Named explicitly because these were the ones the complaint called out:
    // a plan they cannot change and a registration they cannot file.
    expect(canSeeSettingsSection("billing", "member")).toBe(false);
    expect(canSeeSettingsSection("numbers", "member")).toBe(false);
  });

  it("#286: a member can see WHO is in the crew, and change nothing", () => {
    // The Acceptance line this answers: "a new member can identify the owner
    // and the rest of the crew without asking". A tech who wants to know who
    // owns the workspace, or who to ask about a thread, previously had no
    // screen at all — and asking is exactly the cost #286 is about.
    expect(canSeeSettingsSection("team", "member")).toBe(true);
    // The capability is the BASELINE one, not `team.manage`: seeing the list
    // and changing it are different rights, and the page reads its own
    // controls off the role.
    expect(settingsSectionCapability("team")).toBe("workspace.access");
  });

  it("treats templates as the business's words, like the away message", () => {
    // The away message, the text-back and the voicemail greeting are all on
    // settings.manage already. A template is the same class of thing: words the
    // whole crew sends in the business's name. Using them is untouched — the
    // composer's picker is not this surface.
    expect(settingsSectionCapability("templates")).toBe("settings.manage");
  });

  it("every known section names a real capability", () => {
    for (const section of ALL) {
      expect(CAPABILITIES).toContain(settingsSectionCapability(section));
    }
  });

  it("a read-only observer sees what a member sees, and no more", () => {
    // #315: the observer is not a rung below a member — they hold a different
    // SET. For the settings index the answer happens to be the same, because
    // both hold only the baseline, and the index is keyed on capabilities
    // rather than on a position.
    for (const section of ALL) {
      expect(
        canSeeSettingsSection(section, "read_only"),
        section,
      ).toBe(canSeeSettingsSection(section, "member"));
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
      // #286: the crew list is a member's to read.
      { id: "team", label: "Team" },
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

  it("shows a bookkeeper billing, and nothing else of the business", () => {
    // #315: the two rows the preset exists for. Everything else the business
    // owns stays hidden — including every conversation surface, which they
    // have no access to at all.
    const business = ALL.filter(
      (s) => settingsSectionCapability(s) !== "workspace.access",
    );
    const seen = business.filter((s) => canSeeSettingsSection(s, "bookkeeper"));
    expect(seen.sort()).toEqual(["billing", "usage"]);
  });

  it("never returns an empty list for ANY role, known or not", () => {
    // The rule the whole file exists to protect, held across every preset that
    // exists now or later — and for a role string this build has never heard
    // of, which is what a client one release behind the server sees.
    for (const role of [...MEMBER_ROLES, "superuser" as MemberRole]) {
      expect(
        visibleSettingsSections(ALL, (s) => s, role).length,
        `${role} sees nothing`,
      ).toBeGreaterThan(0);
    }
  });

  it("shows the reader's own rows to a role it does not recognize", () => {
    // Reaching a settings screen at all means the server authorized a session
    // in this workspace, so the baseline rows are theirs. Nothing the BUSINESS
    // owns is shown, because this build cannot say what an unknown role may
    // see — and the server refuses those routes regardless.
    const unknown = "superuser" as MemberRole;
    expect(canSeeSettingsSection("profile", unknown)).toBe(true);
    expect(canSeeSettingsSection("notifications", unknown)).toBe(true);
    expect(canSeeSettingsSection("billing", unknown)).toBe(false);
    expect(canSeeSettingsSection("workspace", unknown)).toBe(false);
    // #286: `team` now rides the BASELINE capability, which every recognised
    // role holds — including a role this build does not recognise, for the
    // same reason profile and notifications do. Reaching a settings screen at
    // all means the server authorized a session in this workspace.
    expect(canSeeSettingsSection("team", unknown)).toBe(true);
  });
});
