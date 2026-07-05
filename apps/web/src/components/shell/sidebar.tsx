"use client";

import {
  BookText,
  Check,
  CheckSquare,
  ChevronsUpDown,
  Inbox as InboxIcon,
  PenSquare,
  Rows3,
  Settings as SettingsIcon,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
 * The calm LEFT SIDEBAR (PORTAL-UX §1): a full-height white column with a single
 * hairline right border and no shadow, the app's SOLE primary nav. Its top
 * brand cell is exactly the height of the content top bar (both 56px + a bottom
 * hairline), so the two align into one continuous top band — the frame reads as
 * a single shell. Expanded (232px, labeled) ⇄ collapsed (64px icon rail) via the
 * top-bar toggle; the choice is persisted.
 *
 * Brand cell (workspace switcher) · New message · FOCUS group (For you is the
 * only petrol pill) · LIBRARY group · a pinned Settings row. The notifications
 * bell + account menu live in the top bar, not here.
 *
 * Hidden below lg, where the labeled bottom tab bar owns nav (§5).
 */
export function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const { membership, memberships, switchCompany } = useActiveCompany();
  const counts = useNavCounts();

  const multi = memberships.length > 1;
  const numbersActive = counts.numbers;

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
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[14px] font-semibold leading-[1.15] text-app-ink">
          {membership.name}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-app-muted-2">
          <span aria-hidden className="size-1.5 rounded-full bg-app-petrol" />
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

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "hidden h-full shrink-0 flex-col border-r border-app-line bg-app-white lg:flex",
          collapsed ? "w-[64px]" : "w-[232px]",
        )}
      >
        {/* Brand cell — 56px + bottom hairline, aligned with the top bar. */}
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
                  "flex items-center rounded-[10px] outline-none transition-colors hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring",
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

        {/* Nav area. */}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-y-auto pb-3.5 pt-3",
            collapsed ? "px-2" : "px-3",
          )}
        >
          {/* Primary action: start a new conversation. */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/inbox/new"
                  aria-label="New message"
                  className="mb-2 flex h-9 items-center justify-center rounded-[10px] bg-app-petrol text-white transition-colors duration-150 hover:bg-app-petrol/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <PenSquare className="size-[16px]" strokeWidth={2} aria-hidden />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">New message</TooltipContent>
            </Tooltip>
          ) : (
            <Link
              href="/inbox/new"
              className="mb-2.5 flex h-[38px] items-center justify-center gap-2 rounded-[10px] bg-app-petrol text-[13.5px] font-semibold text-white transition-colors duration-150 hover:bg-app-petrol/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PenSquare className="size-[16px]" strokeWidth={2} aria-hidden />
              New message
            </Link>
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

            {collapsed ? (
              <div className="mx-1 my-2 h-px bg-app-line-soft" aria-hidden />
            ) : (
              <div className="px-3 pb-1.5 pt-3.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-app-muted-2">
                Library
              </div>
            )}
            {LIBRARY.map((row) => (
              <NavItem
                key={row.href}
                row={row}
                active={isNavActive(pathname, row.href)}
                count={row.href === "/settings/numbers" ? counts.numbers : undefined}
                collapsed={collapsed}
              />
            ))}
          </nav>

          {/* Pinned footer: Settings (bell + account moved to the top bar). */}
          <div className="mt-auto border-t border-app-line-soft pt-2">
            <NavItem
              row={{ label: "Settings", href: "/settings", icon: SettingsIcon }}
              active={isNavActive(pathname, "/settings")}
              collapsed={collapsed}
            />
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}
