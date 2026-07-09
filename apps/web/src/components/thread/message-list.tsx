"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useMemberNames } from "@/components/inbox/member-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useConversationEvents } from "@/lib/api/conversations";
import {
  useConversationPinnedMessages,
  useMessages,
} from "@/lib/api/messages";
import { flattenPages } from "@/lib/api/pagination";
import type { Message } from "@/lib/api/types";
import { contactDisplayName } from "@/lib/format/phone";
import { cn } from "@/lib/utils";

import { buildThreadItems, type ThreadItem } from "./clusters";
import { MessageBubble } from "./message-bubble";
import {
  MobilePinnedDisclosure,
  PinnedBanner,
  sortPinned,
} from "./pinned-banner";
import { DayDivider, SystemLine } from "./system-line";
import { ThreadFilterBar } from "./thread-filter-bar";
import {
  filterThreadItems,
  THREAD_FILTER_LABELS,
  threadFilterEmptyCopy,
  type ThreadFilter,
} from "./thread-filter";

const NEAR_BOTTOM_PX = 96;
const PREPEND_TRIGGER_PX = 320;

function byChronology(a: { created_at: string; id: string }, b: { created_at: string; id: string }): number {
  const at = Date.parse(a.created_at);
  const bt = Date.parse(b.created_at);
  if (at !== bt) return at - bt;
  return a.id < b.id ? -1 : 1;
}

/**
 * The G5 thread timeline: virtualized (@tanstack/react-virtual, G11),
 * infinite scroll-back with the scroll position anchored on prepend,
 * stick-to-bottom for new messages, a "New message ↓" pill when one arrives
 * while scrolled up, and an aria-live=polite announcer for incoming texts.
 */
