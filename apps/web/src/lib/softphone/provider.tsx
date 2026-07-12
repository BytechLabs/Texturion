"use client";

/**
 * D43 (#135) softphone provider — the browser IS the phone. Holds one
 * @telnyx/webrtc client for the signed-in member and exposes placing/ending a
 * call. Mounted once from the app shell.
 *
 * SSR-safe + lazy: the ~65KB SDK is imported dynamically the first time a call
 * is placed (never at module load, never on the server), so it never touches
 * the OpenNext server bundle and never delays first paint. The client
 * registers on first use with a short-lived JWT from POST /v1/webrtc/token and
 * stays registered between calls; a mid-session auth failure re-mints.
 *
 * Audio is a single hidden <audio> element the SDK's remote stream is attached
 * to. The state machine lives in ./state (unit-tested); this file is the
 * imperative SDK glue, which is verified on a real device (mic + WebRTC can't
 * be exercised in the screenshot harness).
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

import { useAuthorizeBrowserCall, useWebrtcToken } from "@/lib/api/calls";
import { ApiError } from "@/lib/api/error";

import {
  INITIAL_SOFTPHONE_STATE,
  softphoneReducer,
  type SoftphoneState,
} from "./state";

/** The minimal slice of the @telnyx/webrtc surface we touch (kept local so the
 *  SDK types never leak into the server bundle via a top-level import). */
interface TelnyxCall {
  state: string;
  direction?: string; // 'inbound' | 'outbound'
  answer: () => void;
  hangup: () => void;
  muteAudio: () => void;
  unmuteAudio: () => void;
  remoteStream?: MediaStream;
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

interface SoftphoneContextValue extends SoftphoneState {
  /** Place a call to the conversation's customer from the business number. */
  placeCall: (args: {
    conversationId: string;
    contactName: string;
  }) => Promise<void>;
  /** Answer the ringing inbound call (phase 'ringing'). */
  answer: () => void;
  hangup: () => void;
  toggleMute: () => void;
  /** Dismiss the "Call ended" bar. */
  clear: () => void;
}

const SoftphoneContext = createContext<SoftphoneContextValue | null>(null);

export function SoftphoneProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    softphoneReducer,
    INITIAL_SOFTPHONE_STATE,
  );
  const clientRef = useRef<TelnyxClient | null>(null);
  const callRef = useRef<TelnyxCall | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const connectingRef = useRef<Promise<TelnyxClient> | null>(null);

  const authorize = useAuthorizeBrowserCall();
  const mintToken = useWebrtcToken();

  useEffect(() => {
    // Tear the SDK down on unmount (sign-out / shell teardown).
    return () => {
      try {
        callRef.current?.hangup();
      } catch {
        /* already gone */
      }
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

  // D43 phase 2: register EAGERLY — an open app is a phone that can RING.
  // (Registration is also what creates this member's credential, which is
  // what makes the ring engine dial them at all.) Failure is silent: a
  // workspace without a live subscription simply doesn't become a phone,
  // and outbound attempts re-try via their own ensureClient path.
  useEffect(() => {
    void ensureClient().catch(() => {
      /* no toast — texting is unaffected; the Call button retries on use */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount
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
        if (call !== callRef.current) {
          // D43 phase 2: a NEW inbound invite — the ring engine dialed this
          // member's credential. One live call per member: if a call is
          // already up, decline immediately (the leg fails fast, so the
          // answer race resolves to another member or voicemail without
          // waiting out the ring timeout). Phase 3 brings call waiting.
          if (call.direction === "inbound" && call.state === "ringing") {
            if (callRef.current) {
              try {
                call.hangup();
              } catch {
                /* already gone */
              }
              return;
            }
            callRef.current = call;
            const number = call.options?.remoteCallerNumber ?? "";
            dispatch({
              type: "incoming",
              peer: {
                name: call.options?.remoteCallerName || number || "Unknown caller",
                number,
              },
            });
          }
          return;
        }
        dispatch({ type: "sdk_state", state: call.state, now: Date.now() });
        // Attach remote audio once the media is flowing.
        if (call.state === "active" && call.remoteStream && audioRef.current) {
          audioRef.current.srcObject = call.remoteStream;
          void audioRef.current.play().catch(() => {
            /* autoplay policy — the answer/place gesture covers it */
          });
        }
        if (call.state === "destroy" || call.state === "hangup") {
          callRef.current = null;
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
  }, [mintToken]);

  const placeCall = useCallback(
    async ({
      conversationId,
      contactName,
    }: {
      conversationId: string;
      contactName: string;
    }) => {
      if (state.phase === "connecting" || state.phase === "active") return;
      try {
        // Authorize FIRST (gates + line-busy) — a refusal never spins up audio.
        const auth = await authorize.mutateAsync(conversationId);
        dispatch({
          type: "placing",
          peer: { name: contactName, number: auth.to },
        });
        const client = await ensureClient();
        const call = client.newCall({
          destinationNumber: auth.to,
          callerNumber: auth.from,
          clientState: auth.client_state,
        });
        callRef.current = call;
      } catch (cause) {
        dispatch({
          type: "error",
          message:
            cause instanceof ApiError
              ? cause.message
              : "Couldn't start the call.",
        });
        dispatch({ type: "cleared" });
        throw cause;
      }
    },
    [authorize, ensureClient, state.phase],
  );

  const answer = useCallback(() => {
    try {
      callRef.current?.answer();
    } catch {
      /* the caller hung up in the same instant — the ring bar clears itself */
    }
  }, []);

  const hangup = useCallback(() => {
    try {
      callRef.current?.hangup();
    } catch {
      /* already gone */
    }
  }, []);

  const toggleMute = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    if (state.muted) {
      call.unmuteAudio();
      dispatch({ type: "muted", muted: false });
    } else {
      call.muteAudio();
      dispatch({ type: "muted", muted: true });
    }
  }, [state.muted]);

  const clear = useCallback(() => dispatch({ type: "cleared" }), []);

  return (
    <SoftphoneContext.Provider
      value={{ ...state, placeCall, answer, hangup, toggleMute, clear }}
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
