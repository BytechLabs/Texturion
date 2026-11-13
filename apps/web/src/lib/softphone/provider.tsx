"use client";

/**
 * D43 (#135) softphone provider — the browser IS the phone. Holds one
 * @telnyx/webrtc client for the signed-in member and the live call set
 * (phase 3: MULTI-CALL — one active, others held or ringing; call waiting is
 * hold-and-answer). Mounted once from the app shell.
 *
 * SSR-safe + lazy: the ~65KB SDK is imported dynamically (never at module
 * load, never on the server). Registration is EAGER once the app has loaded, for
 * members who may call from this workspace: an open app
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
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { roleHasCapability } from "@loonext/shared";

import { useT, type Translate } from "@/i18n/provider";
import {
  useAuthorizeBrowserCall,
  useResolveLiveSession,
  useWebrtcToken,
} from "@/lib/api/calls";
import { ApiError } from "@/lib/api/error";
import { useActiveCompany } from "@/lib/company/provider";

import { emitRingBeacon } from "./beacons";
import { setLiveBrowserCall } from "./live-call";
import {
  INITIAL_SOFTPHONE_STATE,
  isTerminalSdkState,
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
  dtmf: (digit: string) => void;
  remoteStream?: MediaStream;
  telnyxIDs?: {
    telnyxCallControlId?: string;
    telnyxSessionId?: string;
    telnyxLegId?: string;
  };
  options?: {
    remoteCallerName?: string;
    remoteCallerNumber?: string;
    /** #213: the INVITE's custom SIP headers ({name,value}) — the @telnyx/webrtc
     *  SDK surfaces `dialogParams.custom_headers` here. Carries X-Loonext-Session
     *  (= S) on a server-dialed placer (op) leg so the browser correlates it to
     *  its pending placement and auto-answers, and X-Loonext-Caller (the customer). */
    customHeaders?: { name?: string; value?: string }[];
  };
}

/** #213: read a custom SIP header off an incoming call's options (case-insensitive
 *  name match; the SDK preserves the server's casing but we never rely on it). */
function customHeader(call: TelnyxCall, name: string): string | null {
  const headers = call.options?.customHeaders ?? [];
  for (const header of headers) {
    if ((header?.name ?? "").toLowerCase() === name.toLowerCase()) {
      return header?.value ?? null;
    }
  }
  return null;
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

/**
 * Recorded when the softphone cannot register at all: the token mint was
 * refused (browser calling unconfigured, subscription lapsed) or the SDK never
 * came up. Distinct from a registration that is merely slow, which is what the
 * status indicator shows while `error` is still null.
 */
const REGISTRATION_FAILED_KEY = "shell.registrationFailed" as const;

/** #213: how long to wait for the server-dialed placer (op) INVITE after
 *  authorize before giving up on a placement. Set just PAST the server's 45s ring
 *  window (RING_TIMEOUT_SECS) so a late op INVITE can never arrive after the
 *  timeout has fired and be mistaken for a fresh inbound ring (adversarial-review
 *  M2): by the time this elapses the server-dialed op/oc legs have themselves
 *  timed out, so no INVITE is in flight. The normal INVITE arrives in ~1–3s. */
const PLACEMENT_TIMEOUT_MS = 48_000;

/** The app's own requests must be quiet this long before the phone registers. */
const REGISTER_QUIET_MS = 400;
/** The longest registration waits after mount, so a tab never quiet still rings. */
const REGISTER_CEILING_MS = 5_000;
/** How long a placed call waits for registration before giving up without a dial. */
const READY_WAIT_MS = 10_000;

/** Token refusals that only a change of role, workspace or subscription lifts. */
const LASTING_REFUSALS: ReadonlySet<string> = new Set([
  "forbidden",
  "subscription_inactive",
  "conflict",
]);

/** A microphone-permission failure carrying a member-facing, actionable
 *  message (distinguished from an ApiError in the call catch blocks). */
/**
 * Exported so the placeCall callers can narrow on it. Its message is the only
 * ACTIONABLE copy in the whole start-a-call path ("Microphone access is
 * blocked. Click the 🎤 or 🔒 icon…"), and both call sites previously narrowed
 * on ApiError alone — so a remembered browser Block (which throws instantly,
 * with no prompt) always rendered the generic "Couldn't start the call. Try
 * again.", which tells the user to do the one thing that cannot work.
 */
export class MicPermissionError extends Error {}

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
async function acquireMicOrThrow(t: Translate): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new MicPermissionError(t("shell.micNoBrowserSupport"));
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (cause) {
    const name = cause instanceof DOMException ? cause.name : "";
    throw new MicPermissionError(
      name === "NotFoundError" || name === "DevicesNotFoundError"
        ? t("shell.micNotFound")
        : name === "NotAllowedError" || name === "SecurityError"
          ? t("shell.micBlocked")
          : t("shell.micFailed"),
    );
  }
  for (const track of stream.getTracks()) track.stop();
}