export function MessageList({
  conversationId,
  contact,
  filter,
  onFilterChange,
}: {
  conversationId: string;
  contact: { name: string | null; phone_e164: string };
  /** §5.1 in-thread filter — All | Messages | Notes | Events (URL-state). */
  filter: ThreadFilter;
  onFilterChange: (next: ThreadFilter) => void;
}) {
  const messagesQuery = useMessages(conversationId);
  const eventsQuery = useConversationEvents(conversationId);
  const memberNames = useMemberNames();

  const messages = useMemo(
    () => flattenPages(messagesQuery.data).slice().sort(byChronology),
    [messagesQuery.data],
  );
  // #13: the banner shows the conversation's COMPLETE pinned set from a
  // dedicated query (so a pin on a not-yet-loaded page still appears), merged
  // with the loaded-page pins so an optimistic pin shows before the query
  // refetches. Deduped by id (loaded row wins → optimistic state), newest-pin
  // first.
  const pinnedQuery = useConversationPinnedMessages(conversationId);
  const pinnedMessages = useMemo(() => {
    const byId = new Map<string, (typeof messages)[number]>();
    for (const m of pinnedQuery.data ?? []) byId.set(m.id, m);
    for (const m of messages) byId.set(m.id, m);
    return sortPinned([...byId.values()]);
  }, [pinnedQuery.data, messages]);

  // §4.3: the done/undone timeline lines join the LIVE message body by id.
  // Built from the loaded message set — a cache-miss degrades to "a message"
  // in doneEventSentence rather than inventing text.
  const messageBodyById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of messages) map.set(m.id, m.body);
    return map;
  }, [messages]);
  const messageBody = useCallback(
    (messageId: string) => messageBodyById.get(messageId),
    [messageBodyById],
  );
  const oldestLoadedMessageAt = messages[0]?.created_at ?? null;
  const allMessagesLoaded = messagesQuery.hasNextPage === false;

  // Keep the events timeline at least as deep as the loaded message history
  // so system lines never appear to "start" mid-thread.
  const events = useMemo(
    () => flattenPages(eventsQuery.data).slice().sort(byChronology),
    [eventsQuery.data],
  );
  const oldestLoadedEventAt = events[0]?.created_at ?? null;
  useEffect(() => {
    if (
      eventsQuery.hasNextPage &&
      !eventsQuery.isFetchingNextPage &&
      oldestLoadedEventAt !== null &&
      oldestLoadedMessageAt !== null &&
      oldestLoadedEventAt > oldestLoadedMessageAt
    ) {
      void eventsQuery.fetchNextPage();
    }
  }, [eventsQuery, oldestLoadedEventAt, oldestLoadedMessageAt]);

  const visibleEvents = useMemo(() => {
    if (allMessagesLoaded) return events;
    if (oldestLoadedMessageAt === null) return [];
    return events.filter((e) => e.created_at >= oldestLoadedMessageAt);
  }, [events, allMessagesLoaded, oldestLoadedMessageAt]);

  const allItems: ThreadItem[] = useMemo(
    () => buildThreadItems(messages, visibleEvents),
    [messages, visibleEvents],
  );
  // §5.1: the filter is a cheap client-side view over already-built items —
  // no refetch. All is the full stream; the others narrow it.
  const items: ThreadItem[] = useMemo(
    () => filterThreadItems(allItems, filter),
    [allItems, filter],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const item = items[index];
      if (!item) return 56;
      if (item.kind === "divider") return 36;
      if (item.kind === "event") return 28;
      return item.messages.length * 52 + 18;
    },
    overscan: 6,
    getItemKey: (index) => items[index]?.key ?? index,
  });

  const memberName = useCallback(
    (userId: string | null) => (userId ? memberNames.get(userId) ?? "A teammate" : null),
    [memberNames],
  );

  // --- Scroll behaviors -----------------------------------------------------

  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const didInitialScroll = useRef(false);
  const [newWhileScrolledUp, setNewWhileScrolledUp] = useState(false);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
      setNewWhileScrolledUp(false);
    },
    [],
  );

  // #3: jump to a pinned message from the banner — scroll the virtualizer to
  // the cluster that holds it. A no-op if the message isn't in the current
  // (possibly filtered) view; the row is still rendered so its Pinned chip
  // marks it once on screen.
  const scrollToMessage = useCallback(
    (messageId: string) => {
      const index = items.findIndex(
        (item) =>
          item.kind === "cluster" &&
          item.messages.some((m) => m.id === messageId),
      );
      if (index >= 0) virtualizer.scrollToIndex(index, { align: "center" });
    },
    [items, virtualizer],
  );

  // Anchored prepend: remember total size + scrollTop before older pages
  // land, restore the visual position after (G5 "anchored scroll on
  // prepend"). Keyed on the oldest message id — it always changes when a
  // page prepends (a same-day prepend keeps the first divider key).
  const prependAnchor = useRef<{ total: number; scrollTop: number } | null>(null);
  const oldestMessageId = messages[0]?.id;
  const prevOldestMessageId = useRef(oldestMessageId);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prependAnchor.current && oldestMessageId !== prevOldestMessageId.current) {
      const delta = virtualizer.getTotalSize() - prependAnchor.current.total;
      if (delta > 0) {
        el.scrollTop = prependAnchor.current.scrollTop + delta;
      }
      prependAnchor.current = null;
    }
    prevOldestMessageId.current = oldestMessageId;
  }, [oldestMessageId, virtualizer, items.length]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isBottom = distance <= NEAR_BOTTOM_PX;
    atBottomRef.current = isBottom;
    setAtBottom(isBottom);
    if (isBottom) setNewWhileScrolledUp(false);

    if (
      el.scrollTop < PREPEND_TRIGGER_PX &&
      messagesQuery.hasNextPage &&
      !messagesQuery.isFetchingNextPage &&
      !prependAnchor.current &&
      didInitialScroll.current
    ) {
      prependAnchor.current = {
        total: virtualizer.getTotalSize(),
        scrollTop: el.scrollTop,
      };
      void messagesQuery.fetchNextPage().then((result) => {
        // A failed page fetch must not wedge future prepend triggers.
        if (result.isError) prependAnchor.current = null;
      });
    }
  }, [messagesQuery, virtualizer]);

  // Initial position: bottom of the thread (double rAF so measurements land).
  useEffect(() => {
    if (didInitialScroll.current || items.length === 0) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom();
        didInitialScroll.current = true;
      });
    });
  }, [items.length, scrollToBottom]);

  // New tail message: stick when at bottom; pill when scrolled up (G5).
  const lastMessage: Message | undefined = messages[messages.length - 1];
  const lastMessageId = lastMessage?.id;
  const prevLastMessageId = useRef(lastMessageId);
  const [announcement, setAnnouncement] = useState("");
  // The just-arrived message gets the G2 200ms fade + 4px rise — arrivals
  // only, never replayed as virtual rows re-mount while scrolling.
  const [recentArrivalId, setRecentArrivalId] = useState<string | null>(null);
  useEffect(() => {
    if (!lastMessageId || lastMessageId === prevLastMessageId.current) return;
    prevLastMessageId.current = lastMessageId;
    if (!didInitialScroll.current) return;
    setRecentArrivalId(lastMessageId);
    const timer = setTimeout(() => setRecentArrivalId(null), 400);
    if (atBottomRef.current) {
      requestAnimationFrame(() => scrollToBottom("smooth"));
    } else if (lastMessage && lastMessage.direction === "inbound") {
      setNewWhileScrolledUp(true);
    }
    if (lastMessage && lastMessage.direction === "inbound") {
      const body = lastMessage.body.trim();
      setAnnouncement(
        `New message from ${contactDisplayName(contact)}: ${body === "" ? "photo" : body}`,
      );
    }
    return () => clearTimeout(timer);
  }, [lastMessageId, lastMessage, contact, scrollToBottom]);

  // --- Render ----------------------------------------------------------------

  if (messagesQuery.isPending) {
    return <ThreadSkeleton />;
  }
  if (messagesQuery.isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load this conversation.{" "}
          <button
            type="button"
            className="font-medium text-primary underline-offset-2 hover:underline"
            onClick={() => messagesQuery.refetch()}
          >
            Try again
          </button>
        </p>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const contactName = contactDisplayName(contact);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* §5.1: in-thread filter, pinned above the scroll region, inside the
          same 42rem reading track (§1.2) as the messages and composer.
          #76: the segmented bar is desktop/tablet only — on a phone it never
          docks above the thread; filtering lives in the header's "Show" menu. */}
      <div className="hidden shrink-0 px-4 pb-1 pt-2 md:block md:px-6">
        <div className="mx-auto flex max-w-[42rem] justify-center md:justify-start">
          <ThreadFilterBar value={filter} onChange={onFilterChange} />
        </div>
      </div>
      {/* #76: on a phone, a non-default filter shows only as a slim removable
          chip — so a filtered view is never a silent one (messages never look
          deleted) — while the default "All" view shows no filter chrome at all. */}
      {filter !== "all" && (
        <div className="shrink-0 px-4 pb-1 pt-2 md:hidden">
          <div className="mx-auto flex max-w-[42rem] justify-center">
            <button
              type="button"
              onClick={() => onFilterChange("all")}
              aria-label={`Showing ${THREAD_FILTER_LABELS[filter]} only. Clear filter.`}
              className="tap-target inline-flex items-center gap-1 rounded-full bg-app-tint px-3 py-1 text-[13px] font-medium text-app-petrol-deep"
            >
              Showing {THREAD_FILTER_LABELS[filter]}
              <X className="size-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>
      )}
      {pinnedMessages.length > 0 && (
        <>
          {/* Desktop/tablet: the full always-open card (unchanged). */}
          <div className="hidden shrink-0 px-4 pb-1 md:block md:px-6">
            <div className="mx-auto w-full max-w-[42rem]">
              <PinnedBanner messages={pinnedMessages} onJump={scrollToMessage} />
            </div>
          </div>
          {/* Phone: collapsed one-line disclosure (#76). */}
          <div className="shrink-0 px-4 pb-1 pt-2 md:hidden">
            <div className="mx-auto w-full max-w-[42rem]">
              <MobilePinnedDisclosure
                messages={pinnedMessages}
                onJump={scrollToMessage}
              />
            </div>
          </div>
        </>
      )}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 md:px-6"
        aria-label={`Messages with ${contactName}`}
      >
        {messagesQuery.isFetchingNextPage && (
          <p className="py-2 text-center text-xs text-muted-foreground">
            Loading earlier messages…
          </p>
        )}
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {threadFilterEmptyCopy(filter)}
            </p>
          </div>
        ) : (
          // §1.2: the message column is a centered 42rem reading track (≈66ch)
          // inside the wide 1fr thread pane — dividers, event lines, and
          // bubbles all live in this one measure.
          <div
            className="relative mx-auto w-full max-w-[42rem]"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualItems.map((virtualItem) => {
              const item = items[virtualItem.index];
              if (!item) return null;
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="absolute inset-x-0 top-0"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  {item.kind === "divider" ? (
                    <DayDivider label={item.label} />
                  ) : item.kind === "event" ? (
                    <SystemLine
                      event={item.event}
                      memberName={memberName}
                      messageBody={messageBody}
                    />
                  ) : (
                    <div className="flex flex-col gap-0.5 py-1.5">
                      {item.messages.map((message, index) => (
                        <div
                          key={message.id}
                          className={cn(
                            // The house arrival motion (app-message-in: 200ms
                            // fade + 4px rise on --ease-out, auto-zeroed under
                            // reduced-motion) — one source of truth instead of
                            // a parallel tailwindcss-animate vocabulary (#4).
                            message.id === recentArrivalId &&
                              "app-motion-message-in",
                          )}
                        >
                          <MessageBubble
                            message={message}
                            isLastOfCluster={index === item.messages.length - 1}
                            conversationId={conversationId}
                            contactName={contactName}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {newWhileScrolledUp && !atBottom && (
        // Centering lives on the wrapper: the pill's own transform is spent by
        // the app-message-in keyframe (fade + 4px rise), so it can't also hold
        // the -translate-x-1/2. The pill now eases in instead of hard-cutting
        // into existence (#4).
        <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
          <button
            type="button"
            onClick={() => scrollToBottom("smooth")}
            className="app-motion-message-in flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors duration-150 ease-out hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            New message <ArrowDown className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      )}

      {/* Incoming messages announced politely for screen readers (G11). */}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div aria-hidden className="flex-1 space-y-4 overflow-hidden px-6 py-4">
      <Skeleton className="mx-auto h-3 w-16" />
      <div className="flex justify-start">
        <Skeleton className="h-14 w-3/5 rounded-[10px]" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-2/5 rounded-[10px]" />
      </div>
      <div className="flex justify-start">
        <Skeleton className="h-9 w-1/2 rounded-[10px]" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-16 w-3/5 rounded-[10px]" />
      </div>
    </div>
  );
}
