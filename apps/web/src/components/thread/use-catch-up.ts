"use client";

import { useMemo, useState } from "react";

import { useMessages } from "@/lib/api/messages";
import { flattenPages } from "@/lib/api/pagination";
import { offerThreadSummary } from "@/lib/api/thread-summary";
import type { Message } from "@/lib/api/types";

const SEEN_KEY_PREFIX = "loonext:catch-up-seen:";

/**
 * The newest message the composer's hint has been answered for, by Recap or
 * Not now. Session storage, so a reload keeps the answer and a new tab or a
 * new day asks again.
 */
function readSeen(conversationId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(SEEN_KEY_PREFIX + conversationId);
  } catch {
    return null;
  }
}

function writeSeen(conversationId: string, messageId: string): void {
  try {
    window.sessionStorage.setItem(SEEN_KEY_PREFIX + conversationId, messageId);
  } catch {
    // Losing it only means the hint comes back once more.
  }
}

function newest(messages: readonly Message[]): Message | undefined {
  let latest: Message | undefined;
  for (const message of messages) {
    if (latest === undefined) {
      latest = message;
      continue;
    }
    const at = Date.parse(message.created_at);
    const latestAt = Date.parse(latest.created_at);
    if (at > latestAt || (at === latestAt && message.id > latest.id)) {
      latest = message;
    }
  }
  return latest;
}

interface CatchUpState {
  conversationId: string;
  /** Bumped by every ask; the card asks Lou when it changes. */
  asked: number;
  /** The `asked` value the card was last dismissed at. */
  closed: number;
  seen: string | null;
}

function initialState(conversationId: string): CatchUpState {
  return { conversationId, asked: 0, closed: 0, seen: readSeen(conversationId) };
}

/**
 * #716: whether this thread offers a catch-up, and who has asked for one.
 *
 * Owned by the thread view because three places read it: the header menu and
 * the composer hint ask, and the card above the stream answers. The offer is
 * the same shared rule the card always used, fed the customer-visible half of
 * the loaded thread (notes are not part of what Lou reads).
 *
 * The hint is quieter than the offer. It hides once somebody answers it, and
 * comes back only when a message they did not send themselves arrives: their
 * own reply is not news they need a recap of.
 */
export function useCatchUp(conversationId: string, viewerId: string | undefined) {
  const messages = useMessages(conversationId);
  const visible = useMemo(
    () =>
      flattenPages(messages.data).filter(
        (m) => m.direction === "inbound" || m.direction === "outbound",
      ),
    [messages.data],
  );
  const newestMessageId = useMemo(() => newest(visible)?.id, [visible]);
  const newestNotMineId = useMemo(
    () =>
      newest(
        viewerId === undefined
          ? visible
          : visible.filter((m) => m.sent_by_user_id !== viewerId),
      )?.id,
    [visible, viewerId],
  );
  // Not memoised: the rule reads the clock, and a thread can cross the idle
  // threshold while nothing in it changes.
  const offered = offerThreadSummary(visible);

  const [stored, setStored] = useState(() => initialState(conversationId));
  // A different thread starts from nothing asked, so a token from the last one
  // can never make this one's card spend a call.
  let state = stored;
  if (stored.conversationId !== conversationId) {
    state = initialState(conversationId);
    setStored(state);
  }

  const markSeen = (current: CatchUpState): CatchUpState => {
    if (newestNotMineId === undefined) return current;
    writeSeen(conversationId, newestNotMineId);
    return { ...current, seen: newestNotMineId };
  };

  const recapOpen = state.asked > state.closed;

  return {
    offered,
    /** The newest customer-visible message, which the card watches for staleness. */
    newestMessageId,
    askToken: state.asked,
    hintShown:
      offered &&
      !recapOpen &&
      newestNotMineId !== undefined &&
      state.seen !== newestNotMineId,
    ask: () =>
      setStored((current) => markSeen({ ...current, asked: current.asked + 1 })),
    notNow: () => setStored((current) => markSeen(current)),
    recapClosed: () =>
      setStored((current) => ({ ...current, closed: current.asked })),
  };
}
