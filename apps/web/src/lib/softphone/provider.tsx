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

interface SoftphoneContextValue extends SoftphoneState {
  /** The active call's info (audio flowing), if any. */
  activeCall: CallInfo | null;
  /** Place a call to the conversation's customer from the business number. */
  placeCall: (args: {
    conversationId: string;
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

      client.on("telnyx.ready", () => dispatch({ type: "ready" }));
      client.on("telnyx.error", () =>
        dispatch({
          type: "error",
          message: "Calling is temporarily unavailable.",
        }),
      );
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
            dispatch({
              type: "incoming",
              id: call.id,
              sessionId: call.telnyxIDs?.telnyxSessionId ?? null,
              peer: {
                name:
                  call.options?.remoteCallerName || number || "Unknown caller",
                number,
              },
            });
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
          attachActiveAudio(call);
          if (call.direction === "inbound") {
            // The SDK session for an answered inbound call is the ring leg's,
            // not the customer's — resolve the real (customer) session so
            // transfer / consult / notes address the right calls row.
            const legCcid = call.telnyxIDs?.telnyxCallControlId;
            if (legCcid) {
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
                  /* live-call ops stay disabled for this call; audio is fine */
                });
            }
          } else {
            const sessionId = call.telnyxIDs?.telnyxSessionId;
            if (sessionId) {
              dispatch({ type: "session_known", id: call.id, sessionId });
            }
          }
        }
        if (call.state === "destroy" || call.state === "hangup") {
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

  // Eager registration: an open app is a phone that can ring.
  useEffect(() => {
    void ensureClient().catch(() => {
      /* no toast — texting is unaffected; the Call button retries on use */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount
  }, []);

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
      contactName,
    }: {
      conversationId: string;
      contactName: string;
    }) => {
      const live = stateRef.current.calls.filter((c) => c.phase !== "ended");
      if (live.length >= MAX_CONCURRENT_CALLS) return;
      try {
        // Authorize FIRST (gates + line busy) — a refusal never spins up audio.
        const auth = await authorize.mutateAsync(conversationId);
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
            cause instanceof ApiError
              ? cause.message
              : "Couldn't start the call.",
        });
        throw cause;
      }
    },
    [authorize, ensureClient, holdActive],
  );

  const answer = useCallback(
    (id: string) => {
      const call = callsRef.current.get(id);
      if (!call) return;
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
