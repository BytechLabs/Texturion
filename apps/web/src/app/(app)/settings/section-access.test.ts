/**
 * #515 — "My non admin user etc can still see settings pages, like even though
 * they might not be visible in the sidebar they can just type the url for
 * billing etc."
 *
 * Five roles against every section, plus the two ways this gate can rot: a page
 * added under /settings with no section behind it, and a section id added to
 * the shared union with nobody deciding what the web does about it.
 */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MEMBER_ROLES,
  canSeeSettingsSection,
  roleHasCapability,
  settingsSectionCapability,
  type MemberRole,
  type SettingsSectionId,
} from "@loonext/shared";

import { SETTINGS_SECTIONS } from "@/components/settings/settings-nav";

import {
  WEB_SECTION_ROUTES,
  firstVisibleSettingsSection,
  settingsAccessFor,
  settingsSectionForPath,
  settingsSectionHref,
} from "./section-access";

/** The sections whose URL each role may open. Written out rather than derived,
 *  so adding a section is a decision recorded here for all five roles — a
 *  derived expectation would agree with any answer the code gave, including a
 *  wrong one. In nav order. */
const OPENS: Record<MemberRole, SettingsSectionId[]> = {
  owner: [
    "workspace",
    "team",
    "numbers",
    "hours",
    "calling",
    "templates",
    "ai",
    "usage",
    "billing",
    "notifications",
    "profile",
    "account",
    "devices",
    "history",
    "help",
    "whatsNew",
  ],
  admin: [
    "workspace",
    "team",
    "numbers",
    "hours",
    "calling",
    "templates",
    "ai",
    "usage",
    "billing",
    "notifications",
    "profile",
    "account",
    "devices",
    "history",
    "help",
    "whatsNew",
  ],
  // Theirs, and only theirs: their login, their notifications, their devices,
  // the help route and what shipped — plus, since #286, the crew list.
  //
  // `team` is the one BUSINESS section a member may open, and it is a read:
  // "a new member can identify the owner and the rest of the crew without
  // asking" is #286's fourth Acceptance line, and gating the page made it
  // unmeetable. Every control on it is still owner/admin and every mutation is
  // still refused server-side.
  member: [
    "team",
    "notifications",
    "profile",
    "account",
    "devices",
    "help",
    "whatsNew",
  ],
  // #315: not a rung below a member — a different set that happens to land in
  // the same place for settings, because both hold only the baseline.
  read_only: [
    "team",
    "notifications",
    "profile",
    "account",
    "devices",
    "help",
    "whatsNew",
  ],
  // The books, and nothing else. The role exists so an owner can hand over
  // billing WITHOUT handing over every customer conversation.
  bookkeeper: [
    "team",
    "usage",
    "billing",
    "notifications",
    "profile",
    "account",
    "devices",
    "help",
    "whatsNew",
  ],
};

function opensFor(role: MemberRole): SettingsSectionId[] {
  return SETTINGS_SECTIONS.filter(
    (section) =>
      settingsAccessFor(settingsSectionHref(section), role).kind === "allowed",
  ).map((section) => section.id);
}

