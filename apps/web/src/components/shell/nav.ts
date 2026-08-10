import {
  Home,
  Inbox,
  ListChecks,
  PhoneIncoming,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { MessageKey } from "@/i18n/provider";

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
/** #129 Calls — the call log. Desktop + palette surface; on mobile it lives
 *  in the account sheet because the tab bar is locked at four links + the
 *  avatar (#100), and every call also reaches the inbox as a timeline line. */
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

/**
 * Primary navigation, in the APP-LAYOUT-V2 §1.3 order, extended by #129:
 * For You · Inbox · Calls · Tasks · Contacts.
 *
 * /for-you (D23 focus queue) and /tasks (D25 four-view switcher) are the shipped
 * feature surfaces — HOME-AND-VIEWS.md. Every item resolves to a real page, so
 * there are zero dead links. (Templates + Numbers live in Settings — issue #8.)
 */
export const PRIMARY_NAV: NavItem[] = [
  FOR_YOU_NAV,
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

/**
 * Mobile bottom tabs (PORTAL-UX §5, #100): For you · Inbox · Tasks · Contacts —
 * four 44px+ LABELED link targets that fit a 375px bar (labels stay visible,
 * never bare icons). The fifth cell is the ACCOUNT AVATAR (rendered by the tab
 * bar itself, not a link): it opens the account sheet carrying the workspace
 * info, number(s), notifications, theme, Calls (#129), Settings, and Sign out —
 * the "More" link is gone (#100). Calls deliberately does NOT take a fifth
 * tab: the bar's shape is a shipped decision, and misses reach the crew
 * through the inbox timeline + For You regardless.
 */
export const MOBILE_NAV: NavItem[] = [
  FOR_YOU_NAV,
  INBOX_NAV,
  TASKS_NAV,
  CONTACTS_NAV,
];

/** Active when the path is the item or nested under it. */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
