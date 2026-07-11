"use client";

import {
  Bell,
  CheckCheck,
  ListChecks,
  MessageSquareText,
  PhoneMissed,
  UserRoundPlus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsFeed,
  useNotificationsUnreadCount,
} from "@/lib/api/notifications";
import { flattenPages } from "@/lib/api/pagination";
import type { NotificationItem, NotificationType } from "@/lib/api/types";
import { contactDisplayName } from "@/lib/format/phone";
import { formatRelativeTime } from "@/lib/format/time";
import { useForYouNotificationsRealtime } from "@/lib/realtime/for-you-notifications";
import { cn } from "@/lib/utils";

/** Count above this renders as `9+` (matches the rail/tab numeral cap, §1.3). */
function badgeCount(count: number): string {
  return count > 9 ? "9+" : `${count}`;
}

const TYPE_ICON: Record<NotificationType, typeof MessageSquareText> = {
  inbound_message: MessageSquareText,
  assigned: UserRoundPlus,
  task_assigned: ListChecks,
  missed_call: PhoneMissed,
};

/** One-line, past-tense summary of a notification (calm — the name is the hero). */
function describe(item: NotificationItem, name: string): string {
  switch (item.type) {
    case "inbound_message":
      return `New message from ${name}`;
    case "assigned":
      return `${name} assigned to you`;
    case "task_assigned":
      return `Task assigned · ${name}`;
    case "missed_call":
      return `Missed call from ${name}`;
    default:
      return name;
  }
}

/**
 * The deep-link target for a notification (D24). Every item ties back to a
 * conversation thread — a task-assigned notification opens the thread the task
 * lives in (the /tasks page has its own surface; the notification points at the
 * conversation the work is about). Null when there is nothing to open.
 */
function deepLink(item: NotificationItem): string | null {
  return item.conversation_id ? `/inbox/${item.conversation_id}` : null;
}

function NotificationRow({
  item,
  onSelect,
}: {
  item: NotificationItem;
  onSelect: (item: NotificationItem) => void;
}) {
  const Icon = TYPE_ICON[item.type] ?? Bell;
  const name = contactDisplayName(item.contact);
  const href = deepLink(item);

  return (
    <button
      type="button"
      disabled={!href}
      onClick={() => onSelect(item)}
      className={cn(
        "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 ease-out",
        href ? "hover:bg-secondary/60" : "cursor-default",
      )}
    >
      {/* Unread dot (petrol) points; read items recede to a hollow slot so the
          row height never jumps. */}
      <span
        aria-hidden
        className={cn(
          "mt-1.5 size-1.5 shrink-0 rounded-full",
          item.unread ? "bg-primary" : "bg-transparent",
        )}
      />
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm",
            item.unread
              ? "font-medium text-foreground"
              : "text-muted-foreground",
          )}
        >
          {describe(item, name)}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {formatRelativeTime(item.created_at)}
        </span>
      </span>
    </button>
  );
}

/**
 * The notifications feed body (header row + list + pagination), shared by the
 * bell popover (desktop / page headers) and the mobile account sheet (#100).
 * Owns its own queries; `active` gates the feed fetch so a collapsed host
 * never loads pages. Selecting an item marks it (and everything older) read,
 * deep-links to its thread, and asks the host to dismiss via `onNavigate`.
 */
