"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Check,
  ChevronDown,
  LogOut,
  Monitor,
  Moon,
  PhoneIncoming,
  Settings,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useRef, useState } from "react";

import { NotificationFeed } from "@/components/notifications/notification-bell";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useMarkAllNotificationsRead,
  useNotificationsUnreadCount,
} from "@/lib/api/notifications";
import { useNumbers } from "@/lib/api/numbers";
import { useActiveCompany } from "@/lib/company/provider";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

import { avatarInitials } from "./avatar-color";
import { WorkspaceNumbers, companyInitials } from "./workspace-bits";

/** Count above this renders as `9+` (the calm numeral cap, §1.3). */
function cap(n: number): string {
  return n > 9 ? "9+" : `${n}`;
}

const THEME_OPTIONS = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

/**
 * #100: the account-sheet BODY — everything the retired mobile top header
 * carried: the account row, the workspace switcher (when the account belongs
 * to several), the copyable business number(s), the notifications feed
 * (inline, expandable, with the unread count), the theme choice, Settings,
 * and Sign out. A plain component (no portal) so it renders under test; the
 * exported sheet below wraps it in the bottom Sheet.
 */
export function MobileAccountSheetBody({
  onClose,
  onFeedOpened,
}: {
  /** Close the host sheet (navigation rows, workspace switch). */
  onClose: () => void;
  /** The notifications feed was expanded — the host arms dismiss-marks-read. */
  onFeedOpened: () => void;
}) {
  const { membership, memberships, switchCompany, displayName } =
    useActiveCompany();
  const numbers = useNumbers();
  const unread = useNotificationsUnreadCount();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [feedOpen, setFeedOpen] = useState(false);

  const count = unread.data?.count ?? 0;
  const multi = memberships.length > 1;

  function toggleFeed() {
    setFeedOpen((current) => {
      const next = !current;
      if (next) onFeedOpened();
      return next;
    });
  }

  async function signOut() {
    await getSupabaseBrowser().auth.signOut();
    queryClient.clear();
    router.push("/login");
  }

  // #116: rows follow the For You card-row recipe exactly (for-you-view.tsx):
  // 13.5px semibold ink, gap-3, px-4 py-3, hover fill — inside a grouped
  // hairline card, not floating menu items.
  const rowClass =
    "flex w-full items-center gap-3 px-4 py-3 text-left text-[13.5px] font-semibold text-app-ink transition-colors duration-150 ease-out hover:bg-app-line-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
  // The For You section label recipe, verbatim.
  const labelClass =
    "flex items-baseline gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2";
  // The grouped elevated card (flat, hairline border) with quiet row dividers.
  const cardClass =
    "overflow-hidden rounded-app-card border border-app-line bg-app-white divide-y divide-app-line-soft";

  return (
    <>
      <div className="border-b border-app-line-soft px-4 py-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-full bg-app-tint text-[13px] font-semibold text-app-petrol-deep"
          >
            {avatarInitials(displayName || membership.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-app-ink">
              {displayName || "You"}
            </p>
            <p className="truncate text-[12px] text-app-muted">
              {membership.name}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-4 py-4">
        {/* Workspace switcher — only when the account belongs to several. */}
        {multi && (
          <section aria-label="Workspaces">
            <h2 className={labelClass}>Workspaces</h2>
            <div className={cardClass}>
              {memberships.map((m) => (
                <button
                  key={m.company_id}
                  type="button"
                  className={rowClass}
                  onClick={() => {
                    switchCompany(m.company_id);
                    onClose();
                  }}
                >
                  <span
                    aria-hidden
                    className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-app-tint text-[11px] font-semibold text-app-petrol-deep"
                  >
                    {companyInitials(m.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  {m.company_id === membership.company_id && (
                    <Check
                      className="size-4 shrink-0 text-primary"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* One grouped card, exactly like a For You section: the business
            number(s), the notifications row (+ inline feed), and Settings. */}
        <div className={cardClass}>
          <section
            aria-label="Business numbers"
            className="px-4 py-3"
          >
            <WorkspaceNumbers numbers={numbers.data?.data ?? []} />
          </section>

          <section aria-label="Notifications">
            <button
              type="button"
              className={rowClass}
              aria-expanded={feedOpen}
              onClick={toggleFeed}
            >
              <Bell
                className="size-4 shrink-0 text-app-muted-2"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="min-w-0 flex-1">Notifications</span>
              {count > 0 && (
                <span
                  aria-label={`${count} unread`}
                  // The quiet STONE count of the tab bar and filter segments —
                  // the main UI never spends teal on counts (accent budget).
                  className="grid h-4 min-w-4 place-items-center rounded-full bg-app-line-soft px-1 text-[10.5px] font-semibold tabular-nums text-app-muted"
                >
                  {cap(count)}
                </span>
              )}
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-app-muted-2 transition-transform duration-150",
                  feedOpen && "rotate-180",
                )}
                strokeWidth={1.75}
                aria-hidden
              />
            </button>
            {feedOpen && (
              <div className="border-t border-app-line-soft">
                <NotificationFeed active={feedOpen} onNavigate={onClose} />
              </div>
            )}
          </section>

          {/* #129: the mobile home of the call log — the tab bar stays four
              links + avatar (#100), so Calls rides the account sheet. */}
          <Link href="/calls" className={rowClass} onClick={onClose}>
            <PhoneIncoming
              className="size-4 shrink-0 text-app-muted-2"
              strokeWidth={1.75}
              aria-hidden
            />
            Calls
          </Link>

          <Link href="/settings" className={rowClass} onClick={onClose}>
            <Settings
              className="size-4 shrink-0 text-app-muted-2"
              strokeWidth={1.75}
              aria-hidden
            />
            Settings
          </Link>
        </div>

        {/* Theme — the inbox filter-bar segmented control, verbatim: a stone
            track with the lifted white active pill (never bordered boxes). */}
        <section aria-label="Theme">
          <h2 className={labelClass}>Theme</h2>
          <div
            role="radiogroup"
            aria-label="Theme"
            className="flex gap-0.5 rounded-full bg-app-line-soft p-[3px] dark:bg-white/5"
          >
            {THEME_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = (theme ?? "system") === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTheme(option.value)}
                  className={cn(
                    "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] transition-[color,background] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    selected
                      ? "bg-app-white font-semibold text-app-ink"
                      : "font-medium text-app-muted hover:text-app-ink",
                  )}
                >
                  <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Sign out — its own quiet card, separated from the everyday rows. */}
        <div className={cardClass}>
          <button
            type="button"
            className={rowClass}
            onClick={() => void signOut()}
          >
            <LogOut
              className="size-4 shrink-0 text-app-muted-2"
              strokeWidth={1.75}
              aria-hidden
            />
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * #100: the mobile account sheet — the tab bar's avatar opens it. A bottom
 * sheet (thumb reach) that scrolls internally and is safe-area padded, hosting
 * {@link MobileAccountSheetBody}. Dismissing the sheet AFTER the notifications
 * feed was opened marks all read — the same "I've seen everything" gesture as
 * dismissing the desktop bell popover.
 */
export function MobileAccountSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const unread = useNotificationsUnreadCount();
  const markAllRead = useMarkAllNotificationsRead();
  const count = unread.data?.count ?? 0;

  // Whether the feed was opened at any point in THIS sheet session — the
  // dismiss-marks-read gesture applies only after the user actually looked.
  const viewedFeedRef = useRef(false);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      if (viewedFeedRef.current && count > 0 && !markAllRead.isPending) {
        markAllRead.mutate();
      }
      viewedFeedRef.current = false;
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85svh] overflow-y-auto rounded-t-2xl border-app-line bg-app-white p-0 pb-[env(safe-area-inset-bottom)]"
      >
        {/* The visible header lives in the body; these give the Radix dialog
            its accessible name without duplicating the visual row. */}
        <SheetHeader className="sr-only">
          <SheetTitle>Account and settings</SheetTitle>
          <SheetDescription>
            Workspace, business numbers, notifications, theme, and sign out.
          </SheetDescription>
        </SheetHeader>
        <MobileAccountSheetBody
          onClose={() => handleOpenChange(false)}
          onFeedOpened={() => {
            viewedFeedRef.current = true;
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
