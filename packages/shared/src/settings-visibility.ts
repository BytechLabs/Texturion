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

import type { MemberRole } from "./capabilities";

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

const ROLE_RANK: Record<MemberRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

/**
 * The minimum role a section is shown to.
 *
 * `member` means "this is yours". Everything else is the business's, and the
 * people who answer for the business are owner and admin.
 */
const MINIMUM_ROLE: Record<SettingsSectionId, MemberRole> = {
  // Yours.
  profile: "member",
  account: "member",
  notifications: "member",
  devices: "member",
  help: "member",
  diagnostics: "member",

  // The business's: what it is, what it sends, what it spends.
  workspace: "admin",
  team: "admin",
  numbers: "admin",
  hours: "admin",
  calling: "admin",
  ai: "admin",
  usage: "admin",
  billing: "admin",
  // #231's log answers "who changed what, months later". That is a question
  // the people accountable for the workspace ask, and it names other people's
  // actions — so it is not a member's to browse.
  history: "admin",
  // Templates are the words the whole crew sends in the business's name, which
  // is the same class of thing as the away message and the voicemail greeting —
  // both already admin. A member USES them constantly (the composer's "/"
  // picker is untouched); curating the shared set is the business's call.
  templates: "admin",
};

/** Is this settings section shown to someone holding `role`? */
export function canSeeSettingsSection(
  section: SettingsSectionId,
  role: MemberRole,
): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[MINIMUM_ROLE[section]];
}

/** The minimum role for a section — exported for tests and for copy that has
 *  to name the role ("Only owners and admins can…"). */
export function settingsSectionMinimumRole(
  section: SettingsSectionId,
): MemberRole {
  return MINIMUM_ROLE[section];
}

/** The sections a role sees, in the caller's given order. */
export function visibleSettingsSections<T>(
  sections: readonly T[],
  idOf: (section: T) => SettingsSectionId,
  role: MemberRole,
): T[] {
  return sections.filter((section) => canSeeSettingsSection(idOf(section), role));
}