export function NotificationFeed({
  active,
  onNavigate,
}: {
  active: boolean;
  onNavigate: () => void;
}) {
  const router = useRouter();
  const unread = useNotificationsUnreadCount();
  const feed = useNotificationsFeed(active);
  const markAllRead = useMarkAllNotificationsRead();
  const markRead = useMarkNotificationRead();

  const count = unread.data?.count ?? 0;
  const items = useMemo(() => flattenPages(feed.data), [feed.data]);

  const onSelect = (item: NotificationItem) => {
    // Opening ONE notification marks just it (and everything older) read via the
    // per-item endpoint — newer notifications stay unread. The host closes (not
    // through its dismiss path, so this never also trips mark-all-read), then
    // we deep-link to the thread.
    if (item.unread) {
      markRead.mutate(item.created_at);
    }
    onNavigate();
    const href = deepLink(item);
    if (href) {
      router.push(href);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-medium text-foreground">
          Notifications
        </span>
        <Button
          variant="ghost"
          size="xs"
          disabled={count === 0 || markAllRead.isPending}
          onClick={() => markAllRead.mutate()}
          className="text-muted-foreground"
        >
          <CheckCheck className="size-3" strokeWidth={1.75} aria-hidden />
          Mark all read
        </Button>
      </div>

      {feed.isPending ? (
        <div className="space-y-1 p-3" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-start gap-3 px-1 py-2">
              <Skeleton className="mt-0.5 size-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">You&apos;re all caught up.</p>
        </div>
      ) : (
        <ScrollArea className="max-h-[min(24rem,60vh)]">
          <ul className="divide-y divide-border-subtle">
            {items.map((item) => (
              <li key={item.id}>
                <NotificationRow item={item} onSelect={onSelect} />
              </li>
            ))}
          </ul>
          {feed.hasNextPage && (
            <div className="p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                disabled={feed.isFetchingNextPage}
                onClick={() => feed.fetchNextPage()}
              >
                {feed.isFetchingNextPage ? "Loading…" : "Show older"}
              </Button>
            </div>
          )}
        </ScrollArea>
      )}
    </>
  );
}

/**
 * D24 notifications bell + popover. A quiet Bell in the page header with an
 * unread dot/count from GET /v1/notifications/unread-count; the popover lists
 * the derived feed (GET /v1/notifications) newest-first with a per-item
 * read/unread dot, relative time, an icon per type, a deep-link, and one
 * "Mark all read". Opening a single notification marks just it (and everything
 * older) read via POST /v1/notifications/mark-read — a watermark advance to that
 * item's timestamp, so newer notifications stay unread. Dismissing the popover
 * (ESC / click-away) is the "I've seen everything" gesture and marks all read.
 */
export function NotificationBell({
  appVariant = false,
}: {
  /**
   * APP-SHELL-REDESIGN top-bar styling: render the trigger as the mockup
   * .icon-btn (bordered white square with a soft petrol shadow + the has-dot
   * unread indicator) instead of the ghost header button. Behavior is identical.
   */
  appVariant?: boolean;
} = {}) {
  const [open, setOpen] = useState(false);

  // Keep the badge + feed live off the shared realtime signal (no 2nd channel).
  useForYouNotificationsRealtime();

  const unread = useNotificationsUnreadCount();
  const markAllRead = useMarkAllNotificationsRead();

  const count = unread.data?.count ?? 0;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // Mark ALL read on DISMISS (ESC / click-away), not open: the unread dots
    // stay visible while the user reads the list (so they can see what's new),
    // then the watermark advances — "I've seen everything" — as they dismiss
    // it. Guarded so a close with nothing unread never fires a needless write.
    if (!next && count > 0 && !markAllRead.isPending) {
      markAllRead.mutate();
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {appVariant ? (
          // Mockup .icon-btn.has-dot: a bordered white square with a soft petrol
          // shadow and a single unread DOT (not a numeral) top-right.
          <button
            type="button"
            aria-label={
              count > 0 ? `Notifications, ${count} unread` : "Notifications"
            }
            className="relative grid size-[38px] place-items-center rounded-app-ctrl border border-app-line bg-app-white text-app-ink shadow-[0_1px_1px_rgba(20,32,30,0.03)] transition-[border-color,background,box-shadow] duration-150 ease-out hover:border-app-tint-line hover:bg-app-stone-1 hover:app-shadow-row focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Bell className="size-[18px]" strokeWidth={1.7} aria-hidden />
            {count > 0 && (
              <span
                aria-hidden
                className="absolute right-[9px] top-2 size-[7px] rounded-full border-2 border-app-white bg-primary"
              />
            )}
          </button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative"
            aria-label={
              count > 0 ? `Notifications, ${count} unread` : "Notifications"
            }
          >
            <Bell className="size-[18px]" strokeWidth={1.75} aria-hidden />
            {count > 0 && (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-4 text-primary-foreground tabular-nums"
              >
                {badgeCount(count)}
              </span>
            )}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden p-0"
      >
        <NotificationFeed active={open} onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
