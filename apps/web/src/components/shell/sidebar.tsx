"use client";

import {
  Check,
  CheckSquare,
  ChevronsUpDown,
  Copy,
  Inbox as InboxIcon,
  PanelLeft,
  Search,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { NotificationBell } from "@/components/notifications/notification-bell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useActiveCompany } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

import { useNumbers } from "@/lib/api/numbers";
import { formatPhone } from "@/lib/format/phone";

import { avatarInitials } from "./avatar-color";
import { MemberMenu } from "./member-menu";
import { isNavActive } from "./nav";
import { useNavCounts } from "./use-nav-counts";

/**
 * One active business number + a copy button, in the sidebar's number strip.
 * The number itself is the useful thing (not "1 number active"); copy writes
 * the raw E.164 and flips to a check for a beat. Kept OUTSIDE the workspace
 * switcher trigger so it never nests a button inside a button.
 */
function SidebarNumberRow({ e164 }: { e164: string }) {
  const [copied, setCopied] = useState(false);
  const label = formatPhone(e164);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(e164);
      setCopied(true);
      toast.success("Number copied.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access.");
    }
  };
  return (
    <div className="flex items-center gap-1.5 text-[12px]">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-app-petrol" />
      <span className="min-w-0 flex-1 truncate tabular-nums text-app-ink">
        {label}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${label}`}
        className="grid size-6 shrink-0 place-items-center rounded-[6px] text-app-muted-2 outline-none transition-colors duration-150 ease-out hover:bg-app-line-soft hover:text-app-ink focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? (
          <Check className="size-3.5" strokeWidth={2} aria-hidden />
        ) : (
          <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
        )}
      </button>
    </div>
  );
}

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

/** Opens the ⌘K command palette — the app's search + navigator. */
function openCommand() {
  window.dispatchEvent(new Event("loonext:open-command"));
}

interface NavRow {
  label: string;
  href: string;
  icon: typeof InboxIcon;
}

// The sidebar is the SOLE primary nav (issue #8). Templates and Numbers live in
// Settings only; compose is the app-wide FAB; search + notifications + account
// live in the footer user-bar. So the nav list is just the four focus surfaces.
const FOCUS: NavRow[] = [
  { label: "For you", href: "/for-you", icon: Zap },
  { label: "Inbox", href: "/inbox", icon: InboxIcon },
  { label: "Tasks", href: "/tasks", icon: CheckSquare },
  { label: "Contacts", href: "/contacts", icon: Users },
];

/**
 * One nav row (PORTAL-UX §1.1): glyph + label + optional count, 36px, soft
 * radius. Active = petrol-tint fill + petrol-deep text/icon + a 3px petrol LEFT
 * edge-marker (never a heavy block, never a shadow). The count renders as a
 * muted tabular numeral EXCEPT the For-you pill, the single rationed petrol
 * accent (`petrolPill`).
 *
 * Collapsed (icon rail): icon-only, the label moves to a hover/focus tooltip
 * (+ an aria-label), and the count degrades to a small dot badge (petrol for
 * For-you, muted otherwise) so the at-a-glance signal survives.
 */
function NavItem({
  row,
  active,
  count,
  petrolPill,
  collapsed,
}: {
  row: NavRow;
  active: boolean;
  count?: number;
  petrolPill?: boolean;
  collapsed?: boolean;
}) {
  const Icon = row.icon;
  const showCount = typeof count === "number" && count > 0;

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={row.href}
            aria-current={active ? "page" : undefined}
            aria-label={showCount ? `${row.label}, ${cap(count!)}` : row.label}
            className={cn(
              "relative flex h-9 items-center justify-center rounded-[9px] transition-colors duration-150 ease-out",
              active
                ? "bg-app-tint text-app-petrol-deep before:absolute before:-left-2 before:top-[7px] before:bottom-[7px] before:w-[3px] before:rounded-r-[3px] before:bg-app-petrol before:content-['']"
                : "text-app-ink-soft hover:bg-app-line-soft",
            )}
          >
            <Icon
              className={cn(
                "size-[18px] shrink-0",
                active ? "text-app-petrol-deep" : "text-app-muted",
              )}
              strokeWidth={1.8}
              aria-hidden
            />
            {showCount && (
              <span
                aria-hidden
                className={cn(
                  "absolute right-1.5 top-1.5 size-2 rounded-full ring-2 ring-app-white",
                  petrolPill ? "bg-app-petrol" : "bg-app-muted-2",
                )}
              />
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          {row.label}
          {showCount ? ` · ${cap(count!)}` : ""}
        </TooltipContent>
      </Tooltip>
    );
  }

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
 * The calm LEFT SIDEBAR (PORTAL-UX §1) — the app's SOLE shell after the top bar
 * was retired (issue #8). Full-height white column, single hairline right
 * border, no shadow. Top → bottom:
 *   - Brand cell (workspace switcher).
 *   - Search row (opens the ⌘K palette).
 *   - FOCUS nav: For you · Inbox · Tasks · Contacts.
 *   - Footer "user bar" (Discord-style): a collapse toggle + notifications bell,
 *     then the account tile that opens the member menu (Settings lives there —
 *     one entry, not two). Templates + Numbers live in Settings; compose is the
 *     app-wide FAB.
 *
 * Expanded (232px, labeled) ⇄ collapsed (64px icon rail) via the footer toggle;
 * the choice is persisted. Hidden below lg, where the labeled bottom tab bar
 * owns nav (§5).
 */
export function Sidebar({
  collapsed = false,
  onToggleSidebar,
}: {
  collapsed?: boolean;
  onToggleSidebar: () => void;
}) {
  const pathname = usePathname();
  const { membership, memberships, switchCompany, displayName, role } =
    useActiveCompany();
  const counts = useNavCounts();
  const numbers = useNumbers();

  const multi = memberships.length > 1;
  // The company's live business numbers — active + actually provisioned. Drives
  // the copyable number strip under the workspace tile.
  const activeNumbers = (numbers.data?.data ?? []).filter(
    (n): n is typeof n & { number_e164: string } =>
      n.status === "active" && Boolean(n.number_e164),
  );
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

  const logo = (
    <span
      aria-hidden
      className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-app-tint text-[14px] font-semibold text-app-petrol-deep"
    >
      {companyInitials(membership.name)}
    </span>
  );

  const companyTileExpanded = (
    <>
      {logo}
      <span className="min-w-0 flex-1 truncate text-left text-[14px] font-semibold leading-[1.15] text-app-ink">
        {membership.name}
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

  // The copyable number strip (expanded only) — sits BELOW the brand cell,
  // outside the switcher trigger so its copy buttons never nest in a button.
  const numbersStrip = !collapsed && (
    <div className="shrink-0 border-b border-app-line px-3 py-2">
      {activeNumbers.length > 0 ? (
        <div className="space-y-1">
          {activeNumbers.map((n) => (
            <SidebarNumberRow key={n.id} e164={n.number_e164} />
          ))}
        </div>
      ) : (
        <span className="flex items-center gap-1.5 text-[11.5px] text-app-muted-2">
          <span aria-hidden className="size-1.5 rounded-full bg-app-muted-2" />
          Setting up your number…
        </span>
      )}
    </div>
  );

  const workspaceMenu = (
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
  );

  const collapseToggle = (
    <button
      type="button"
      onClick={onToggleSidebar}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-pressed={collapsed}
      className="grid size-8 shrink-0 place-items-center rounded-[8px] text-app-muted outline-none transition-colors duration-150 ease-out hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring"
    >
      <PanelLeft className="size-[17px]" strokeWidth={1.8} aria-hidden />
    </button>
  );

  const memberTile = (
    <MemberMenu>
      <button
        type="button"
        aria-label="Account and settings"
        className={cn(
          "flex items-center rounded-[9px] outline-none transition-colors duration-150 ease-out hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring",
          collapsed ? "size-10 justify-center" : "w-full gap-2.5 px-1.5 py-1 text-left",
        )}
      >
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-full bg-app-tint text-[11px] font-semibold text-app-petrol-deep"
        >
          {avatarInitials(displayName || membership.name)}
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold text-app-ink">
              {displayName || "You"}
            </span>
            <span className="block truncate text-[11px] text-app-muted-2">
              {roleLabel}
            </span>
          </span>
        )}
      </button>
    </MemberMenu>
  );

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "hidden h-full shrink-0 flex-col border-r border-app-line bg-app-white lg:flex",
          collapsed ? "w-[64px]" : "w-[232px]",
        )}
      >
        {/* Brand cell — 56px + bottom hairline. */}
        <div
          className={cn(
            "flex h-14 shrink-0 items-center border-b border-app-line",
            collapsed ? "justify-center px-2" : "px-3",
          )}
        >
          {multi ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Switch workspace"
                className={cn(
                  "flex items-center rounded-[10px] outline-none transition-colors duration-150 ease-out hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring",
                  collapsed
                    ? "size-10 justify-center"
                    : "w-full gap-2.5 px-2 py-1 text-left",
                )}
              >
                {collapsed ? logo : companyTileExpanded}
              </DropdownMenuTrigger>
              {workspaceMenu}
            </DropdownMenu>
          ) : (
            <div
              className={cn(
                "flex items-center",
                collapsed ? "" : "gap-2.5 px-2",
              )}
              aria-label={`Workspace: ${membership.name}`}
            >
              {collapsed ? logo : companyTileExpanded}
            </div>
          )}
        </div>

        {numbersStrip}

        {/* Nav area: search + focus nav. */}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-y-auto pb-2 pt-3",
            collapsed ? "px-2" : "px-3",
          )}
        >
          {/* Search — opens the ⌘K palette (issue #8: search moved to sidebar). */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={openCommand}
                  aria-label="Search"
                  aria-keyshortcuts="Meta+K Control+K"
                  className="mb-1 flex h-9 items-center justify-center rounded-[9px] text-app-muted outline-none transition-colors duration-150 ease-out hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Search className="size-[18px]" strokeWidth={1.8} aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Search · ⌘K</TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={openCommand}
              aria-label="Search"
              aria-keyshortcuts="Meta+K Control+K"
              className="mb-1 flex h-9 items-center gap-[11px] rounded-[9px] px-[11px] text-[13.5px] font-medium text-app-muted outline-none transition-colors duration-150 ease-out hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Search className="size-[17px] shrink-0" strokeWidth={1.8} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-left">Search</span>
              <kbd className="shrink-0 rounded border border-app-line bg-app-stone-1 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-app-muted-2">
                ⌘K
              </kbd>
            </button>
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
                collapsed={collapsed}
              />
            ))}
          </nav>
        </div>

        {/* Footer user-bar: collapse toggle + notifications, then the account
            tile that opens the member menu (Settings + theme + sign out). */}
        <div
          className={cn(
            "shrink-0 border-t border-app-line-soft px-2 py-2",
            collapsed ? "flex flex-col items-center gap-1" : "",
          )}
        >
          {collapsed ? (
            <>
              {collapseToggle}
              <NotificationBell appVariant />
              {memberTile}
            </>
          ) : (
            <>
              <div className="mb-1 flex items-center justify-between px-0.5">
                {collapseToggle}
                <NotificationBell appVariant />
              </div>
              {memberTile}
            </>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
