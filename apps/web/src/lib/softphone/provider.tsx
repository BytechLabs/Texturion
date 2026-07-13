"use client";

/**
 * D43 (#135) softphone provider — the browser IS the phone. Holds one
 * @telnyx/webrtc client for the signed-in member and the live call set
 * (phase 3: MULTI-CALL — one active, others held or ringing; call waiting is
 * hold-and-answer). Mounted once from the app shell.
 *
 * SSR-safe + lazy: the ~65KB SDK is imported dynamically (never at module
 * load, never on the server). Registration is EAGER on mount — an open app
 * is a phone that can RING, and registering is also what creates this
 * member's credential (what makes the ring engine dial them at all). A
 * registration failure is silent: texting is unaffected; the Call button
 * retries on use.
 *
 * Audio is a single hidden <audio> element carrying the ACTIVE call's remote
 * stream (one active call per member — the line model's member side). The
 * pure state machine lives in ./state (unit-tested); this file is the
 * imperative SDK glue, verified on a real device (mic + WebRTC can't run in
 * the screenshot harness).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import {
  useAuthorizeBrowserCall,
  useResolveLiveSession,
  useWebrtcToken,
} from "@/lib/api/calls";
import { ApiError } from "@/lib/api/error";

import {
  INITIAL_SOFTPHONE_STATE,
  softphoneReducer,
  type CallInfo,
  type SoftphoneState,
} from "./state";

/** The minimal slice of the @telnyx/webrtc surface we touch (kept local so the
 *  SDK types never leak into the server bundle via a top-level import). */
interface TelnyxCall {
  id: string;
  state: string;
  direction?: string; // 'inbound' | 'outbound'
  answer: () => void;
  hangup: () => void;
  hold: () => Promise<unknown>;
  unhold: () => Promise<unknown>;
  muteAudio: () => void;
  unmuteAudio: () => void;
  remoteStream?: MediaStream;
  telnyxIDs?: {
    telnyxCallControlId?: string;
    telnyxSessionId?: string;
    telnyxLegId?: string;
  };
  options?: {
    remoteCallerName?: string;
    remoteCallerNumber?: string;
  };
}
interface TelnyxClient {
  on: (event: string, handler: (payload?: unknown) => void) => void;
  connect: () => void;
  disconnect: () => void;
  newCall: (options: {
    destinationNumber: string;
    callerNumber: string;
    clientState?: string;
    audioBitrate?: number;
  }) => TelnyxCall;
}

/** At most one active + one waiting/held — a third concurrent call declines. */
const MAX_CONCURRENT_CALLS = 2;

/** A microphone-permission failure carrying a member-facing, actionable
 *  message (distinguished from an ApiError in the call catch blocks). */
class MicPermissionError extends Error {}

/**
 * Prove we can capture the microphone BEFORE any server-side effect (the line
 * reservation + billing gate in POST /calls/browser). getUserMedia raises the
 * browser's permission prompt on the click gesture; a denial — a fresh "Block",
 * a previously-remembered block (no prompt, instant throw), or a missing device
 * — throws here with a message that tells the member exactly how to recover.
 * Calling this BEFORE authorize() means a denial never strands a line
 * reservation (the "on another call" phantom) and never touches billing. The
 * tracks are released immediately; the SDK re-acquires with the now-granted
 * permission, so there is no second prompt.
 */
async function acquireMicOrThrow(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new MicPermissionError(
      "This browser can't access a microphone. Try a recent Chrome, Edge, or Safari.",
    );
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (cause) {
    const name = cause instanceof DOMException ? cause.name : "";
    throw new MicPermissionError(
      name === "NotFoundError" || name === "DevicesNotFoundError"
        ? "No microphone found. Connect or enable a mic, then try the call again."
        : name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone access is blocked. Click the 🎤 or 🔒 icon in your browser's address bar, choose Allow, then try the call again."
          : "Couldn't access your microphone. Check your browser's mic permission and try again.",
    );
  }
  for (const track of stream.getTracks()) track.stop();
}

