"use client";

import { createContext, useContext, useRef } from "react";
import type { MouseEvent, RefObject } from "react";

interface NavigationFocusRequest {
  conversationId: string;
  headingPending: boolean;
  searchResultId?: string;
}

type NavigationFocus = RefObject<NavigationFocusRequest | null>;

const InboxFocusContext = createContext<NavigationFocus | null>(null);

export function InboxFocusProvider({ children }: { children: React.ReactNode }) {
  const request = useRef<NavigationFocusRequest | null>(null);
  return <InboxFocusContext.Provider value={request}>{children}</InboxFocusContext.Provider>;
}

export function useInboxFocus(): NavigationFocus | null {
  return useContext(InboxFocusContext);
}

export function queueThreadHeading(
  focus: NavigationFocus | null,
  conversationId: string,
  searchResultId?: string,
) {
  if (focus) focus.current = { conversationId, headingPending: true, searchResultId };
}

export function trackThreadLinkFocus(
  event: MouseEvent<HTMLAnchorElement>,
  focus: NavigationFocus | null,
  conversationId: string,
  active: boolean,
  searchResultId?: string,
) {
  if (!focus || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (event.detail !== 0) {
    focus.current = null;
  } else if (!active) {
    queueThreadHeading(focus, conversationId, searchResultId);
  }
}
