import {
  Home,
  Inbox,
  ListChecks,
  MoreHorizontal,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * When set, the rail/tab renders the shared unread-conversation count beside
   * this item as a quiet stone tabular numeral (APP-LAYOUT-V2 §1.3 — the rail
   * counts, the list row points). Only Inbox carries it today.
   */
  countsUnread?: boolean;
}

/**
 * Primary navigation, in the APP-LAYOUT-V2 §1.3 order:
 * For You · Inbox · Tasks · Contacts.
 *
 * /for-you (D23 focus queue) and /tasks (D25 four-view switcher) are the shipped
 * feature surfaces — HOME-AND-VIEWS.md. Every item resolves to a real page, so
 * there are zero dead links. (Templates + Numbers live in Settings — issue #8.)
 */
export const PRIMARY_NAV: NavItem[] = [
  { label: "For You", href: "/for-you", icon: Home },
  { label: "Inbox", href: "/inbox", icon: Inbox, countsUnread: true },
  { label: "Tasks", href: "/tasks", icon: ListChecks },
  { label: "Contacts", href: "/contacts", icon: Users },
];

export const SETTINGS_NAV: NavItem = {
  label: "Settings",
  href: "/settings",
  icon: Settings,
};

/**
 * Mobile bottom tabs (PORTAL-UX §5): For you · Inbox · Tasks · Contacts · More —
 * five 44px+ LABELED targets that fit a 375px bar (labels stay visible, never
 * bare icons). "More" opens Settings and the account/library sections.
 */
export const MOBILE_NAV: NavItem[] = [
  PRIMARY_NAV[0], // For You
  PRIMARY_NAV[1], // Inbox
  PRIMARY_NAV[2], // Tasks
  PRIMARY_NAV[3], // Contacts
  { label: "More", href: "/settings", icon: MoreHorizontal },
];

/** Active when the path is the item or nested under it. */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
