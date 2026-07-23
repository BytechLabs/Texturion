/**
 * D43 (#135) softphone state — the pure, SDK-agnostic call model. Separated
 * from the provider so it is unit-testable without @telnyx/webrtc, a browser,
 * or a mic (the audio itself needs real-device verification; the STATE
 * transitions do not).
 *
 * Phase 3 makes this MULTI-CALL (call waiting): the state holds a small list
 * of calls — at most one ACTIVE (audio flowing), the rest held or ringing.
 * The rules mirror the line model's member side: one active call per member,
 * flip freely between a held call and an incoming one. A ringing inbound
 * call that ends un-answered vanishes silently (another member won the race
 * or the caller gave up — not this member's "Call ended" moment).
 */

/** One call's UI phase. 'held' is a client-side state (SDK hold). */
export type CallPhase =
  | "ringing" // INBOUND invite — Answer / Decline
  | "connecting" // placed, ringing the far side (SDK new/trying/ringing)
  | "active" // connected, audio flowing
  | "held" // connected, on hold (SDK hold — the far side stays connected)
  | "ended"; // hangup/destroy — a brief "Call ended" chip

/** Map a raw @telnyx/webrtc call.state string to a phase (outbound view). */
export function phaseFromSdkState(state: string): CallPhase {
  switch (state) {
    case "new":
    case "trying":
    case "requesting":
    case "recovering":
    case "ringing":
    case "early":
      return "connecting";
    case "active":
      return "active";
    case "held":
      return "held";
    case "hangup":
    case "destroy":
    case "purge":
      return "ended";
    default:
      return "connecting";
  }
}

/** A call's SDK state is terminal once the session is being torn down. The
 *  recovery watchdog keys off this: a call in any NON-terminal state still owns
 *  its client's media, so the client must not be rebuilt underneath it (#138).
 *  Mirrors the "ended" arm of {@link phaseFromSdkState} — `purge` counts, so a
 *  purged-but-not-yet-deleted call never wedges the watchdog open. */
export function isTerminalSdkState(state: string): boolean {
  return state === "hangup" || state === "destroy" || state === "purge";
}

/**
 * #211 outbound parity: pick the session id to seed a placed call with. The
 * server-minted, nonce-bound S (returned from POST /calls/browser and echoed in
 * client_state part-4) IS the id the calls row, the DO, and every live-call op
 * key on, so it wins. The SDK's telnyx session id (T, which is NOT S) is only
 * a nil-safe fallback for an old server that returned no call_session_id (a
 * pre-#211 worker, or a call left on the 3-part legacy tag). Null when neither
 * is known yet.
 */
export function sessionIdForPlacedCall(
  serverSessionId: string | null | undefined,
  sdkSessionId: string | null | undefined,
): string | null {
  return serverSessionId ?? sdkSessionId ?? null;
}

export interface CallInfo {
  /** The SDK call's id — the provider's map key. */
  id: string;
  /** Telnyx call_session_id once known — the server-side handle (transfers,
   *  conversation lookup). */
  sessionId: string | null;
  peer: { name: string; number: string };
  direction: "inbound" | "outbound";
  phase: CallPhase;
  muted: boolean;
  /** Unix ms this call went active first — the live timer's anchor. */
  activeSince: number | null;
}

export interface SoftphoneState {
  /** false until the SDK has registered (telnyx.ready). */
  ready: boolean;
  /** A registration/auth error the UI surfaces (never blocks texting). */
  error: string | null;
  calls: CallInfo[];
  /** The call whose audio is flowing (at most one). */
  activeId: string | null;
}

export const INITIAL_SOFTPHONE_STATE: SoftphoneState = {
  ready: false,
  error: null,
  calls: [],
  activeId: null,
};

export type SoftphoneAction =
  | { type: "ready" }
  | { type: "disconnected" }
  | { type: "error"; message: string }
  | {
      type: "placing";
      id: string;
      sessionId: string | null;
      peer: { name: string; number: string };
    }
  | {
      type: "incoming";
      id: string;
      sessionId: string | null;
      peer: { name: string; number: string };
    }
  | { type: "session_known"; id: string; sessionId: string }
  | { type: "sdk_state"; id: string; state: string; now: number }
  | { type: "held"; id: string; held: boolean }
  | { type: "muted"; id: string; muted: boolean }
  | { type: "dismissed"; id: string };

