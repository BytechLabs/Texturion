import {
  Inbox,
  MessageSquareText,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

/** Primary navigation (G3): Inbox, Contacts, Templates. */
export const PRIMARY_NAV: NavItem[] = [
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Contacts", href: "/contacts", icon: Users },
  { label: "Templates", href: "/templates", icon: MessageSquareText },
];

export const SETTINGS_NAV: NavItem = {
  label: "Settings",
  href: "/settings",
  icon: Settings,
};

/** Mobile bottom tabs (G3): Inbox, Contacts, Settings. */
export const MOBILE_NAV: NavItem[] = [
  PRIMARY_NAV[0],
  PRIMARY_NAV[1],
  SETTINGS_NAV,
];

/** Active when the path is the item or nested under it. */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
