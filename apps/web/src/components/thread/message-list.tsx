"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
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
import { useMessages } from "@/lib/api/messages";
import { flattenPages } from "@/lib/api/pagination";
import type { Message } from "@/lib/api/types";
import { contactDisplayName } from "@/lib/format/phone";
import { cn } from "@/lib/utils";

import { buildThreadItems, type ThreadItem } from "./clusters";
import { MessageBubble } from "./message-bubble";
import { DayDivider, SystemLine } from "./system-line";

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
}: {
  conversationId: string;
  contact: { name: string | null; phone_e164: string };
}) {
  const messagesQuery = useMessages(conversationId);
  const eventsQuery = useConversationEvents(conversationId);
  const memberNames = useMemberNames();

  const messages = useMemo(
    () => flattenPages(messagesQuery.data).slice().sort(byChronology),
    [messagesQuery.data],
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

  const items: ThreadItem[] = useMemo(
    () => buildThreadItems(messages, visibleEvents),
    [messages, visibleEvents],
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
              No messages yet — say hello below.
            </p>
          </div>
        ) : (
          <div
            className="relative w-full"
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
                    <SystemLine event={item.event} memberName={memberName} />
                  ) : (
                    <div className="flex flex-col gap-0.5 py-1.5">
                      {item.messages.map((message, index) => (
                        <div
                          key={message.id}
                          className={cn(
                            message.id === recentArrivalId &&
                              "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200",
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
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className={cn(
            "absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg transition-transform duration-150 ease-out hover:bg-primary/90",
          )}
        >
          New message <ArrowDown className="size-3.5" strokeWidth={1.75} />
        </button>
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