function updateCall(
  state: SoftphoneState,
  id: string,
  patch: Partial<CallInfo>,
): SoftphoneState {
  return {
    ...state,
    calls: state.calls.map((call) =>
      call.id === id ? { ...call, ...patch } : call,
    ),
  };
}

/** Make `id` the single ACTIVE call (audio flowing) — demoting ANY other
 *  call currently 'active' to 'held'. Enforces the one-active-audio invariant
 *  structurally, so a call that answers while another is live (e.g. a still-
 *  ringing outbound leg connecting while the member took a second call) can
 *  never leave two calls fighting for the single audio sink. The provider
 *  SDK-holds the demoted call to match. */
function activate(
  state: SoftphoneState,
  id: string,
  now: number,
): SoftphoneState {
  return {
    ...state,
    calls: state.calls.map((call) => {
      if (call.id === id) {
        return {
          ...call,
          phase: "active" as const,
          activeSince: call.activeSince ?? now,
        };
      }
      if (call.phase === "active") return { ...call, phase: "held" as const };
      return call;
    }),
    activeId: id,
  };
}

export function softphoneReducer(
  state: SoftphoneState,
  action: SoftphoneAction,
): SoftphoneState {
  switch (action.type) {
    case "ready":
      return { ...state, ready: true, error: null };
    case "disconnected":
      // The socket dropped — the phone can't ring until it re-registers. Recovery
      // (visibility/online/backoff) flips this back to ready.
      return state.ready ? { ...state, ready: false } : state;
    case "error":
      return { ...state, error: action.message };
    case "placing": {
      const call: CallInfo = {
        id: action.id,
        sessionId: action.sessionId,
        peer: action.peer,
        direction: "outbound",
        phase: "connecting",
        muted: false,
        activeSince: null,
      };
      return {
        ...state,
        error: null,
        calls: [...state.calls.filter((c) => c.phase !== "ended"), call],
        activeId: action.id,
      };
    }
    case "incoming": {
      if (state.calls.some((c) => c.id === action.id)) return state;
      const call: CallInfo = {
        id: action.id,
        sessionId: action.sessionId,
        peer: action.peer,
        direction: "inbound",
        phase: "ringing",
        muted: false,
        activeSince: null,
      };
      return {
        ...state,
        calls: [...state.calls.filter((c) => c.phase !== "ended"), call],
      };
    }
    case "session_known":
      return updateCall(state, action.id, { sessionId: action.sessionId });
    case "sdk_state": {
      const call = state.calls.find((c) => c.id === action.id);
      if (!call) return state;
      const phase = phaseFromSdkState(action.state);
      // An un-answered inbound ring: early SDK states must not morph the
      // Answer/Decline chip, and its end is a SILENT removal.
      if (call.phase === "ringing") {
        if (phase === "active") {
          return activate(state, action.id, action.now);
        }
        if (phase === "ended") {
          return {
            ...state,
            calls: state.calls.filter((c) => c.id !== action.id),
            activeId: state.activeId === action.id ? null : state.activeId,
          };
        }
        return state;
      }
      if (phase === "active") {
        return activate(state, action.id, action.now);
      }
      if (phase === "ended") {
        return {
          ...state,
          calls: state.calls.map((c) =>
            c.id === action.id ? { ...c, phase: "ended" as const } : c,
          ),
          activeId: state.activeId === action.id ? null : state.activeId,
        };
      }
      if (phase === "held") {
        const next = updateCall(state, action.id, { phase: "held" });
        return {
          ...next,
          activeId: state.activeId === action.id ? null : state.activeId,
        };
      }
      return updateCall(state, action.id, { phase });
    }
    case "held": {
      const call = state.calls.find((c) => c.id === action.id);
      if (!call || (call.phase !== "active" && call.phase !== "held")) {
        return state;
      }
      const next = updateCall(state, action.id, {
        phase: action.held ? "held" : "active",
      });
      return {
        ...next,
        activeId: action.held
          ? state.activeId === action.id
            ? null
            : state.activeId
          : action.id,
      };
    }
    case "muted":
      return updateCall(state, action.id, { muted: action.muted });
    case "dismissed":
      return {
        ...state,
        calls: state.calls.filter((c) => c.id !== action.id),
        activeId: state.activeId === action.id ? null : state.activeId,
      };
    default:
      return state;
  }
}
