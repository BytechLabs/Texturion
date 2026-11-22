"use client";

import { useId, useState } from "react";

import { useConfirmLeaving } from "@/lib/softphone/leave-call";

import {
  CalendarClock,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronsUpDown,
  CreditCard,
  Ellipsis,
  Inbox as InboxIcon,
  PanelLeft,
  PhoneIncoming,
  Search,
  Sparkles,
  Trash2,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { avatarInitials, roleHasCapability } from '@loonext/shared';
import type { Capability, MemberRole } from '@loonext/shared';

import { useT } from '@/i18n/provider';
import type { MessageKey, Translate } from '@/i18n/provider';
import { useSavedViews } from "@/lib/api/saved-views";
import { useActiveCompany } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

import { InitialsAvatar } from "./initials-avatar";
import { MemberMenu } from "./member-menu";
import { PhoneLineNavigation } from "./phone-line";
import { isNavActive, ROLE_LABEL_KEYS } from "./nav";
import {
  useForYouNavCount,
  useInboxNavCount,
  useTaskNavCount,
} from "./use-nav-counts";
import { companyInitials, NavGlyph } from "./workspace-bits";

/** Counts above this render as `9+` (the calm numeral cap, PORTAL-UX §1.1). */
function cap(n: number): string {
  return n > 9 ? "9+" : `${n}`;
}

/** Opens the ⌘K command palette — the app's search + navigator. */
function openCommand() {
  window.dispatchEvent(new Event("loonext:open-command"));
}

interface NavRow {
  /** #228: the catalogue key — a module-level registry cannot call the hook. */
  labelKey: MessageKey;
  href: string;
  icon: typeof InboxIcon;
  /**
   * #315: what this row needs to be worth showing. Every focus surface is a
   * conversation surface, so a role without `conversations.read` (a bookkeeper)
   * would otherwise be given a nav of five rows that all answer 403.
   */
  needs: Capability;
}

const FOR_YOU: NavRow = { labelKey: "shell.navForYou", href: "/for-you", icon: Zap, needs: "conversations.read" };
const LOU: NavRow = { labelKey: "shell.navLou", href: "/lou", icon: Sparkles, needs: "conversations.read" };
const MESSAGES: NavRow = { labelKey: "shell.navMessages", href: "/inbox", icon: InboxIcon, needs: "conversations.read" };
const SCHEDULED: NavRow = { labelKey: "shell.navScheduled", href: "/inbox/scheduled", icon: CalendarClock, needs: "conversations.read" };
const CALLS: NavRow = { labelKey: "shell.navCalls", href: "/calls", icon: PhoneIncoming, needs: "conversations.read" };
const TASKS: NavRow = { labelKey: "shell.navTasks", href: "/tasks", icon: CheckSquare, needs: "conversations.read" };
const PLANNER: NavRow = { labelKey: "shell.navPlanner", href: "/tasks/planner", icon: CalendarDays, needs: "conversations.read" };
const CONTACTS: NavRow = { labelKey: "shell.navContacts", href: "/contacts", icon: Users, needs: "conversations.read" };
const TRASH: NavRow = { labelKey: "shell.navTrash", href: "/trash", icon: Trash2, needs: "records.delete" };
const FOCUS = [FOR_YOU, LOU, MESSAGES, CALLS, TASKS, CONTACTS, TRASH];

/**
 * #315: what a role with no inbox gets instead of an empty nav.
 *
 * A bookkeeper holds billing and nothing else, and every row above is a
 * conversation surface. A sidebar with nothing in it reads as a broken app, so
 * the one thing they CAN work is promoted into the primary nav rather than
 * left buried in the account menu.
 */
const BILLING_ROW: NavRow = {
  labelKey: "shell.navBilling",
  href: "/settings/billing",
  icon: CreditCard,
  needs: "billing.manage",
};

/** The rows this role can actually use, never an empty list. */
export function navRowsFor(role: MemberRole): NavRow[] {
  const focus = FOCUS.filter((row) => roleHasCapability(role, row.needs));
  if (focus.length > 0) return focus;
  return roleHasCapability(role, BILLING_ROW.needs) ? [BILLING_ROW] : [];
}

/**
 * One nav row (PORTAL-UX §1.1): glyph + label + optional count, 36px, soft
 * radius. Active = petrol-tint fill + petrol-deep text/icon + a 3px petrol LEFT
 * edge-marker (never a heavy block, never a shadow). EVERY count renders as a
 * quiet stone tabular numeral (APP-LAYOUT-V2 §1.3, issue #64) — the §2.1
 * one-petrol-element budget keeps the accent on the primary action (compose),
 * so the rail never competes with it.
 *
 * Collapsed (icon rail): icon-only, the label moves to a hover/focus tooltip
 * (+ an aria-label), and the count degrades to a small muted dot badge so the
 * at-a-glance signal survives.
 */
function NavItem({
  row,
  active,
  count,
  collapsed,
  t,
}: {
  row: NavRow;
  active: boolean;
  count?: number;
  collapsed?: boolean;
  t: Translate;
}) {
  const showCount = typeof count === "number" && count > 0;
  const label = t(row.labelKey);

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={row.href}
            aria-current={active ? "page" : undefined}
            aria-label={
              showCount
                ? t("shell.navCount", { label, count: cap(count) })
                : label
            }
            className={cn(
              "relative flex h-9 items-center justify-center rounded-[9px] transition-colors duration-150 ease-out",
              active
                ? "bg-app-tint text-app-olive-deep before:absolute before:-left-2 before:top-[7px] before:bottom-[7px] before:w-[3px] before:rounded-r-[3px] before:bg-app-olive before:content-['']"
                : "text-app-ink-soft hover:bg-app-line-soft has-data-pending:bg-app-line-soft",
            )}
          >
            <NavGlyph
              icon={row.icon}
              className={cn(
                "size-5 shrink-0",
                active ? "text-app-olive-deep" : "text-app-muted",
              )}
            />
            {showCount && (
              <span
                aria-hidden
                className="absolute right-1.5 top-1.5 size-2 rounded-full bg-app-muted-2 ring-2 ring-app-paper"
              />
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          {label}
          {showCount ? ` · ${cap(count)}` : ""}
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
          ? "bg-app-tint font-semibold text-app-olive-deep before:absolute before:-left-3 before:top-[7px] before:bottom-[7px] before:w-[3px] before:rounded-r-[3px] before:bg-app-olive before:content-['']"
          : "text-app-ink-soft hover:bg-app-line-soft has-data-pending:bg-app-line-soft has-data-pending:text-app-olive-deep",
      )}
    >
      <NavGlyph
        icon={row.icon}
        className={cn(
          "size-4 shrink-0",
          active ? "text-app-olive-deep" : "text-app-muted",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {showCount && (
        <span
          className={cn(
            "text-[11.5px] font-medium tabular-nums",
            active ? "text-app-olive-deep" : "text-app-muted",
          )}
        >
          {cap(count)}
        </span>
      )}
    </Link>
  );
}

export function Sidebar({
  collapsed = false,
  onToggleSidebar,
}: {
  collapsed?: boolean;
  onToggleSidebar: () => void;
}) {
  const t = useT();
  const pathname = usePathname();
  const { membership, memberships, switchCompany, displayName, role } =
    useActiveCompany();
  const confirmLeaving = useConfirmLeaving();
  const forYouCount = useForYouNavCount();
  const inboxCount = useInboxNavCount();
  const taskCount = useTaskNavCount();
  const navCounts: Partial<Record<string, number>> = {
    "/for-you": forYouCount,
    "/inbox": inboxCount,
    "/tasks": taskCount,
  };

  const multi = memberships.length > 1;
  // #315: was `role.charAt(0).toUpperCase() + role.slice(1)`, which renders
  // "read_only" as "Read_only". A role name is a thing we chose to show
  // somebody; it should read like one.
  const roleLabelKey = ROLE_LABEL_KEYS[role];
  const roleLabel = roleLabelKey ? t(roleLabelKey) : role;
  const navRows = navRowsFor(role);
  const canRead = roleHasCapability(role, "conversations.read");

  function renderRow(row: NavRow) {
    const inTaskShortcut = pathname.startsWith("/tasks/planner") || pathname.startsWith("/tasks/views/");
    const active = isNavActive(pathname, row.href)
      && (row !== TASKS || !inTaskShortcut)
      && (row !== MESSAGES || pathname !== SCHEDULED.href);
    return <NavItem key={row.href} row={row} active={active} count={navCounts[row.href]} collapsed={collapsed} t={t} />;
  }

  const logo = (
    <InitialsAvatar
      initials={companyInitials(membership.name)}
      className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-app-tint text-[14px] font-semibold text-app-olive-deep"
    />
  );

  const companyTileExpanded = (
    <>
      {logo}
      <span className="min-w-0 flex-1 truncate text-left text-[14px] font-semibold leading-[1.15] text-app-ink">
        {membership.name}
      </span>
      {multi && (
        <ChevronsUpDown
          className="size-3.5 shrink-0 text-app-muted-2"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
    </>
  );

  const workspaceName = t("shell.workspaceNamed", { name: membership.name });
  const workspaceTrigger = (
    <DropdownMenuTrigger
      aria-label={`${workspaceName}. ${t("shell.switchWorkspace")}`}
      className={cn(
        "flex items-center rounded-[10px] outline-none transition-colors duration-150 ease-out hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring",
        collapsed ? "size-10 justify-center" : "w-full gap-2.5 px-2 py-1 text-left",
      )}
    >
      {collapsed ? logo : companyTileExpanded}
    </DropdownMenuTrigger>
  );

  const workspaceMenu = (
    <DropdownMenuContent side={collapsed ? "right" : "bottom"} align="start" className="w-56">
      <DropdownMenuLabel>{t("shell.workspaces")}</DropdownMenuLabel>
      {memberships.map((m) => (
        <DropdownMenuItem
          key={m.company_id}
          onSelect={() => {
            if (m.company_id === membership.company_id) return;
            confirmLeaving(t("shell.switchWorkspace"), () => switchCompany(m.company_id));
          }}
        >
          <span className="min-w-0 flex-1 truncate">{m.name}</span>
          {m.company_id === membership.company_id && (
            <Check className="size-4 text-primary" strokeWidth={1.75} />
          )}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );

  const collapseButton = (
    <button
      type="button"
      onClick={onToggleSidebar}
      aria-label={
        collapsed ? t("shell.expandSidebar") : t("shell.collapseSidebar")
      }
      aria-pressed={collapsed}
      className="grid size-8 shrink-0 place-items-center rounded-[8px] text-app-muted outline-none transition-colors duration-150 ease-out hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring"
    >
      <PanelLeft className="size-4" strokeWidth={1.75} aria-hidden />
    </button>
  );

  const collapseToggle = collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>{collapseButton}</TooltipTrigger>
      <TooltipContent side="right">{t("shell.expandSidebar")}</TooltipContent>
    </Tooltip>
  ) : collapseButton;

  const memberButton = (
    <button
      type="button"
      className={cn(
        "flex items-center rounded-[9px] outline-none transition-colors duration-150 ease-out hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring",
        collapsed ? "size-10 justify-center" : "w-full gap-2.5 px-1.5 py-1 text-left",
      )}
    >
      <InitialsAvatar
        initials={avatarInitials(displayName || membership.name)}
        className="grid size-7 shrink-0 place-items-center rounded-full bg-app-tint text-[11px] font-semibold text-app-olive-deep"
      />
      {!collapsed && (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold text-app-ink">
            {displayName || t("shell.you")}
          </span>{" "}
          <span className="block truncate text-[11px] text-app-muted-2">
            {roleLabel}
          </span>
        </span>
      )}
      <span className="sr-only">{t("shell.accountAndSettings")}</span>
    </button>
  );

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "hidden h-full shrink-0 flex-col border-r border-app-line bg-app-paper lg:flex",
          collapsed ? "w-14" : "w-[232px]",
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
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>{workspaceTrigger}</TooltipTrigger>
                  <TooltipContent side="right">{workspaceName}</TooltipContent>
                </Tooltip>
              ) : workspaceTrigger}
              {workspaceMenu}
            </DropdownMenu>
          ) : (
            <div
              className={cn(
                "flex items-center",
                collapsed ? "" : "gap-2.5 px-2",
              )}
            >
              {collapsed ? <>{logo}<span className="sr-only">{workspaceName}</span></> : companyTileExpanded}
            </div>
          )}
        </div>

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
                  aria-label={t("shell.search")}
                  aria-keyshortcuts="Meta+K Control+K"
                  className="mb-1 flex h-9 items-center justify-center rounded-[9px] text-app-muted outline-none transition-colors duration-150 ease-out hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Search className="size-5" strokeWidth={1.75} aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {t("shell.searchShortcut")}
              </TooltipContent>
            </Tooltip>
          ) : (
            // Named by its own text, ⌘K included: every word it shows is in
            // its name (WCAG 2.5.3).
            <button
              type="button"
              onClick={openCommand}
              aria-keyshortcuts="Meta+K Control+K"
              className="mb-1 flex h-9 items-center gap-[11px] rounded-[9px] px-[11px] text-[13.5px] font-medium text-app-muted outline-none transition-colors duration-150 ease-out hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Search className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-left">
                {t("shell.search")}
              </span>
              <kbd className="shrink-0 rounded border border-app-line bg-app-inset px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-app-muted-2">
                ⌘K
              </kbd>
            </button>
          )}

          <nav aria-label={t("shell.primaryNav")} className="flex flex-col gap-px">
            {canRead ? (
              <>
                {renderRow(FOR_YOU)}
                {renderRow(LOU)}
                <SidebarDivider rail={collapsed} />
                <PhoneLineNavigation rail={collapsed}>
                  <ul className={cn("space-y-px", !collapsed && "ml-4")}>
                    <li>
                      {renderRow(MESSAGES)}
                      <ul className={cn(!collapsed && "ml-4")}>
                        <li>{renderRow(SCHEDULED)}</li>
                      </ul>
                    </li>
                    <li>{renderRow(CALLS)}</li>
                  </ul>
                </PhoneLineNavigation>
                <SidebarDivider rail={collapsed} />
                <TaskNavigation collapsed={collapsed} taskLink={renderRow(TASKS)} plannerLink={renderRow(PLANNER)} pathname={pathname} />
                {renderRow(CONTACTS)}
              </>
            ) : navRows.filter((row) => row !== TRASH).map(renderRow)}
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
              {navRows.includes(TRASH) && <div className="w-full">{renderRow(TRASH)}</div>}
              {collapseToggle}
              <NotificationBell appVariant tooltip />
              <Tooltip>
                <MemberMenu>
                  <TooltipTrigger asChild>{memberButton}</TooltipTrigger>
                </MemberMenu>
                <TooltipContent side="right">{t("shell.accountAndSettings")}</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <>
              {navRows.includes(TRASH) && renderRow(TRASH)}
              <div className="mb-1 flex items-center justify-between px-0.5">
                {collapseToggle}
                <NotificationBell appVariant />
              </div>
              <MemberMenu>{memberButton}</MemberMenu>
            </>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}

