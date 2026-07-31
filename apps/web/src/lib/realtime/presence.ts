"use client";

import {
  PRESENCE_HEARTBEAT_MS,
  TYPING_THROTTLE_MS,
  TYPING_TTL_MS,
  presenceFor,
  type PresenceEntry,
  type Viewer,
} from "@loonext/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * #302 — who else is on this conversation, and are they replying.
 *
 * THE CHANNEL IS ITS OWN, and that is deliberate rather than incidental. The
 * number topic every client already joins is built and torn down by
 * `provider.tsx` under rules that took #480 and #483 to get right — it is
 * recreated under the same name whenever the joined-number set changes. Presence
 * tracked on that channel would be dropped by an effect that knows nothing about
 * presence, and `supabase.channel(topic)` hands back the EXISTING channel, so
 * this hook cannot safely ask for the same one. `:presence` is authorized by the
 * same rule and the same number access (#302 migration), so the boundary is
 * identical and the lifecycles are not entangled.
 *
 * WHAT MAKES IT HONEST. `healthy` is threaded into the shared rule rather than
 * assumed: on a channel that is not SUBSCRIBED the answer is "we do not know",
 * and the honest render of that is nothing at all. Showing the last known
 * viewers would assert a colleague is here on the strength of information we
 * know we have stopped receiving — which produces the nobody-replies failure
 * #302 exists to fix, in the other direction.
 *
 * ADVISORY ONLY. Nothing here blocks anything. The person holding a lock walks
 * into a basement and the customer waits.
 */
export function useConversationPresence(options: {
  companyId: string | null | undefined;
  phoneNumberId: string | null | undefined;
  conversationId: string | null | undefined;
  selfUserId: string | null | undefined;
  displayName: string | null | undefined;
}): { viewers: Viewer[]; onTyping: () => void } {
  const { companyId, phoneNumberId, conversationId, selfUserId, displayName } =
    options;

  const [entries, setEntries] = useState<PresenceEntry[]>([]);
  const [healthy, setHealthy] = useState(false);
  const [, forceTick] = useState(0);

  /**
   * The live `track` for this channel, so the typing callback can re-announce
   * without re-subscribing. Null whenever no channel is up, which is what makes
   * `onTyping` safe to call from a keystroke handler unconditionally.
   */
  const trackRef = useRef<((typing: boolean) => void) | null>(null);
  const lastTypingSentRef = useRef(0);
  const typingUntilRef = useRef(0);

  useEffect(() => {
    if (!companyId || !phoneNumberId || !conversationId || !selfUserId) return;
    // Captured after the guard: the closures below outlive this tick, and the
    // narrowing on the props does not travel into them.
    const conversation = conversationId;
    const me = selfUserId;
    const name = displayName ?? "";

    const supabase = getSupabaseBrowser();
    const topic = `company:${companyId}:number:${phoneNumberId}:presence`;
    const channel = supabase.channel(topic, {
      config: {
        private: true,
        // Keyed by user id so one person on two devices is one presence key
        // per device but collapses in the shared rule — and so a reconnect
        // replaces its own entry rather than doubling it.
        presence: { key: me },
      },
    });

    function announce(typing: boolean) {
      void channel.track({
        user_id: me,
        display_name: name,
        conversation_id: conversation,
        typing,
        at: Date.now(),
      } satisfies PresenceEntry);
    }
    trackRef.current = announce;

    function readState() {
      // realtime-js returns { [key]: payload[] }. Every payload is one device.
      const state = channel.presenceState<PresenceEntry>();
      setEntries(Object.values(state).flat() as PresenceEntry[]);
    }

    channel
      .on("presence", { event: "sync" }, readState)
      .on("presence", { event: "join" }, readState)
      .on("presence", { event: "leave" }, readState)
      .subscribe((status) => {
        const up = status === "SUBSCRIBED";
        setHealthy(up);
        if (up) announce(false);
        // Anything other than SUBSCRIBED means we are no longer being told who
        // is here. Drop what we have rather than letting it age on screen.
        if (!up) setEntries([]);
      });

    // Re-announce inside the TTL. This is the heartbeat the shared rule's
    // staleness check is measured against: a tab that stops running stops
    // speaking, and its viewer disappears for everybody else on their next
    // evaluation — no server, no cleanup job.
    const heartbeat = window.setInterval(() => {
      announce(Date.now() < typingUntilRef.current);
    }, PRESENCE_HEARTBEAT_MS);

    return () => {
      window.clearInterval(heartbeat);
      trackRef.current = null;
      void channel.untrack();
      void supabase.removeChannel(channel);
      setEntries([]);
      setHealthy(false);
    };
  }, [companyId, phoneNumberId, conversationId, selfUserId, displayName]);

  /**
   * Re-evaluate on a timer as well as on channel events.
   *
   * Without this a viewer who simply stops speaking stays on screen until the
   * next join/leave, which on a quiet thread may be never — the exact stale
   * presence #302 calls worse than none. The tick is cheap and does not fetch.
   */
  useEffect(() => {
    if (!healthy) return;
    const tick = window.setInterval(() => forceTick((n) => n + 1), 5_000);
    return () => window.clearInterval(tick);
  }, [healthy]);

  /**
   * Called on each keystroke. Throttled: the keystroke rate is not the
   * broadcast rate, and #251 has never measured this fan-out.
   */
  const onTyping = useCallback(() => {
    typingUntilRef.current = Date.now() + TYPING_TTL_MS;
    const now = Date.now();
    if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentRef.current = now;
    trackRef.current?.(true);
  }, []);

  const viewers = presenceFor(entries, {
    conversationId: conversationId ?? "",
    selfUserId: selfUserId ?? "",
    now: Date.now(),
    healthy,
  });

  return { viewers, onTyping };
}