/** Raise an OS notification for a ringing inbound call so a member whose app tab
 *  is backgrounded still notices it. Best-effort: silently no-ops where
 *  Notifications are unsupported or not granted (we never prompt here — the Web
 *  Push flow owns permission). Clicking it focuses the app. */
function showRingNotification(
  notes: Map<string, Notification>,
  id: string,
  name: string,
  number: string,
): void {
  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return;
  }
  try {
    const note = new Notification("Incoming call", {
      body: number && number !== name ? `${name} · ${number}` : name,
      tag: `call-${id}`, // collapse re-fires for the same call
    });
    note.onclick = () => {
      try {
        window.focus();
      } catch {
        /* cross-origin/embedded — ignore */
      }
      note.close();
    };
    notes.set(id, note);
  } catch {
    /* Notifications unsupported in this context — non-fatal */
  }
}

/** Dismiss a call's ring notification once it is answered or ends. */
function closeRingNotification(notes: Map<string, Notification>, id: string): void {
  const note = notes.get(id);
  if (!note) return;
  try {
    note.close();
  } catch {
    /* already gone */
  }
  notes.delete(id);
}

interface SoftphoneContextValue extends SoftphoneState {
  /** The active call's info (audio flowing), if any. */
  activeCall: CallInfo | null;
  /** Place a call from the business number. The destination comes from EXACTLY
   *  one origin: an existing thread, a contact (no thread yet), or a raw number
   *  typed into the dialer. phoneNumberId optionally picks the caller-ID number
   *  when the company owns several. */
  placeCall: (args: {
    conversationId?: string;
    contactId?: string;
    to?: string;
    phoneNumberId?: string;
    contactName: string;
  }) => Promise<void>;
  /** Answer a ringing call; any active call is put on hold first. */
  answer: (id: string) => void;
  /** Hang up one call (default: the active one). */
  hangup: (id?: string) => void;
  /** Hold/unhold flip — unholding another call swaps the active audio. */
  toggleHold: (id: string) => void;
  toggleMute: (id: string) => void;
  /** Dismiss an ended call's chip. */
  dismiss: (id: string) => void;
}

const SoftphoneContext = createContext<SoftphoneContextValue | null>(null);

