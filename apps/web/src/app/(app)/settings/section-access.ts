/**
 * #515 — "My non admin user etc can still see settings pages, like even though
 * they might not be visible in the sidebar they can just type the url."
 *
 * #461 hid the nav rows a role has no use for and said so out loud: hiding a
 * row is a COURTESY, the server's gates are the control. That reasoning holds
 * for the writes — every one of them is refused — and does not hold for the
 * reads. /settings/team renders the whole roster off a `workspace.access`
 * route; /settings/usage renders the projected overage off another. So the
 * courtesy was the only thing standing between a member and the page, and a
 * courtesy is not a door.
 *
 * This module answers ONE question — may this person open this URL — from the
 * same shared model the nav filters with. Not a second rule: `canSeeSettingsSection`
 * decides, exactly as it does for the rows, so the two can never disagree about
 * a section the way three hand-maintained tables once disagreed about the list.
 *
 * Pure, and separate from the gate component, so the five roles can be driven
 * across every section in a test without rendering anything.
 */

import {
  canSeeSettingsSection,
  type MemberRole,
  type SettingsSectionId,
} from "@loonext/shared";

import {
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "@/components/settings/settings-nav";

/**
 * Every canonical section id, and whether THIS app has a route for it.
 *
 * A total Record on purpose. The ids are a shared union across three clients,
 * so the union grows in the shared package and the web app finds out later —
 * which is precisely how a new page ships without anybody deciding who may open
 * it. Written this way, a new id fails to compile here until somebody
 * classifies it, and the test below turns "route" into a claim about the file
 * system rather than a comment.
 */
export const WEB_SECTION_ROUTES: Record<
  SettingsSectionId,
  "route" | "not-on-web"
> = {
  workspace: "route",
  team: "route",
  numbers: "route",
  hours: "route",
  calling: "route",
  templates: "route",
  ai: "route",
  usage: "route",
  billing: "route",
  history: "route",
  notifications: "route",
  profile: "route",
  account: "route",
  devices: "route",
  help: "route",
  whatsNew: "route",
  // A phone-only screen: what this build is, what it last synced, what it can
  // reach. The browser answers all three itself (the URL bar, devtools, the
  // network tab), so the web has never had a page for it.
  diagnostics: "not-on-web",
};

/** Where a section's route lives. Sections may override the default slug path. */
export function settingsSectionHref(section: SettingsSection): string {
  return section.href ?? `/settings/${section.slug}`;
}

/** `/settings` itself — the section list, which is whatever the role can see. */
function isIndexPath(pathname: string): boolean {
  return pathname === "/settings" || pathname === "/settings/";
}

/**
 * The section a settings URL belongs to, or null when nothing claims it.
 *
 * Matches on the first path segment so a section's own sub-routes
 * (/settings/numbers/<id>) are governed by the section they sit under rather
 * than falling through as unrecognized.
 */
export function settingsSectionForPath(
  pathname: string,
): SettingsSection | null {
  const rest = pathname.replace(/^\/settings\/?/, "");
  const slug = rest.split("/")[0];
  if (!slug) return null;
  return SETTINGS_SECTIONS.find((section) => section.slug === slug) ?? null;
}

export type SettingsAccess =
  /** The section list. Every role has rows on it (#461), so it is always open. */
  | { kind: "index" }
  | { kind: "allowed"; section: SettingsSection }
  | { kind: "denied"; section: SettingsSection }
  /**
   * A route under /settings that no section claims. Treated as denied, for
   * everybody including the owner: an unclaimed route is a page that shipped
   * without anybody deciding whose it is, and the failure mode of guessing
   * "probably fine" is #515 again. Loud in development, closed in production.
   */
  | { kind: "unknown" };

/** May this person open this settings URL? */
export function settingsAccessFor(
  pathname: string,
  role: MemberRole,
): SettingsAccess {
  if (isIndexPath(pathname)) return { kind: "index" };
  const section = settingsSectionForPath(pathname);
  if (!section) return { kind: "unknown" };
  return canSeeSettingsSection(section.id, role)
    ? { kind: "allowed", section }
    : { kind: "denied", section };
}

/**
 * The first section this role can open — where the desktop index lands them.
 *
 * Was a hardcoded /settings/workspace, which meant a member, a read-only
 * observer or a bookkeeper who simply CLICKED "Settings" in the sidebar was
 * thrown at a section their own nav hides. No URL typing required: it was the
 * default behaviour of the button.
 */
export function firstVisibleSettingsSection(
  role: MemberRole,
): SettingsSection | null {
  return (
    SETTINGS_SECTIONS.find(
      (section) =>
        !section.neverLanding && canSeeSettingsSection(section.id, role),
    ) ?? null
  );
}
