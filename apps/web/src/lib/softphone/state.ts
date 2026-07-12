/**
 * D43 (#135) softphone state — the pure, SDK-agnostic call model. Separated
 * from the provider so it is unit-testable without @telnyx/webrtc, a browser,
 * or a mic (the audio itself needs real-device verification; the STATE
 * transitions do not).
 *
 * The @telnyx/webrtc call state machine is new → trying → ringing → active →
 * hangup → destroy; we collapse it to the four phases the UI cares about.
 */

/** The UI-facing phase of the single active call (one live call per member). */
export type CallPhase =
  | "idle"
  | "connecting" // placed, ringing the customer (SDK new/trying/ringing)
  | "active" // customer answered (SDK active)
  | "ended"; // hangup/destroy — the bar shows a brief "Call ended"

/** Map a raw @telnyx/webrtc call.state string to our UI phase. */
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
    case "hangup":
    case "destroy":
    case "purge":
      return "ended";
    default:
      return "connecting";
  }
}

/** The full softphone snapshot the UI renders from. */
export interface SoftphoneState {
  /** false until the SDK has registered (telnyx.ready) — the button waits. */
  ready: boolean;
  /** A registration/auth error the UI surfaces (never blocks texting). */
  error: string | null;
  phase: CallPhase;
  /** The contact being called (name + number), for the call bar. */
  peer: { name: string; number: string } | null;
  /** Whether the local mic is muted. */
  muted: boolean;
  /** Unix ms the call went active — the bar derives the live timer from it. */
  activeSince: number | null;
}

export const INITIAL_SOFTPHONE_STATE: SoftphoneState = {
  ready: false,
  error: null,
  phase: "idle",
  peer: null,
  muted: false,
  activeSince: null,
};

export type SoftphoneAction =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "placing"; peer: { name: string; number: string } }
  | { type: "sdk_state"; state: string; now: number }
  | { type: "muted"; muted: boolean }
  | { type: "cleared" };

export function softphoneReducer(
  state: SoftphoneState,
  action: SoftphoneAction,
): SoftphoneState {
  switch (action.type) {
    case "ready":
      return { ...state, ready: true, error: null };
    case "error":
      // A registration error never disturbs an in-progress call's UI.
      return { ...state, error: action.message };
    case "placing":
      return {
        ...state,
        phase: "connecting",
        peer: action.peer,
        muted: false,
        activeSince: null,
        error: null,
      };
    case "sdk_state": {
      const phase = phaseFromSdkState(action.state);
      if (phase === "active" && state.phase !== "active") {
        return { ...state, phase, activeSince: action.now };
      }
      if (phase === "ended") {
        return { ...state, phase: "ended" };
      }
      return { ...state, phase };
    }
    case "muted":
      return { ...state, muted: action.muted };
    case "cleared":
      // Back to idle but keep `ready` — the SDK stays registered between calls.
      return {
        ...INITIAL_SOFTPHONE_STATE,
        ready: state.ready,
      };
    default:
      return state;
  }
}