describe("settingsAccessFor — every role against every section", () => {
  for (const role of MEMBER_ROLES) {
    it(`opens exactly the right sections for a ${role}`, () => {
      expect(opensFor(role)).toEqual(OPENS[role]);
    });

    it(`refuses a ${role} everything else, by URL`, () => {
      const refused = SETTINGS_SECTIONS.filter(
        (section) => !OPENS[role].includes(section.id),
      );
      for (const section of refused) {
        const access = settingsAccessFor(settingsSectionHref(section), role);
        expect(access.kind, `${role} → ${section.slug}`).toBe("denied");
      }
    });
  }

  it("answers with the same rule the nav draws with", () => {
    // The whole point: one model. If these ever disagree, a row is hidden from
    // somebody who can still open the page, or shown to somebody who cannot —
    // and #461's courtesy turns back into a lie.
    for (const role of MEMBER_ROLES) {
      for (const section of SETTINGS_SECTIONS) {
        const access = settingsAccessFor(settingsSectionHref(section), role);
        expect(access.kind === "allowed", `${role}/${section.id}`).toBe(
          canSeeSettingsSection(section.id, role),
        );
      }
    }
  });

  it("names billing, numbers and usage as the ones a member cannot open", () => {
    // The complaint said "billing etc". Named explicitly so a future capability
    // shuffle has to argue with a test rather than slip past a loop.
    for (const slug of ["billing", "numbers", "usage"]) {
      expect(settingsAccessFor(`/settings/${slug}`, "member").kind, slug).toBe(
        "denied",
      );
    }
  });

  it("#286: team is the one business section a member may open, and only read", () => {
    // It left the list above deliberately, so this says why in the place
    // somebody removing it would look. A tech who wants to know who owns the
    // workspace, or who to ask about a thread, had no screen at all — and
    // asking is exactly the cost #286 is about.
    //
    // Opening it is not managing it: `team.manage` still gates every invite,
    // role change and deactivation, on the page and at the route.
    expect(settingsAccessFor("/settings/team", "member").kind).toBe("allowed");
    expect(roleHasCapability("member", "team.manage")).toBe(false);
  });

  it("never leaves a role with nowhere to go", () => {
    // A settings shell that refuses every URL reads as a broken app, and a
    // role that cannot open its own profile is not a role. Includes a role
    // string this build has never heard of — what a client one release behind
    // the server sees.
    for (const role of [...MEMBER_ROLES, "superuser" as MemberRole]) {
      expect(opensFor(role).length, `${role} sees nothing`).toBeGreaterThan(0);
      expect(firstVisibleSettingsSection(role), role).not.toBeNull();
    }
  });

  it("lands a refused role somewhere they can actually be", () => {
    // The desktop index redirect. It used to be /settings/workspace for
    // everybody, so clicking "Settings" put a bookkeeper on a page this gate
    // now refuses — a button that leads straight to a no.
    for (const role of MEMBER_ROLES) {
      const first = firstVisibleSettingsSection(role);
      expect(first, role).not.toBeNull();
      expect(
        settingsAccessFor(settingsSectionHref(first!), role).kind,
        role,
      ).toBe("allowed");
    }
    expect(firstVisibleSettingsSection("bookkeeper")?.slug).toBe("usage");
    expect(firstVisibleSettingsSection("member")?.slug).toBe("notifications");
  });

  it("#286: does not land anybody on a section they can only read", () => {
    // Opening `team` to every role made it the SECOND section in nav order
    // that a member or a bookkeeper can see, so first-visible would have
    // redirected both of them onto the crew roster — a bookkeeper clicking
    // "Settings" to reach the books, landed on a page of people whose roles
    // they cannot change. `neverLanding` is what the two pins above rest on.
    const team = SETTINGS_SECTIONS.find((s) => s.id === "team");
    expect(team?.neverLanding, "team is still flagged").toBe(true);
    for (const role of MEMBER_ROLES) {
      expect(firstVisibleSettingsSection(role)?.id, role).not.toBe("team");
    }
    // And the flag is doing the work: without it, nav order hands `team` to
    // exactly the roles the two pins above name.
    const firstOpen = (role: MemberRole) =>
      SETTINGS_SECTIONS.find((s) => canSeeSettingsSection(s.id, role))?.id;
    expect(firstOpen("member")).toBe("team");
    expect(firstOpen("bookkeeper")).toBe("team");
  });
});

