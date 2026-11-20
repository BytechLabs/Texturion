import { Home, Inbox, ListChecks, PhoneIncoming, Settings, Sparkles, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { MemberRole } from "@loonext/shared";

import type { MessageKey } from "@/i18n/translate";

/** Role names as a person would read them. */
export const ROLE_LABEL_KEYS: Partial<Record<MemberRole, MessageKey>> = {
  owner: "shell.roleOwner",
  admin: "shell.roleAdmin",
  member: "shell.roleMember",
  read_only: "shell.roleReadOnly",
  bookkeeper: "shell.roleBookkeeper",
};

export interface NavItem {
  /**
   * #228: the CATALOGUE key, not the word. A registry is a module constant and
   * cannot call a hook, so the destination carries its name as a key and each
   * surface resolves it with its own reader's `t`.
   */
  labelKey: MessageKey;
  href: string;
  icon: LucideIcon;
  /**
   * When set, the rail/tab renders the shared unread-conversation count beside
   * this item as a quiet stone tabular numeral (APP-LAYOUT-V2 §1.3 — the rail
   * counts, the list row points). Only Inbox carries it today.
   */
  countsUnread?: boolean;
}

const FOR_YOU_NAV: NavItem = {
  labelKey: "shell.navForYouTitleCase",
  href: "/for-you",
  icon: Home,
};
const INBOX_NAV: NavItem = {
  labelKey: "shell.navInbox",
  href: "/inbox",
  icon: Inbox,
  countsUnread: true,
};
const CALLS_NAV: NavItem = {
  labelKey: "shell.navCalls",
  href: "/calls",
  icon: PhoneIncoming,
};
const TASKS_NAV: NavItem = {
  labelKey: "shell.navTasks",
  href: "/tasks",
  icon: ListChecks,
};
const CONTACTS_NAV: NavItem = {
  labelKey: "shell.navContacts",
  href: "/contacts",
  icon: Users,
};

const LOU_NAV: NavItem = { labelKey: "shell.navLou", href: "/lou", icon: Sparkles };

export const PRIMARY_NAV: NavItem[] = [
  FOR_YOU_NAV,
  LOU_NAV,
  INBOX_NAV,
  CALLS_NAV,
  TASKS_NAV,
  CONTACTS_NAV,
];

export const SETTINGS_NAV: NavItem = {
  labelKey: "shell.navSettings",
  href: "/settings",
  icon: Settings,
};

export const MOBILE_NAV: NavItem[] = [
  { ...FOR_YOU_NAV, labelKey: "shell.navForYou" },
  { ...INBOX_NAV, labelKey: "shell.navConversations" },
  TASKS_NAV,
  LOU_NAV,
];

/** Active when the path is the item or nested under it. */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