function SidebarDivider({ rail }: { rail: boolean }) {
  return <hr className={cn("my-2 border-app-line", rail ? "mx-2.5" : "mx-[11px]")} />;
}

function TaskNavigation({
  collapsed,
  taskLink,
  plannerLink,
  pathname,
}: {
  collapsed: boolean;
  taskLink: React.ReactNode;
  plannerLink: React.ReactNode;
  pathname: string;
}) {
  const t = useT();
  const { data } = useSavedViews("tasks");
  const [open, setOpen] = useState(true);
  const shortcutsId = useId();
  const views = data?.data ?? [];
  const activeShortcut = pathname === PLANNER.href || pathname.startsWith("/tasks/views/");

  if (collapsed) {
    return (
      <div className="group/tasks relative">
        {taskLink}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger
                aria-label={t("shell.taskShortcuts")}
                aria-current={activeShortcut ? "page" : undefined}
                className={cn(
                  "absolute -right-1 top-0 grid size-5 place-items-center rounded border border-app-line focus-visible:ring-2 focus-visible:ring-ring",
                  activeShortcut
                    ? "bg-app-tint text-app-olive-deep"
                    : "bg-app-paper text-app-ink opacity-0 focus:opacity-100 data-[state=open]:opacity-100 group-hover/tasks:opacity-100 group-focus-within/tasks:opacity-100",
                )}
              >
                <Ellipsis className="size-3.5" aria-hidden />
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{t("shell.taskShortcuts")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="right" align="start" className="w-52">
            <DropdownMenuItem asChild><Link href={PLANNER.href}>{t(PLANNER.labelKey)}</Link></DropdownMenuItem>
            {views.length > 0 && <DropdownMenuLabel>{t("shell.savedTaskViews")}</DropdownMenuLabel>}
            {views.map((view) => (
              <DropdownMenuItem key={view.id} asChild><Link className="truncate" href={`/tasks/views/${view.id}`}>{view.name}</Link></DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <div>
      <div className="relative [&>a]:pr-8">
        {taskLink}
        <button
          type="button"
          className="absolute right-1 top-1 grid size-7 place-items-center rounded-md text-app-muted hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("shell.taskShortcuts")}
          aria-expanded={open}
          aria-controls={shortcutsId}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown className={cn("size-3.5", !open && "-rotate-90")} aria-hidden />
        </button>
      </div>
      <div id={shortcutsId} hidden={!open} className="ml-4 space-y-px">
        {plannerLink}
        {views.length > 0 && (
          <div>
            <p className="px-[11px] pb-1 pt-2 text-[11px] font-medium text-app-muted">{t("shell.savedTaskViews")}</p>
            {views.map((view) => {
              const href = `/tasks/views/${view.id}`;
              const active = pathname === href;
              return (
                <Link key={view.id} href={href} aria-current={active ? "page" : undefined} className={cn(
                  "block truncate rounded-[9px] px-[11px] py-2 text-[13px] font-medium",
                  active ? "bg-app-tint text-app-olive-deep" : "text-app-ink-soft hover:bg-app-line-soft",
                )}>
                  {view.name}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