describe("path resolution", () => {
  it("leaves the index open to everybody", () => {
    // It is the section list itself, and the list is already filtered.
    for (const role of MEMBER_ROLES) {
      expect(settingsAccessFor("/settings", role).kind, role).toBe("index");
      expect(settingsAccessFor("/settings/", role).kind, role).toBe("index");
    }
  });

  it("governs a section's sub-routes by the section they sit under", () => {
    // /settings/numbers/<id> is Numbers, not an unclaimed route.
    expect(settingsSectionForPath("/settings/numbers/abc-123")?.id).toBe(
      "numbers",
    );
    expect(settingsAccessFor("/settings/numbers/abc-123", "member").kind).toBe(
      "denied",
    );
    expect(settingsAccessFor("/settings/numbers/abc-123", "admin").kind).toBe(
      "allowed",
    );
  });

  it("refuses a route no section claims — including to an owner", () => {
    // Fail closed. An unclaimed route is a page that shipped without anybody
    // deciding whose it is; refusing the owner too is what makes that
    // impossible to miss instead of quietly fine for the person who built it.
    for (const role of MEMBER_ROLES) {
      expect(settingsAccessFor("/settings/payroll", role).kind, role).toBe(
        "unknown",
      );
    }
  });

  it("keeps the slug and the shared id as separate things", () => {
    // The slug is a URL this app owns ("missed-calls" is kept for old links);
    // the id is the contract the phones share. Matching on the wrong one is
    // how a rename silently un-gates a page.
    expect(settingsSectionForPath("/settings/missed-calls")?.id).toBe("calling");
    expect(settingsSectionForPath("/settings/away-reply")?.id).toBe("hours");
    expect(settingsSectionForPath("/settings/whats-new")?.id).toBe("whatsNew");
    expect(settingsSectionForPath("/settings/calling")).toBeNull();
  });
});

describe("the gate cannot silently fall behind the app", () => {
  it("has a section behind every page under /settings", () => {
    // The failure this whole module exists to prevent, checked against the file
    // system rather than against a list somebody remembered to update. A new
    // directory here is a new URL, and a new URL with no section is #515 again.
    const here = fileURLToPath(new URL(".", import.meta.url));
    const routes = readdirSync(here, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(routes.length).toBeGreaterThan(10);
    for (const slug of routes) {
      expect(settingsSectionForPath(`/settings/${slug}`), slug).not.toBeNull();
    }
  });

  it("has a page for every section it claims to have a route for", () => {
    // The other direction: a nav row pointing at a 404.
    const here = fileURLToPath(new URL(".", import.meta.url));
    const routes = new Set(
      readdirSync(here, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    );

    for (const [id, coverage] of Object.entries(WEB_SECTION_ROUTES)) {
      const section = SETTINGS_SECTIONS.find((s) => s.id === id);
      if (coverage === "route") {
        expect(section, id).toBeDefined();
        // Sections may live outside /settings/*; only the ones that don't are
        // a claim about this directory.
        if (!section!.href) expect(routes.has(section!.slug), id).toBe(true);
      } else {
        expect(section, `${id} is marked not-on-web but has a nav row`).toBeUndefined();
      }
    }
  });

  it("classifies every shared section id", () => {
    // WEB_SECTION_ROUTES is a total Record, so a new id in the shared union
    // fails to COMPILE here until somebody classifies it. This asserts the
    // other half — that "route" and "not-on-web" are the only answers, and
    // that nothing was classified by naming an id the union doesn't have.
    for (const [id, coverage] of Object.entries(WEB_SECTION_ROUTES)) {
      expect(["route", "not-on-web"], id).toContain(coverage);
      expect(() =>
        settingsSectionCapability(id as SettingsSectionId),
      ).not.toThrow();
    }
    expect(Object.keys(WEB_SECTION_ROUTES).length).toBeGreaterThanOrEqual(
      SETTINGS_SECTIONS.length,
    );
  });

  it("sends refused people to the roles who can actually help", () => {
    // The refusal copy says "ask an owner or an admin". That is a claim about
    // the model, not a rank: changing what somebody's role reaches is
    // `team.manage`, and these are the roles that hold it. If a preset ever
    // gains it, the sentence is wrong and this fails.
    const canRerole = MEMBER_ROLES.filter((role) =>
      roleHasCapability(role, "team.manage"),
    );
    expect([...canRerole].sort()).toEqual(["admin", "owner"]);
  });
});
