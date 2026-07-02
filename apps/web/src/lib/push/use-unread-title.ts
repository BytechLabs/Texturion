"use client";

/**
 * useUnreadTitle — the G9 unread indicators: keeps `document.title` prefixed
 * with the unread conversation count (`(3) Inbox — JobText`) and swaps the
 * SVG favicon to the dotted variant while anything is unread.
 *
 * Driven by the conversations unread data (G12: one source of truth): it
 * mounts the default inbox list query — the exact same key the inbox screen
 * uses, so they share one cache entry that realtime keeps patched — and
 * recomputes from EVERY cached conversation list on any cache change,
 * deduplicating by conversation id.
 *
 * Mounted app-wide (inside the company shell) by
 * components/notifications/unread-title-manager.tsx.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useConversations } from "@/lib/api/conversations";
import { keys } from "@/lib/api/keys";
import { useCompanyId } from "@/lib/company/provider";

import {
  countUnreadConversations,
  createTitleController,
  faviconHref,
  type UnreadCountableList,
} from "./title";

/** The <link rel="icon"> the manager owns (the SVG one from app metadata). */
function svgFaviconLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>(
    'link[rel="icon"][type="image/svg+xml"]',
  );
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    document.head.appendChild(link);
  }
  return link;
}

export function useUnreadTitle(): number {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  // Remembers exactly what it wrote, so page-authored titles (including ones
  // that legitimately start with parentheses) are never mis-stripped.
  const [controller] = useState(createTitleController);

  // Keep the default inbox list alive everywhere in the shell so the count
  // exists on /settings, /contacts, … — same query key as the inbox screen's
  // unfiltered list (normalizeFilters({}) === {}), so no extra traffic when
  // the inbox is open, and realtime patches reach it either way.
  useConversations({});

  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    let disposed = false;
    let scheduled = false;
    const compute = () => {
      const lists = cache
        .findAll({ queryKey: keys.conversations.lists(companyId) })
        .map((query) => query.state.data as UnreadCountableList | undefined);
      setUnread(countUnreadConversations(lists));
    };
    // Cache events fire synchronously — including from inside ANOTHER
    // component's render (list components seed queries while rendering).
    // setState there is a React error ("Cannot update a component while
    // rendering a different component"), so recomputes are deferred to a
    // microtask, which also coalesces event bursts into one recompute.
    const scheduleCompute = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!disposed) compute();
      });
    };
    compute();
    // QueryCache events fire for every setQueryData/refetch — filter down to
    // this company's conversation lists before recomputing.
    const unsubscribe = cache.subscribe((event) => {
      const key = event.query.queryKey as readonly unknown[];
      if (
        key[0] === companyId &&
        key[1] === "conversations" &&
        key[2] === "list"
      ) {
        scheduleCompute();
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [companyId, queryClient]);

  // Title prefix. The observer re-applies it when a route change rewrites
  // <title>; apply() is a no-op when the title already matches, so the
  // observer can never feed itself.
  useEffect(() => {
    const apply = () => {
      const next = controller.next(document.title, unread);
      if (document.title !== next) document.title = next;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [controller, unread]);

  // Favicon dot (G9).
  useEffect(() => {
    const link = svgFaviconLink();
    const href = faviconHref(unread);
    if (!link.href.endsWith(href)) link.href = href;
  }, [unread]);

  // Leaving the shell (sign-out, company switch unmount): restore neutrals.
  useEffect(
    () => () => {
      document.title = controller.restore(document.title);
      svgFaviconLink().href = faviconHref(0);
    },
    [controller],
  );

  return unread;
}