/** Raise an OS notification for a ringing inbound call so a member whose app tab
 *  is backgrounded still notices it. Best-effort: silently no-ops where
 *  Notifications are unsupported or not granted (we never prompt here — the Web
 *  Push flow owns permission). Clicking it focuses the app. Tagged by the
 *  server session, so every tab ringing for one call shares one notification. */
function showRingNotification(
  notes: Map<string, Notification>,
  id: string,
  session: string | null,
  name: string,
  number: string,
  t: Translate,
): void {
  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return;
  }
  try {
    const note = new Notification(t("shell.incomingCall"), {
      body: number && number !== name ? `${name} · ${number}` : name,
      tag: `call-${session ?? id}`,
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
  /** False when this member cannot call from this workspace: no phone, no status. */
  entitled: boolean;
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
  /** Answer a ringing call; any active call is put on hold first. Rejects when
   *  the mic can't be acquired so the caller can surface the reason. */
  answer: (id: string) => Promise<void>;
  /** Hang up one call (default: the active one). */
  hangup: (id?: string) => void;
  /** Hold/unhold flip — unholding another call swaps the active audio. */
  toggleHold: (id: string) => void;
  toggleMute: (id: string) => void;
  /** Send a DTMF touch-tone on a call (keypad — navigating phone menus/IVRs). */
  sendDtmf: (id: string, digit: string) => void;
  /** Dismiss an ended call's chip. */
  dismiss: (id: string) => void;
}

const SoftphoneContext = createContext<SoftphoneContextValue | null>(null);

export function SoftphoneProvider({ children }: { children: ReactNode }) {
  // #228: the reader's words. Referentially stable per locale (the provider
  // memoises it), so it can sit in a dependency array without re-arming the
  // SDK client on every render.
  const t = useT();
  const [state, dispatch] = useReducer(
    softphoneReducer,
    INITIAL_SOFTPHONE_STATE,
  );
  const clientRef = useRef<TelnyxClient | null>(null);
  // The workspace the current client's token was minted for.
  const clientCompanyRef = useRef<string | null>(null);
  const callsRef = useRef<Map<string, TelnyxCall>>(new Map());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // The call whose remote stream the audio element is playing.
  const attachedCallIdRef = useRef<string | null>(null);
  const connectingRef = useRef<Promise<TelnyxClient> | null>(null);
  const queryClient = useQueryClient();

  // The mutate functions are stable; the result objects around them are not.
  const { mutateAsync: authorize } = useAuthorizeBrowserCall();
  const { mutateAsync: mintToken } = useWebrtcToken();
  const { mutateAsync: resolveLeg } = useResolveLiveSession();
  const resolveRef = useRef(resolveLeg);
  resolveRef.current = resolveLeg;
  // Read by the SDK handlers, which are captured once in ensureClient.
  const { companyId, role, membership } = useActiveCompany();
  const companyRef = useRef(companyId);
  companyRef.current = companyId;
  // The token route refuses members who cannot send and inactive subscriptions.
  const entitled =
    roleHasCapability(role, "conversations.send") &&
    membership.subscription_status === "active";
  const entitledRef = useRef(entitled);
  entitledRef.current = entitled;
  const accessRef = useRef("");
  accessRef.current = `${companyId}:${role}:${membership.subscription_status}`;
  // The access a lasting token refusal was given for; retries stay off while it matches.
  const refusedAccessRef = useRef<string | null>(null);
  // Placed calls waiting for the phone to register.
  const readyWaitersRef = useRef<Set<() => void>>(new Set());
  // D142 ring beacons: the server session of each genuine inbound ring still
  // unanswered, by SDK call id. The ring leg's own SDK session is not the
  // server's, so this is the X-Loonext-Session header the INVITE carried.
  const ringSessionsRef = useRef<Map<string, string>>(new Map());
  // Ring-leg ccids whose by-leg resolution is running or done — the SDK
  // fires 'active' repeatedly, and we only need to resolve once per call.
  const resolvedRef = useRef<Set<string>>(new Set());
  // #516: pending resolve retries, so they can be abandoned when the provider
  // unmounts rather than dispatching into a dead reducer.
  const resolveTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
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
  const rebuildClientRef = useRef<(() => void) | null>(null);
  // #213: outbound placements awaiting their server-dialed placer (op) INVITE,
  // keyed by S (the call_session_id from POST /calls/browser). The op INVITE
  // arrives as an *inbound* SDK call carrying X-Loonext-Session=S; we correlate
  // it here, AUTO-answer it, and reconcile the "Calling…" chip — NEVER showing it
  // as an incoming ring. Cleared on connect, on a per-placement timeout, or on
  // cancel. `placementSdkIds` marks the resulting SDK call ids so the active
  // handler treats them as outbound (session S already known — no resolveByLeg).
  const pendingPlacementsRef = useRef<
    Map<string, { placementId: string; timer: ReturnType<typeof setTimeout> }>
  >(new Map());
  // #213: EVERY placement session S we've ever registered (bounded, TTL-evicted).
  // A server-dialed op INVITE carries X-Loonext-Session=S; a genuine inbound ring
  // carries a DIFFERENT session. So an INVITE whose session ∈ this set is one of
  // OUR placement legs: auto-answer it if still pending, otherwise DECLINE it
  // (cancelled / timed-out / a duplicate for an already-connected placement) —
  // NEVER show it as a spurious inbound ring. Identity-based, so correctness never
  // rests on the 48s>45s timing margin (review M2).
  const registeredPlacementsRef = useRef<Set<string>>(new Set());
  const placementSdkIdsRef = useRef<Set<string>>(new Set());

  /** True while any tracked call is still up (not torn down). A live call OWNS
   *  its client's RTP/peer connection, so the recovery watchdog must never
   *  rebuild the client underneath it (#138). */
  const hasLiveCall = useCallback(
    () =>
      [...callsRef.current.values()].some((c) => !isTerminalSdkState(c.state)),
    [],
  );

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
      attachedCallIdRef.current = call.id;
      void audioRef.current.play().catch(() => {
        /* autoplay policy — the answer/place gesture covers it */
      });
    }
  }, []);

  /**
   * #516 — resolve an answered inbound ring leg to its CUSTOMER session,
   * retrying until the ledger row lands.
   *
   * The reported symptom was that a member who received a transferred call saw
   * no Messages and no Transfer button, and that pressing hold and then unhold
   * made both appear. That is this function's absence, exactly: both controls
   * are gated on a resolved session, this ran ONCE per 'active', and the only
   * thing in the product that produces a second 'active' for a call already
   * answered is a manual hold/unhold. So the old code's promise of "retry
   * allowed on a later 'active'" was a retry nobody would ever perform — the
   * founder found the workaround before the code found the retry.
   *
   * The race it loses is real and ordinary: a transfer re-rings the customer at
   * the target, and the target's SDK reaches 'active' before the webhook that
   * ledgers the new leg has been processed. One attempt is simply too early.
   *
   * The policy — 6 attempts, 600ms doubling to a 5s ceiling — is COPIED from
   * SoftphoneCore.kt/.swift rather than chosen here. Both phones already had
   * it; the web client is the one that never got it, which is why this is a
   * parity fix and not a new idea. Keep the three in step.
   */
  const resolveSessionWithRetry = useCallback(
    async (legCcid: string, callId: string): Promise<void> => {
      let backoffMs = 600;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        // The call ending mid-backoff makes the answer worthless: nothing is
        // left to address, and dispatching would resurrect a dead chip.
        if (!callsRef.current.has(callId)) return;
        try {
          const resolved = await resolveRef.current(legCcid);
          dispatch({
            type: "session_known",
            id: callId,
            sessionId: resolved.call_session_id,
          });
          return;
        } catch {
          // Not ledgered yet (or a blip) — wait and ask again.
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            resolveTimersRef.current.delete(timer);
            resolve();
          }, backoffMs);
          resolveTimersRef.current.add(timer);
        });
        backoffMs = Math.min(backoffMs * 2, 5_000);
      }
      // Give up on THIS pass but not on the call: clearing the guard lets a
      // later 'active' (a hold/unhold, or a second answer) try again, which is
      // the behaviour the phones have and the only thing that used to work here.
      resolvedRef.current.delete(legCcid);
    },
    [],
  );

  useEffect(() => {
    // Abandon in-flight resolve backoffs on teardown rather than letting a
    // timer fire into a dead reducer.
    const timers = resolveTimersRef.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  /** Register (or reuse) the SDK client — lazy import, single flight. */
  const ensureClient = useCallback(async (): Promise<TelnyxClient> => {
    if (clientRef.current) return clientRef.current;
    if (connectingRef.current) return connectingRef.current;

    connectingRef.current = (async () => {
      const mintedFor = companyRef.current;
      const access = accessRef.current;
      const [{ token }, { TelnyxRTC }] = await Promise.all([
        mintToken().catch((cause: unknown) => {
          if (cause instanceof ApiError && LASTING_REFUSALS.has(cause.code)) {
            refusedAccessRef.current = access;
          }
          throw cause;
        }),
        import("@telnyx/webrtc"),
      ]);
      refusedAccessRef.current = null;
      const client = new TelnyxRTC({
        login_token: token,
      }) as unknown as TelnyxClient;

      // Events from a client already replaced or dropped must not move the state.
      client.on("telnyx.ready", () => {
        if (clientRef.current !== client) return;
        readyRef.current = true;
        // Registered for a workspace being left: the switch replaces it.
        if (mintedFor !== companyRef.current) return;
        dispatch({ type: "ready" });
        for (const resolve of readyWaitersRef.current) resolve();
        readyWaitersRef.current.clear();
      });
      client.on("telnyx.error", () => {
        if (clientRef.current !== client) return;
        readyRef.current = false;
        dispatch({
          type: "error",
          message: t("shell.callingTemporarilyUnavailable"),
        });
        // An error is often an auth/token failure — a fresh token + registration
        // is the recovery. The SDK's own reconnect can't fix a bad token.
        scheduleRecoverRef.current?.();
      });
      // The WebSocket dropped (network flap, backgrounded tab, server close).
      // The SDK auto-reconnects with backoff; if it exhausts, only a rebuild
      // brings the phone back. Mark down + let the recovery watchdog decide.
      client.on("telnyx.socket.close", () => {
        if (clientRef.current !== client) return;
        readyRef.current = false;
        dispatch({ type: "disconnected" });
        scheduleRecoverRef.current?.();
      });
      client.on("telnyx.notification", (payload) => {
        const note = payload as { type?: string; call?: TelnyxCall } | undefined;
        const call = note?.call;
        if (!call) return;

        if (!callsRef.current.has(call.id)) {
          // A NEW inbound invite — the ring engine, a transfer/consult, OR
          // (#213) THIS member's own server-dialed placer (op) leg for an
          // outbound call they just placed.
          if (call.direction === "inbound" && call.state === "ringing") {
            // #213: is this the op leg for one of our pending placements? The
            // server stamped X-Loonext-Session=S on the placer dial; correlate
            // it to the placement we registered in placeCall.
            const opSession = customHeader(call, "X-Loonext-Session");
            const pending = opSession
              ? pendingPlacementsRef.current.get(opSession)
              : undefined;
            if (opSession && pending) {
              // OUR outbound leg — auto-answer it (mic pre-granted in placeCall)
              // and reconcile the "Calling…" chip. Never a ring UI. This slot was
              // already reserved at placeCall (the placement counts toward the
              // ceiling below), so no ceiling re-check here.
              clearTimeout(pending.timer);
              pendingPlacementsRef.current.delete(opSession);
              callsRef.current.set(call.id, call);
              placementSdkIdsRef.current.add(call.id);
              // Answer immediately — the mic was pre-granted in placeCall. Any
              // other active call is SDK-held structurally when THIS one goes
              // 'active' (the active branch below), matching the reducer's demotion.
              try {
                call.answer();
              } catch {
                /* the customer/placer leg died in the same instant */
              }
              dispatch({
                type: "placement_connected",
                placementId: pending.placementId,
                id: call.id,
                sessionId: opSession,
              });
              return;
            }
            if (opSession && registeredPlacementsRef.current.has(opSession)) {
              // A placement op leg we registered but is no longer pending — the
              // member cancelled during "Calling…", it timed out, or this is a
              // duplicate for an already-connected placement. DECLINE it (never a
              // spurious inbound ring): a decline tears the DO's server-dialed
              // customer down. Identity-based, so it holds regardless of timing.
              try {
                call.hangup();
              } catch {
                /* already gone */
              }
              return;
            }
            // A genuine INBOUND ring. Beyond the two-call ceiling it declines
            // immediately, so the answer race resolves elsewhere. A #213
            // placement in flight (authorized, op INVITE not yet arrived) is NOT
            // in callsRef yet, so count pendingPlacements too — else a placement
            // fails to reserve its slot and a racing inbound could breach the
            // ceiling (adversarial-review MEDIUM).
            const live =
              [...callsRef.current.values()].filter(
                (c) => !isTerminalSdkState(c.state),
              ).length + pendingPlacementsRef.current.size;
            if (live >= MAX_CONCURRENT_CALLS) {
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
              call.options?.remoteCallerName ||
              number ||
              t("shell.unknownCaller");
            dispatch({
              type: "incoming",
              id: call.id,
              sessionId: call.telnyxIDs?.telnyxSessionId ?? null,
              peer: { name, number },
            });
            showRingNotification(
              ringNotesRef.current,
              call.id,
              opSession,
              name,
              number,
              t,
            );
            if (opSession) {
              ringSessionsRef.current.set(call.id, opSession);
              void emitRingBeacon(companyRef.current, "ringing_shown", opSession);
            }
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
          if (placementSdkIdsRef.current.has(call.id)) {
            // #213: our own outbound placer (op) leg — the session (S) is already
            // known from the placement, so DON'T resolveByLeg (that resolver is
            // for inbound RING legs). The chip already carries S.
          } else if (call.direction === "inbound") {
            // The SDK session for an answered inbound call is the ring leg's,
            // not the customer's — resolve the real (customer) session so
            // transfer / consult / notes address the right calls row. Once
            // per call (the SDK re-fires 'active').
            const legCcid = call.telnyxIDs?.telnyxCallControlId;
            if (legCcid && !resolvedRef.current.has(legCcid)) {
              resolvedRef.current.add(legCcid);
              void resolveSessionWithRetry(legCcid, call.id);
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
        if (isTerminalSdkState(call.state)) {
          closeRingNotification(ringNotesRef.current, call.id);
          callsRef.current.delete(call.id);
          ringSessionsRef.current.delete(call.id);
          placementSdkIdsRef.current.delete(call.id); // #213 cleanup
          const legCcid = call.telnyxIDs?.telnyxCallControlId;
          if (legCcid) resolvedRef.current.delete(legCcid);
          if (attachedCallIdRef.current === call.id) {
            attachedCallIdRef.current = null;
            if (audioRef.current) audioRef.current.srcObject = null;
          }
          // Finish a switch or recovery deferred while this call held the client (#138).
          if (!hasLiveCall()) {
            if (clientCompanyRef.current !== companyRef.current) {
              rebuildClientRef.current?.();
            } else if (!readyRef.current) {
              scheduleRecoverRef.current?.();
            }
          }
        }
      });

      // Set before connect, so a registration the SDK reports at once counts.
      clientRef.current = client;
      clientCompanyRef.current = mintedFor;
      client.connect();
      return client;
    })();

    let client: TelnyxClient;
    try {
      client = await connectingRef.current;
    } finally {
      connectingRef.current = null;
    }
    // The workspace changed while this one was being minted.
    if (clientCompanyRef.current !== companyRef.current) {
      rebuildClientRef.current?.();
    }
    return client;
  }, [attachActiveAudio, mintToken, hasLiveCall, resolveSessionWithRetry, t]);

  /** Tear a dead client down and build a fresh one — re-mints the token, so a
   *  NEW SIP registration is established (that's what makes the phone ring
   *  again). Never touches a live call's audio: it bails while any call is up
   *  (#138) — disconnecting the owning client would kill the in-progress call's
   *  media. The destroy/hangup handler re-arms recovery once the line is idle. */
  const rebuildClient = useCallback(() => {
    if (connectingRef.current) return; // a build is already in flight
    // A down socket during an ACTIVE call is exactly when a rebuild is most
    // harmful: let the SDK's own reconnect own in-call media recovery.
    if (hasLiveCall()) return;
    const old = clientRef.current;
    clientRef.current = null;
    clientCompanyRef.current = null;
    readyRef.current = false;
    dispatch({ type: "disconnected" });
    try {
      old?.disconnect();
    } catch {
      /* already gone */
    }
    // A workspace this member cannot call from gets no phone at all.
    if (!entitledRef.current) return;
    void ensureClient().catch(() => {
      // Stays down until the next visibility/online tick retries. Recording it
      // is what stops the indicator claiming the phone is still connecting.
      dispatch({ type: "error", message: t(REGISTRATION_FAILED_KEY) });
    });
  }, [ensureClient, hasLiveCall, t]);
  rebuildClientRef.current = rebuildClient;

  /** If the phone can't currently ring, rebuild it — after a short delay so the
   *  SDK's OWN backoff reconnect wins for transient drops and we only step in
   *  when it has genuinely failed. Debounced: a burst of close/visibility/online
   *  events collapses into one rebuild. No-op while healthy, and deferred while
   *  a call is live (#138) — the call-end handler re-arms it once the line clears. */
  const scheduleRecover = useCallback(() => {
    if (!entitledRef.current) return;
    if (refusedAccessRef.current === accessRef.current) return;
    if (readyRef.current || connectingRef.current) return;
    if (recoverTimerRef.current) return;
    recoverTimerRef.current = setTimeout(() => {
      recoverTimerRef.current = null;
      if (readyRef.current || connectingRef.current) return;
      // Defer while a call owns the client; re-armed on destroy/hangup.
      if (hasLiveCall()) return;
      rebuildClient();
    }, 4000);
  }, [rebuildClient, hasLiveCall]);
  scheduleRecoverRef.current = scheduleRecover;

  // Eager registration: an open app is a phone that can ring.
  //
  // Deferred until the app's own requests have gone quiet rather than fired
  // during boot. Registering mints a token, pulls in the WebRTC SDK (by far the
  // largest chunk the app loads) and opens a socket, and doing that inside the
  // start-up burst made every hard load carry it before the screen was ready,
  // for a call that may never come. The ceiling is the floor so a permanently
  // busy tab still registers, and a tab opened to answer a call (?call=, D43
  // push-to-wake) registers at once because the calls page waits on `ready`
  // before asking the server to ring it.
  useEffect(() => {
    if (!entitled) return;
    const cache = queryClient.getQueryCache();
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const ceiling = setTimeout(register, REGISTER_CEILING_MS);
    const unsubscribe = cache.subscribe(check);
    document.addEventListener("visibilitychange", check);
    check();
    return stop;

    function check() {
      if (new URLSearchParams(window.location.search).has("call")) {
        register();
        return;
      }
      if (
        queryClient.isFetching() > 0 ||
        document.visibilityState !== "visible"
      ) {
        clearTimeout(quietTimer);
        quietTimer = undefined;
        return;
      }
      quietTimer ??= setTimeout(register, REGISTER_QUIET_MS);
    }

    function stop() {
      clearTimeout(quietTimer);
      clearTimeout(ceiling);
      unsubscribe();
      document.removeEventListener("visibilitychange", check);
    }

    function register() {
      stop();
      void ensureClient().catch(() => {
        // No toast: texting is unaffected and the Call button retries on use.
        // The failure is still RECORDED, because the status indicator otherwise
        // reads "Connecting…" for the rest of the session and a member is left
        // believing their browser will ring when it never will.
        dispatch({ type: "error", message: t(REGISTRATION_FAILED_KEY) });
      });
    }
  }, [entitled, ensureClient, queryClient, t]);

  // Keep the phone ring-ready across the real-world drops the SDK can't recover
  // on its own: a tab that was backgrounded (its socket throttled/closed) coming
  // back to the foreground, and the network returning. Both only rebuild when
  // the phone is actually down (scheduleRecover no-ops while healthy).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleRecoverRef.current?.();
    };
    const onOnline = () => scheduleRecoverRef.current?.();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      if (recoverTimerRef.current) clearTimeout(recoverTimerRef.current);
      recoverTimerRef.current = null;
    };
  }, []);

  // A phone left registered with the old workspace would keep ringing for it.
  const followedCompanyRef = useRef(companyId);
  useEffect(() => {
    // A language change re-runs this too, and must not clear a shown failure.
    if (followedCompanyRef.current === companyId) return;
    followedCompanyRef.current = companyId;
    if (clientCompanyRef.current === companyId) {
      if (readyRef.current) dispatch({ type: "ready" });
      return;
    }
    dispatch({ type: "registration_reset" });
    rebuildClient();
  }, [companyId, rebuildClient]);

  // A reload would hang up a live call, so the page asks first.
  const callInProgress = state.calls.some((c) => c.phase !== "ended");
  useEffect(() => {
    setLiveBrowserCall(callInProgress);
    if (!callInProgress) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      setLiveBrowserCall(false);
    };
  }, [callInProgress]);

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

  /** Resolves once the phone is registered for this workspace; rejects after timeoutMs. */
  const waitForReady = useCallback(
    (timeoutMs: number) =>
      new Promise<void>((resolve, reject) => {
        if (
          readyRef.current &&
          clientCompanyRef.current === companyRef.current
        ) {
          resolve();
          return;
        }
        const waiters = readyWaitersRef.current;
        const onReady = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          waiters.delete(onReady);
          reject(new Error(t("shell.callStartFailed")));
        }, timeoutMs);
        waiters.add(onReady);
      }),
    [t],
  );

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
      if (live.length >= MAX_CONCURRENT_CALLS) {
        // THROW, don't return. A bare return resolved placeCall as SUCCESS, so
        // every caller (dialer, call button, contact panel) closed its dialog
        // and reported a call it never placed — the ceiling was invisible and
        // the customer was never dialled. The callers' existing catch turns
        // this into a visible message with the digits still in the dialog.
        throw new Error(t("shell.tooManyCalls"));
      }
      try {
        // Mic FIRST — before we reserve the line. A denial here never strands a
        // reservation (no "on another call" phantom), never bills, and surfaces
        // an actionable message instead of a silent "ended". It also pre-grants
        // the mic so the AUTO-answer of the op INVITE below never re-prompts.
        await acquireMicOrThrow(t);
        // #213: the SERVER now dials the customer (a real, controllable
        // Call-Control leg) and rings THIS member's own softphone as the placer
        // (op) leg — the browser NO LONGER dials the customer (that only ever
        // produced the placer's WebRTC leg, so a transfer grabbed the wrong leg
        // and dropped the customer). Authorize returns S; we register a pending
        // placement keyed on S and wait for the op INVITE (an inbound SDK call
        // carrying X-Loonext-Session=S), which the notification handler
        // auto-answers and reconciles into this "Calling…" chip.
        // Register BEFORE authorizing. Authorize is the step that makes the
        // server dial the customer and claim the line; registration is purely
        // local and has no server-side effect. Doing them the other way round
        // meant a registration failure surfaced "Couldn't start the call" while
        // the customer's phone was already ringing, with nothing on screen to
        // cancel — the call could only end by the customer answering a silent
        // line or the ring window lapsing. And wait for the registration to
        // land: a socket that is still connecting cannot take the placer leg.
        if (
          clientRef.current &&
          clientCompanyRef.current !== companyRef.current
        ) {
          rebuildClient();
        }
        await ensureClient();
        await waitForReady(READY_WAIT_MS);
        const auth = await authorize({
          conversation_id: conversationId,
          contact_id: contactId,
          to,
          phone_number_id: phoneNumberId,
        });
        const sessionId = auth.call_session_id;
        if (!sessionId) {
          // A server that returned no S cannot be correlated to an op INVITE —
          // fail honestly rather than leave a silent dead chip.
          throw new ApiError(
            "conflict",
            t("shell.callStartFailedPleaseRetry"),
            409,
          );
        }
        const placementId = `placement:${sessionId}`;
        const peer = { name: contactName, number: auth.to };
        // A per-placement timeout: if the op INVITE never arrives (server dial
        // failed after the 200, or the ring window lapsed), drop the chip + warn.
        const timer = setTimeout(() => {
          pendingPlacementsRef.current.delete(sessionId);
          const message = t("shell.lineUnreachable");
          dispatch({ type: "placement_failed", placementId, message });
          // The dispatch alone is invisible: nothing renders `state.error`, so
          // an outbound call that never connected simply vanished after the
          // timeout with no explanation — the user is left staring at a dialer
          // wondering whether it rang. Toast it, like the answer path does.
          toast.error(message);
        }, PLACEMENT_TIMEOUT_MS);
        pendingPlacementsRef.current.set(sessionId, { placementId, timer });
        // Remember S as one of OUR placement sessions (identity-based op-INVITE
        // correlation), and evict it once no op INVITE can still be in flight
        // (past the server ring window) so the set stays bounded.
        registeredPlacementsRef.current.add(sessionId);
        setTimeout(
          () => registeredPlacementsRef.current.delete(sessionId),
          PLACEMENT_TIMEOUT_MS,
        );
        dispatch({
          type: "placing",
          id: placementId,
          sessionId,
          peer,
        });
      } catch (cause) {
        dispatch({
          type: "error",
          message:
            cause instanceof MicPermissionError || cause instanceof ApiError
              ? cause.message
              : t("shell.callStartFailed"),
        });
        throw cause;
      }
    },
    [authorize, ensureClient, rebuildClient, waitForReady, t],
  );

  const answer = useCallback(
    async (id: string) => {
      const call = callsRef.current.get(id);
      if (!call) return;
      // Answering also needs the mic — surface a clear reason (not a dead
      // chip) if it's blocked, and don't hold the active call for an answer
      // that can't capture audio.
      try {
        await acquireMicOrThrow(t);
      } catch (cause) {
        const message =
          cause instanceof MicPermissionError
            ? cause.message
            : t("shell.answerFailed");
        dispatch({ type: "error", message });
        // Reject so the Answer click can surface the reason. state.error is not
        // rendered anywhere, so without this the ring chip just keeps ringing
        // and the actionable "mic is blocked" message is lost.
        throw new Error(message);
      }
      holdActive();
      try {
        call.answer();
      } catch {
        /* the caller hung up in the same instant — the chip clears itself */
      }
      const ringSession = ringSessionsRef.current.get(id);
      if (ringSession) {
        ringSessionsRef.current.delete(id);
        void emitRingBeacon(companyRef.current, "answered", ringSession);
      }
    },
    [holdActive, t],
  );

  const hangup = useCallback((id?: string) => {
    const targetId = id ?? stateRef.current.activeId;
    if (!targetId) return;
    // #213: cancelling a placement that is still "Calling…" (no op INVITE yet).
    // Its chip id is `placement:<S>` and there is no SDK call to hang up; mark
    // S cancelled so the op INVITE, when it arrives, is DECLINED (the DO then
    // drops the server-dialed customer), and clear the pending timer + chip.
    if (targetId.startsWith("placement:")) {
      const sessionId = targetId.slice("placement:".length);
      const pending = pendingPlacementsRef.current.get(sessionId);
      if (pending) {
        // Cancel during "Calling…": stop the timer and drop it from pending. S
        // stays in registeredPlacements (TTL-evicted), so the op INVITE — if one
        // is still coming — is DECLINED (not rung), tearing down the DO's
        // server-dialed customer. No separate cancelled-set to leak.
        clearTimeout(pending.timer);
        pendingPlacementsRef.current.delete(sessionId);
        dispatch({ type: "dismissed", id: targetId });
        return;
      }
    }
    const call = callsRef.current.get(targetId);
    // Hanging up a ring nobody answered is this member declining it.
    const ringSession = ringSessionsRef.current.get(targetId);
    if (ringSession && call?.state === "ringing") {
      ringSessionsRef.current.delete(targetId);
      void emitRingBeacon(companyRef.current, "declined", ringSession);
    }
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

  const sendDtmf = useCallback((id: string, digit: string) => {
    const call = callsRef.current.get(id);
    if (!call) return;
    try {
      call.dtmf(digit);
    } catch {
      /* leg gone mid-press — the chip clears itself */
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => dispatch({ type: "dismissed", id }),
    [],
  );

  const activeCall = state.calls.find((c) => c.id === state.activeId) ?? null;
  const value = useMemo<SoftphoneContextValue>(
    () => ({
      ...state,
      entitled,
      activeCall,
      placeCall,
      answer,
      hangup,
      toggleHold,
      toggleMute,
      sendDtmf,
      dismiss,
    }),
    [
      state,
      entitled,
      activeCall,
      placeCall,
      answer,
      hangup,
      toggleHold,
      toggleMute,
      sendDtmf,
      dismiss,
    ],
  );

  return (
    <SoftphoneContext.Provider value={value}>
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
