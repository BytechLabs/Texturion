"use client";

import {
  BookText,
  Check,
  CheckSquare,
  ChevronsUpDown,
  Inbox as InboxIcon,
  Rows3,
  Settings as SettingsIcon,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { NotificationBell } from "@/components/notifications/notification-bell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveCompany } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

import { avatarInitials } from "./avatar-color";
import { MemberMenu } from "./member-menu";
import { isNavActive } from "./nav";
import { useNavCounts } from "./use-nav-counts";

/** Counts above this render as `9+` (the calm numeral cap, PORTAL-UX §1.1). */
function cap(n: number): string {
  return n > 9 ? "9+" : `${n}`;
}

/** The company tile's square logo initials (e.g. "Rivera Plumbing" → "RP"). */
function companyInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface NavRow {
  label: string;
  href: string;
  icon: typeof InboxIcon;
}

const FOCUS: NavRow[] = [
  { label: "For you", href: "/for-you", icon: Zap },
  { label: "Inbox", href: "/inbox", icon: InboxIcon },
  { label: "Tasks", href: "/tasks", icon: CheckSquare },
  { label: "Contacts", href: "/contacts", icon: Users },
];

const LIBRARY: NavRow[] = [
  { label: "Templates", href: "/templates", icon: Rows3 },
  { label: "Numbers", href: "/settings/numbers", icon: BookText },
];

/**
 * One nav row (PORTAL-UX §1.1): glyph + label + optional count, 36px, soft
 * radius. Active = petrol-tint fill + petrol-deep text/icon + a 3px petrol LEFT
 * edge-marker (never a heavy block, never a shadow). The count renders as a
 * muted tabular numeral EXCEPT the For-you pill, the single rationed petrol
 * accent (`petrolPill`).
 */
function NavItem({
  row,
  active,
  count,
  petrolPill,
}: {
  row: NavRow;
  active: boolean;
  count?: number;
  petrolPill?: boolean;
}) {
  const Icon = row.icon;
  const showCount = typeof count === "number" && count > 0;
  return (
    <Link
      href={row.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-9 items-center gap-[11px] rounded-[9px] px-[11px] text-[13.5px] font-medium transition-colors duration-150 ease-out",
        active
          ? "bg-app-tint font-semibold text-app-petrol-deep before:absolute before:-left-3 before:top-[7px] before:bottom-[7px] before:w-[3px] before:rounded-r-[3px] before:bg-app-petrol before:content-['']"
          : "text-app-ink-soft hover:bg-app-line-soft",
      )}
    >
      <Icon
        className={cn(
          "size-[17px] shrink-0",
          active ? "text-app-petrol-deep" : "text-app-muted",
        )}
        strokeWidth={1.8}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{row.label}</span>
      {showCount &&
        (petrolPill ? (
          <span className="grid h-[19px] min-w-5 place-items-center rounded-full bg-app-petrol px-1.5 text-[11px] font-semibold tabular-nums text-white">
            {cap(count)}
          </span>
        ) : (
          <span
            className={cn(
              "text-[11.5px] font-medium tabular-nums",
              active ? "text-app-petrol-deep" : "text-app-muted",
            )}
          >
            {cap(count)}
          </span>
        ))}
    </Link>
  );
}

/**
 * The calm LEFT SIDEBAR (PORTAL-UX §1): a 232px white column with a single
 * hairline right border and no shadow. Top → bottom:
 *   - Company tile (petrol-tint square logo initials + name + a quiet sub-line
 *     with a live dot) — opens the workspace/plan switcher.
 *   - FOCUS group: For you (the ONLY petrol pill), Inbox, Tasks, Contacts.
 *   - LIBRARY group (quieter uppercase label): Templates, Numbers.
 *   - Pinned footer: Settings, then the member tile (avatar + name + role + a
 *     notification bell) which opens the profile/team/sign-out menu.
 *
 * Retires the old top bar; this is the app's sole desktop nav. Hidden below
 * 1000px, where the bottom tab bar takes over (§5).
 */
export function Sidebar() {
  const pathname = usePathname();
  const { membership, memberships, switchCompany, displayName, role } =
    useActiveCompany();
  const counts = useNavCounts();

  const multi = memberships.length > 1;
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  const numbersActive = counts.numbers;

  const companyTile = (
    <>
      <span
        aria-hidden
        className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-app-tint text-[14px] font-semibold text-app-petrol-deep"
      >
        {companyInitials(membership.name)}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[14px] font-semibold leading-[1.15] text-app-ink">
          {membership.name}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-app-muted-2">
          <span
            aria-hidden
            className="size-1.5 rounded-full bg-app-petrol"
          />
          {numbersActive === 1
            ? "1 number active"
            : `${numbersActive} numbers active`}
        </span>
      </span>
      {multi && (
        <ChevronsUpDown
          className="size-[15px] shrink-0 text-app-muted-2"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
    </>
  );

  return (
    <aside className="hidden h-full w-[232px] shrink-0 flex-col border-r border-app-line bg-app-white px-3 pb-3.5 pt-4 lg:flex">
      {/* Company tile — opens the workspace switcher when multi-company. */}
      {multi ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Switch workspace"
            className="flex items-center gap-2.5 rounded-[10px] px-2 pb-3.5 pt-1.5 text-left outline-none transition-colors hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring"
          >
            {companyTile}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {memberships.map((m) => (
              <DropdownMenuItem
                key={m.company_id}
                onSelect={() => switchCompany(m.company_id)}
              >
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                {m.company_id === membership.company_id && (
                  <Check className="size-4 text-primary" strokeWidth={1.75} />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div
          className="flex items-center gap-2.5 px-2 pb-3.5 pt-1.5"
          aria-label={`Workspace: ${membership.name}`}
        >
          {companyTile}
        </div>
      )}

      {/* FOCUS group. */}
      <nav aria-label="Primary" className="flex flex-col gap-px">
        {FOCUS.map((row) => (
          <NavItem
            key={row.href}
            row={row}
            active={isNavActive(pathname, row.href)}
            count={
              row.href === "/for-you"
                ? counts.forYou
                : row.href === "/inbox"
                  ? counts.inbox
                  : row.href === "/tasks"
                    ? counts.tasks
                    : undefined
            }
            petrolPill={row.href === "/for-you"}
          />
        ))}

        <div className="px-3 pb-1.5 pt-3.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-app-muted-2">
          Library
        </div>
        {LIBRARY.map((row) => (
          <NavItem
            key={row.href}
            row={row}
            active={isNavActive(pathname, row.href)}
            count={row.href === "/settings/numbers" ? counts.numbers : undefined}
          />
        ))}
      </nav>

      {/* Pinned footer: Settings + the member tile. */}
      <div className="mt-auto border-t border-app-line-soft pt-2">
        <NavItem
          row={{ label: "Settings", href: "/settings", icon: SettingsIcon }}
          active={isNavActive(pathname, "/settings")}
        />
        <div className="mt-1 flex items-center gap-2.5 rounded-[9px] px-2 py-1.5">
          <MemberMenu>
            <button
              type="button"
              aria-label="Your account"
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[9px] px-1 py-1 text-left outline-none transition-colors hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-full bg-app-tint text-[11px] font-semibold text-app-petrol-deep"
              >
                {avatarInitials(displayName || membership.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-app-ink">
                  {displayName || "You"}
                </span>
                <span className="block truncate text-[11px] text-app-muted-2">
                  {roleLabel}
                </span>
              </span>
            </button>
          </MemberMenu>
          {/* The member-tile notification bell (PORTAL-UX §1.1). */}
          <NotificationBell />
        </div>
      </div>
    </aside>
  );
}
