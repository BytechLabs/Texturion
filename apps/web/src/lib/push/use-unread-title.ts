"use client";

/**
 * useUnreadTitle — the G9 unread indicators: keeps `document.title` prefixed
 * with the unread conversation count (`(3) Inbox — JobText`) and swaps the
 * SVG favicon to the dotted variant while anything is unread.
 *
 * Driven by the conversations unread data (G12: one source of truth): the
 * shared useUnreadConversationCount hook mounts the default inbox list query
 * — the exact same key the inbox screen uses, so they share one cache entry
 * that realtime keeps patched — and recomputes from EVERY cached conversation
 * list on any cache change, deduplicating by conversation id. This hook layers
 * the title-prefix + favicon side effects on top of that count.
 *
 * Mounted app-wide (inside the company shell) by
 * components/notifications/unread-title-manager.tsx.
 */
import { useEffect, useState } from "react";

import { createTitleController, faviconHref } from "./title";
import { useUnreadConversationCount } from "./use-unread-count";

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
  // Remembers exactly what it wrote, so page-authored titles (including ones
  // that legitimately start with parentheses) are never mis-stripped.
  const [controller] = useState(createTitleController);

  // The single derived unread count (shared with the nav-rail numeral).
  const unread = useUnreadConversationCount();

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
