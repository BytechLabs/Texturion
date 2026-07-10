"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Check,
  ChevronDown,
  LogOut,
  Monitor,
  Moon,
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

  const rowClass =
    "flex w-full items-center gap-3 rounded-app-ctrl px-3 py-2.5 text-left text-[14px] font-medium text-app-ink transition-colors duration-150 ease-out hover:bg-app-line-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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

      <div className="space-y-4 px-3 py-3">
          {/* Workspace switcher — only when the account belongs to several. */}
          {multi && (
            <section aria-label="Workspaces" className="space-y-1">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wide text-app-muted-2">
                Workspaces
              </p>
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
            </section>
          )}

          {/* The copyable business number(s) — the same honest strip the desktop
              sidebar shows (multiple numbers, real failed states). */}
          <section aria-label="Business numbers" className="px-3">
            <WorkspaceNumbers numbers={numbers.data?.data ?? []} />
          </section>

          {/* Notifications — the feed inline, expandable, with the unread count. */}
          <section aria-label="Notifications">
            <button
              type="button"
              className={rowClass}
              aria-expanded={feedOpen}
              onClick={toggleFeed}
            >
              <Bell className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 flex-1">Notifications</span>
              {count > 0 && (
                <span
                  aria-label={`${count} unread`}
                  className="flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-5 text-primary-foreground tabular-nums"
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
              <div className="mt-1 overflow-hidden rounded-app-card border border-app-line-soft">
                <NotificationFeed active={feedOpen} onNavigate={onClose} />
              </div>
            )}
          </section>

          {/* Settings + theme + sign out. */}
          <section aria-label="Account" className="space-y-1">
            <Link href="/settings" className={rowClass} onClick={onClose}>
              <Settings className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              Settings
            </Link>

            <div className="flex items-center gap-3 px-3 py-1.5">
              <span className="text-[12px] font-medium text-app-muted">
                Theme
              </span>
              <div
                role="radiogroup"
                aria-label="Theme"
                className="flex flex-1 gap-1"
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
                        "flex flex-1 items-center justify-center gap-1.5 rounded-app-ctrl border px-2 py-1.5 text-[12px] font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected
                          ? "border-app-tint-line bg-app-tint text-app-petrol-deep"
                          : "border-app-line text-app-muted hover:bg-app-line-soft",
                      )}
                    >
                      <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              className={rowClass}
              onClick={() => void signOut()}
            >
              <LogOut className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              Sign out
            </button>
          </section>
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