export function SoftphoneProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    softphoneReducer,
    INITIAL_SOFTPHONE_STATE,
  );
  const clientRef = useRef<TelnyxClient | null>(null);
  const callsRef = useRef<Map<string, TelnyxCall>>(new Map());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const connectingRef = useRef<Promise<TelnyxClient> | null>(null);

  const authorize = useAuthorizeBrowserCall();
  const mintToken = useWebrtcToken();
  const resolveSession = useResolveLiveSession();
  const resolveRef = useRef(resolveSession);
  resolveRef.current = resolveSession;
  // Ring-leg ccids we've already resolved to a customer session — the SDK
  // fires 'active' repeatedly, and we only need to resolve once per call.
  const resolvedRef = useRef<Set<string>>(new Set());
  // Is the SDK authenticated + REGISTERED right now (able to ring)? Tracked so
  // recovery only ever acts when the phone is DOWN — it never disturbs a
  // healthy connection.
  const readyRef = useRef(false);
  const recoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // OS-level notifications for a ringing inbound call, keyed by call id — so a
  // member with the app open but the TAB BACKGROUNDED still notices the ring
  // (the in-app call bar is invisible then). Closed the moment the call is
  // answered/ends. Permission is already granted via Web Push; we never prompt.
  const ringNotesRef = useRef<Map<string, Notification>>(new Map());
  // Holds the latest recovery scheduler so the SDK event handlers (captured
  // once inside ensureClient) can reach it without a callback dependency cycle.
  const scheduleRecoverRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Tear the SDK down on unmount (sign-out / shell teardown).
    return () => {
      for (const call of callsRef.current.values()) {
        try {
          call.hangup();
        } catch {
          /* already gone */
        }
      }
      callsRef.current.clear();
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

  const attachActiveAudio = useCallback((call: TelnyxCall) => {
    if (call.remoteStream && audioRef.current) {
      audioRef.current.srcObject = call.remoteStream;
      void audioRef.current.play().catch(() => {
        /* autoplay policy — the answer/place gesture covers it */
      });
    }
  }, []);

  /** Register (or reuse) the SDK client — lazy import, single flight. */
  const ensureClient = useCallback(async (): Promise<TelnyxClient> => {
    if (clientRef.current) return clientRef.current;
    if (connectingRef.current) return connectingRef.current;

    connectingRef.current = (async () => {
      const { token } = await mintToken.mutateAsync();
      const { TelnyxRTC } = await import("@telnyx/webrtc");
      const client = new TelnyxRTC({
        login_token: token,
      }) as unknown as TelnyxClient;

      client.on("telnyx.ready", () => {
        readyRef.current = true;
        dispatch({ type: "ready" });
      });
      client.on("telnyx.error", () => {
        readyRef.current = false;
        dispatch({
          type: "error",
          message: "Calling is temporarily unavailable.",
        });
        // An error is often an auth/token failure — a fresh token + registration
        // is the recovery. The SDK's own reconnect can't fix a bad token.
        scheduleRecoverRef.current?.();
      });
      // The WebSocket dropped (network flap, backgrounded tab, server close).
      // The SDK auto-reconnects with backoff; if it exhausts, only a rebuild
      // brings the phone back. Mark down + let the recovery watchdog decide.
      client.on("telnyx.socket.close", () => {
        readyRef.current = false;
        dispatch({ type: "disconnected" });
        scheduleRecoverRef.current?.();
      });
      client.on("telnyx.notification", (payload) => {
        const note = payload as { type?: string; call?: TelnyxCall } | undefined;
        const call = note?.call;
        if (!call) return;

        if (!callsRef.current.has(call.id)) {
          // A NEW inbound invite — the ring engine (or a transfer/consult)
          // dialed this member. Beyond the member's two-call ceiling it
          // declines immediately, so the answer race resolves elsewhere
          // without waiting out the ring timeout.
          if (call.direction === "inbound" && call.state === "ringing") {
            const live = [...callsRef.current.values()].filter(
              (c) => c.state !== "destroy" && c.state !== "hangup",
            );
            if (live.length >= MAX_CONCURRENT_CALLS) {
              try {
                call.hangup();
              } catch {
                /* already gone */
              }
              return;
            }
            callsRef.current.set(call.id, call);
            const number = call.options?.remoteCallerNumber ?? "";
            const name =
              call.options?.remoteCallerName || number || "Unknown caller";
            dispatch({
              type: "incoming",
              id: call.id,
              sessionId: call.telnyxIDs?.telnyxSessionId ?? null,
              peer: { name, number },
            });
            showRingNotification(ringNotesRef.current, call.id, name, number);
          }
          return;
        }

        dispatch({
          type: "sdk_state",
          id: call.id,
          state: call.state,
          now: Date.now(),
        });
        if (call.state === "active") {
          // Single-active audio: if a DIFFERENT call was active when this one
          // connected (e.g. a still-ringing outbound leg answering while the
          // member took a second call), SDK-hold it so only one call owns the
          // audio sink — matching the reducer's structural demotion to 'held'.
          const prevActiveId = stateRef.current.activeId;
          if (prevActiveId && prevActiveId !== call.id) {
            const prev = callsRef.current.get(prevActiveId);
            void prev?.hold().catch(() => {
              /* dead leg — its end event cleans up */
            });
          }
          attachActiveAudio(call);
          if (call.direction === "inbound") {
            // The SDK session for an answered inbound call is the ring leg's,
            // not the customer's — resolve the real (customer) session so
            // transfer / consult / notes address the right calls row. Once
            // per call (the SDK re-fires 'active').
            const legCcid = call.telnyxIDs?.telnyxCallControlId;
            if (legCcid && !resolvedRef.current.has(legCcid)) {
              resolvedRef.current.add(legCcid);
              void resolveRef.current
                .mutateAsync(legCcid)
                .then((r) =>
                  dispatch({
                    type: "session_known",
                    id: call.id,
                    sessionId: r.call_session_id,
                  }),
                )
                .catch(() => {
                  // Retry allowed on a later 'active' if the ledger row hadn't
                  // landed yet; live-call ops stay disabled meanwhile.
                  resolvedRef.current.delete(legCcid);
                });
            }
          } else {
            const sessionId = call.telnyxIDs?.telnyxSessionId;
            if (sessionId) {
              dispatch({ type: "session_known", id: call.id, sessionId });
            }
          }
        }
        if (call.state === "active") {
          // Answered — the ring notification has done its job.
          closeRingNotification(ringNotesRef.current, call.id);
        }
        if (call.state === "destroy" || call.state === "hangup") {
          closeRingNotification(ringNotesRef.current, call.id);
          callsRef.current.delete(call.id);
        }
      });

      client.connect();
      clientRef.current = client;
      return client;
    })();

    try {
      return await connectingRef.current;
    } finally {
      connectingRef.current = null;
    }
  }, [attachActiveAudio, mintToken]);

  /** Tear a dead client down and build a fresh one — re-mints the token, so a
   *  NEW SIP registration is established (that's what makes the phone ring
   *  again). Never touches a live call's audio (a rebuild only runs when the
   *  socket is already down). */
  const rebuildClient = useCallback(() => {
    if (connectingRef.current) return; // a build is already in flight
    const old = clientRef.current;
    clientRef.current = null;
    readyRef.current = false;
    try {
      old?.disconnect();
    } catch {
      /* already gone */
    }
    void ensureClient().catch(() => {
      /* stays down; the next visibility/online tick retries */
    });
  }, [ensureClient]);

  /** If the phone can't currently ring, rebuild it — after a short delay so the
   *  SDK's OWN backoff reconnect wins for transient drops and we only step in
   *  when it has genuinely failed. Debounced: a burst of close/visibility/online
   *  events collapses into one rebuild. No-op while healthy. */
  const scheduleRecover = useCallback(() => {
    if (readyRef.current || connectingRef.current) return;
    if (recoverTimerRef.current) return;
    recoverTimerRef.current = setTimeout(() => {
      recoverTimerRef.current = null;
      if (!readyRef.current && !connectingRef.current) rebuildClient();
    }, 4000);
  }, [rebuildClient]);
  scheduleRecoverRef.current = scheduleRecover;

  // Eager registration: an open app is a phone that can ring.
  useEffect(() => {
    void ensureClient().catch(() => {
      /* no toast — texting is unaffected; the Call button retries on use */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount
  }, []);

  // Keep the phone ring-ready across the real-world drops the SDK can't recover
  // on its own: a tab that was backgrounded (its socket throttled/closed) coming
  // back to the foreground, and the network returning. Both only rebuild when
  // the phone is actually down (scheduleRecover no-ops while healthy).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleRecover();
    };
    const onOnline = () => scheduleRecover();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      if (recoverTimerRef.current) clearTimeout(recoverTimerRef.current);
    };
  }, [scheduleRecover]);

  // The reducer state, readable from stable callbacks without re-binding.
  const stateRef = useRef(state);
  stateRef.current = state;

  /** Hold the currently-active call (before answering/placing another). */
  const holdActive = useCallback(() => {
    const activeId = stateRef.current.activeId;
    if (!activeId) return;
    const call = callsRef.current.get(activeId);
    if (!call) return;
    void call.hold().catch(() => {
      /* dead leg — its end event cleans up */
    });
    dispatch({ type: "held", id: activeId, held: true });
  }, []);

  const placeCall = useCallback(
    async ({
      conversationId,
      contactId,
      to,
      phoneNumberId,
      contactName,
    }: {
      conversationId?: string;
      contactId?: string;
      to?: string;
      phoneNumberId?: string;
      contactName: string;
    }) => {
      const live = stateRef.current.calls.filter((c) => c.phase !== "ended");
      if (live.length >= MAX_CONCURRENT_CALLS) return;
      try {
        // Mic FIRST — before we reserve the line. A denial here never strands a
        // reservation (no "on another call" phantom), never bills, and surfaces
        // an actionable message instead of a silent "ended".
        await acquireMicOrThrow();
        // Authorize (gates + line busy) — a refusal never spins up audio. The
        // server resolves the destination from whichever origin is set.
        const auth = await authorize.mutateAsync({
          conversation_id: conversationId,
          contact_id: contactId,
          to,
          phone_number_id: phoneNumberId,
        });
        holdActive();
        const client = await ensureClient();
        const call = client.newCall({
          destinationNumber: auth.to,
          callerNumber: auth.from,
          clientState: auth.client_state,
        });
        callsRef.current.set(call.id, call);
        dispatch({
          type: "placing",
          id: call.id,
          sessionId: call.telnyxIDs?.telnyxSessionId ?? null,
          peer: { name: contactName, number: auth.to },
        });
      } catch (cause) {
        dispatch({
          type: "error",
          message:
            cause instanceof MicPermissionError || cause instanceof ApiError
              ? cause.message
              : "Couldn't start the call.",
        });
        throw cause;
      }
    },
    [authorize, ensureClient, holdActive],
  );

  const answer = useCallback(
    async (id: string) => {
      const call = callsRef.current.get(id);
      if (!call) return;
      // Answering also needs the mic — surface a clear reason (not a dead
      // chip) if it's blocked, and don't hold the active call for an answer
      // that can't capture audio.
      try {
        await acquireMicOrThrow();
      } catch (cause) {
        dispatch({
          type: "error",
          message:
            cause instanceof MicPermissionError
              ? cause.message
              : "Couldn't answer the call.",
        });
        return;
      }
      holdActive();
      try {
        call.answer();
      } catch {
        /* the caller hung up in the same instant — the chip clears itself */
      }
    },
    [holdActive],
  );

  const hangup = useCallback((id?: string) => {
    const targetId = id ?? stateRef.current.activeId;
    if (!targetId) return;
    const call = callsRef.current.get(targetId);
    try {
      call?.hangup();
    } catch {
      /* already gone */
    }
  }, []);

  const toggleHold = useCallback((id: string) => {
    const info = stateRef.current.calls.find((c) => c.id === id);
    const call = callsRef.current.get(id);
    if (!info || !call) return;
    if (info.phase === "held") {
      // Unholding swaps: anything currently active goes on hold first.
      const activeId = stateRef.current.activeId;
      if (activeId && activeId !== id) {
        const active = callsRef.current.get(activeId);
        void active?.hold().catch(() => {});
        dispatch({ type: "held", id: activeId, held: true });
      }
      void call
        .unhold()
        .then(() => attachActiveAudio(call))
        .catch(() => {});
      dispatch({ type: "held", id, held: false });
    } else if (info.phase === "active") {
      void call.hold().catch(() => {});
      dispatch({ type: "held", id, held: true });
    }
  }, [attachActiveAudio]);

  const toggleMute = useCallback((id: string) => {
    const info = stateRef.current.calls.find((c) => c.id === id);
    const call = callsRef.current.get(id);
    if (!info || !call) return;
    if (info.muted) {
      call.unmuteAudio();
      dispatch({ type: "muted", id, muted: false });
    } else {
      call.muteAudio();
      dispatch({ type: "muted", id, muted: true });
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => dispatch({ type: "dismissed", id }),
    [],
  );

  const activeCall = state.calls.find((c) => c.id === state.activeId) ?? null;

  return (
    <SoftphoneContext.Provider
      value={{
        ...state,
        activeCall,
        placeCall,
        answer,
        hangup,
        toggleHold,
        toggleMute,
        dismiss,
      }}
    >
      {children}
      {/* The single remote-audio sink; hidden, always mounted. */}
      <audio ref={audioRef} autoPlay className="sr-only" aria-hidden />
    </SoftphoneContext.Provider>
  );
}

/** Access the softphone. Returns null outside the provider (SSR / tests that
 *  don't mount it) so callers can no-op gracefully. */
export function useSoftphone(): SoftphoneContextValue | null {
  return useContext(SoftphoneContext);
}
