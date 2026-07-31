/**
 * #461 — "Why is member able to see all settings (sure they cant edit but they
 * can still see settings... why?)"
 *
 * No good reason. Every client listed every section for everybody, and the
 * server's role gates then refused the writes. So a tech opened Billing and
 * found a plan they cannot change, opened Numbers and found a registration
 * they cannot file, opened Team and found roles they cannot set. Nothing broke;
 * it just wasted their time and implied a permission they do not have.
 *
 * The split below is by WHOSE THING IT IS, which is the only line that stays
 * stable as the product grows:
 *
 *   personal   — your login, your notifications, your devices, your theme.
 *                Every member has these, because they are theirs.
 *   workspace  — what the business is, what it sends, what it spends.
 *                Owner/admin, because that is who answers for it.
 *
 * This is VISIBILITY, not authorization. The server's `requireRole` gates are
 * what actually protect anything and they are unchanged; hiding a nav row is a
 * courtesy, never a control. A member who types the URL still gets an honest
 * refusal from the API rather than a silent empty screen.
 *
 * Lives here so the web app and both phones cannot drift — the section lists
 * were three separate hand-maintained tables, which is how they ended up
 * agreeing on the rows and disagreeing about nothing at all.
 */

import {
  roleHasCapability,
  type Capability,
  type MemberRole,
} from "./capabilities";

export type { MemberRole };

/**
 * Canonical section ids. Each client maps its own route/enum onto these; the
 * ids are the contract, not any one client's slug.
 */
export type SettingsSectionId =
  | "workspace"
  | "team"
  | "numbers"
  | "hours"
  | "calling"
  | "templates"
  | "ai"
  | "usage"
  | "billing"
  | "history"
  | "notifications"
  | "profile"
  | "account"
  | "devices"
  | "help"
  | "diagnostics";

/**
 * The capability a section needs to be worth showing.
 *
 * #315: this was a second rank table, which stopped being expressible the
 * moment a role existed that is not on the line — a read-only observer is
 * neither above nor below a member. Keyed on capabilities instead, so the
 * settings index and the API gates answer from the same model.
 */
const SECTION_CAPABILITY: Record<SettingsSectionId, Capability> = {
  // Yours: you have these by being in the workspace at all.
  profile: "workspace.access",
  account: "workspace.access",
  notifications: "workspace.access",
  devices: "workspace.access",
  help: "workspace.access",
  diagnostics: "workspace.access",

  // The business's, each behind the axis that actually governs it.
  workspace: "settings.manage",
  hours: "settings.manage",
  calling: "settings.manage",
  ai: "settings.manage",
  // Words the whole crew sends in the business's name — same axis as the away
  // message and the voicemail greeting (#461).
  templates: "settings.manage",
  team: "team.manage",
  numbers: "numbers.manage",
  billing: "billing.manage",
  usage: "billing.manage",
  history: "history.read",
};

/** Is this settings section shown to someone holding `role`? */
export function canSeeSettingsSection(
  section: SettingsSectionId,
  role: MemberRole,
): boolean {
  return roleHasCapability(role, SECTION_CAPABILITY[section]);
}

/** The capability a section needs — exported for tests and for copy that has
 *  to name what is missing ("Only owners and admins can…"). */
export function settingsSectionCapability(
  section: SettingsSectionId,
): Capability {
  return SECTION_CAPABILITY[section];
}

/** The sections a role sees, in the caller's given order. */
export function visibleSettingsSections<T>(
  sections: readonly T[],
  idOf: (section: T) => SettingsSectionId,
  role: MemberRole,
): T[] {
  return sections.filter((section) => canSeeSettingsSection(idOf(section), role));
}
