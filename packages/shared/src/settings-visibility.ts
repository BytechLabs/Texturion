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
  // #224: taking money FROM a customer, which is a different subject from the
  // billing section next door — that one is what we charge the business, this
  // is what the business charges the homeowner. Kept apart deliberately: one
  // screen holding both would put "your plan renews" beside "your bank account"
  // and make neither legible.
  | "payments"
  | "history"
  | "notifications"
  | "profile"
  | "account"
  | "devices"
  | "help"
  // #321: what shipped, in the product. Beside Help because it is the other
  // thing you go looking for rather than pass through.
  | "whatsNew"
  // #243: where this workspace's own systems get told what happened. Its own
  // section rather than a card inside Workspace, because it is the only place
  // in the product that sends message content OUT of it, and a thing with that
  // consequence should not be found by scrolling past business hours.
  | "webhooks"
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
  // Everybody paying for the product is entitled to know it got better.
  whatsNew: "workspace.access",
  diagnostics: "workspace.access",

  // The business's, each behind the axis that actually governs it.
  workspace: "settings.manage",
  hours: "settings.manage",
  calling: "settings.manage",
  ai: "settings.manage",
  // Words the whole crew sends in the business's name — same axis as the away
  // message and the voicemail greeting (#461).
  templates: "settings.manage",
  // #243: `settings.manage` on the READ as well, and it is the strictest thing
  // in this table for a reason — the endpoint list names the third parties this
  // workspace's messages flow to, and those URLs routinely carry a per-tenant
  // token in the path. The API refuses the read at the same capability, so the
  // nav row and the route agree with the server rather than merely with each
  // other.
  webhooks: "settings.manage",
  /**
   * #286: EVERY role, not just the ones who can change it.
   *
   * "A new member can identify the owner and the rest of the crew without
   * asking" is an Acceptance line, and gating this section behind
   * `team.manage` made it unmeetable: a tech who wants to know who owns the
   * workspace, or who to ask about a thread, had no screen at all.
   *
   * The section is READ-ONLY for anybody without `team.manage` — the page
   * already threads a `canManage` flag through every control, and every
   * mutation is gated server-side regardless. What the list carries is names,
   * roles and join dates; no email, no phone, nothing a crew member could not
   * learn by asking the person next to them.
   */
  team: "workspace.access",
  numbers: "numbers.manage",
  billing: "billing.manage",
  usage: "billing.manage",
  /**
   * #224: `billing.manage`, and not `workspace.own` — even though CONNECTING
   * the account is owner-only on the server.
   *
   * The two answer different questions. Setting it up binds a legal entity and
   * a bank account, which is the owner's alone. Opening the screen is how the
   * bookkeeper reaches the Stripe dashboard to issue a refund, which is the
   * whole reason that role exists (#315). Hiding the section from them would
   * send them back to sharing the owner's login for the one task the role was
   * created to make unnecessary.
   */
  payments: "billing.manage",
  history: "history.read",
};

/**
 * Is this settings section shown to someone holding `role`?
 *
 * A section that needs only `workspace.access` is shown to ANY role, including
 * one this build has never heard of. That is not a hole: reaching this screen
 * means the server already authorized a session in this workspace, and these
 * rows are the reader's own — their login, their notifications, their devices.
 * The alternative is an empty settings index, which reads as a broken app
 * (#461). Every row that belongs to the BUSINESS still asks the table, so an
 * unrecognized role sees nothing of the business.
 *
 * `roleHasCapability` itself stays fail-closed — this is visibility, and the
 * server's gates are the control.
 */
export function canSeeSettingsSection(
  section: SettingsSectionId,
  role: MemberRole,
): boolean {
  const needs = SECTION_CAPABILITY[section];
  return needs === "workspace.access" || roleHasCapability(role, needs);
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
