/**
 * Calls v3 (#170) — the DO shell's I/O surface: the Telnyx command layer with
 * the §4.1 GET-on-4xx cause discrimination, the Postgres mirror, and the
 * existing pure-function delegates (§7.3: terminal merge, threading,
 * voicemail pipeline, push) invoked from the serialized DO context.
 *
 * Injectable: session-do.ts builds the real runtime from `env`; the §15
 * suites substitute a fake, so the shell's queue/journal/alarm logic is
 * testable with no Telnyx and no PostgREST.
 */
import {
  clampRingSeconds,
  isAfterHours,
  nextOpening,
  resolveNumberIdentity,
  roleHasCapability,
  RING_SECONDS_MAX,
  type AfterHoursCalls,
  type RingStrategy,
  type BusinessHours,
  type HoursException,
} from "@loonext/shared";
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import {
  afterHoursDefaultGreeting,
  buildBrowserAnsweredState,
  buildMemberRingState,
  buildVoicemailState,
  defaultGreeting,
  LOONEXT_CALLER_HEADER,
  LOONEXT_SESSION_HEADER,
  RING_TIMEOUT_SECS,
  sanitizeGreeting,
  screeningFlagged,
} from "../messaging/inbound-ring";
import {
  buildOutboundPlacerState,
  companyOverVoiceCap,
  type CompanyVoiceState,
  handleTerminalCallEvent,
  handleVoicemailSaved,
  normalizeCaller,
  OUTBOUND_AUTH_MAX_AGE_SECS,
  parseOutboundNonce,
  parseOutboundSessionId,
  threadCallSession,
} from "../messaging/voice-webhook";
import { normalizeNanpPhone } from "../routes/core/phone";
import { notifyMissedCall } from "../notifications/missed-call";
import { sendMissedCallText } from "../messaging/missed-call";
import {
  notifyIncomingCall,
  type IncomingCallPushReport,
} from "../notifications/incoming-call";
import { notifyCallEnd } from "../notifications/call-end";
import { telnyxRequest, TelnyxApiError } from "../telnyx/client";

import type {
  AnswerIntent,
  CallState,
  InitiatedContext,
  OutboundInitiatedContext,
  SessionMachine,
} from "./transitions";
import {
  isTerminal,
  MAX_UNAVAILABLE_NOTICES_PER_DAY,
  outcomeForState,
  RING_WINDOW_SECS,
} from "./transitions";

/** Result of a dial POST (§7.7 pending-key discipline). */
export type DialResult =
  | { ccid: string }
  | { failure: "known-dead" | "ambiguous" };

/** The adopted calls row (§7.5). */
export interface AdoptionRow {
  callSessionId: string;
  companyId: string;
  phoneNumberId: string | null;
  callerE164: string | null;
  outcome: "answered" | "voicemail" | "missed" | null;
  answeredAt: string | null;
  answeredByUserId: string | null;
  startedAtMs: number;
  customerCallControlId: string | null;
  direction: string | null;
  companyName: string;
  greeting: string | null;
  /** #367/D89: read here too — an adopted session can still be `ringing`, so
   *  its greeting has not been spoken and the ask must survive the cutover. */
  businessNumberE164: string | null;
  ledgerLegs: { ccid: string; userId: string; state: string }[];
}

export interface SessionRuntime {
  now(): number;
  uuid(): string;
  telnyx: {
    dial(input: {
      sipTarget: string;
      fromE164: string;
      clientState: string;
      /** CALLS-CLIENT-V2 §3.2: the call_session_id, stamped as the
       *  X-Loonext-Session custom SIP header so the Android client correlates
       *  the inbound INVITE to its server session deterministically. Same S the
       *  clientState above is built from. */
      sessionId: string;
      /** #212: the REAL external caller (machine.callerE164), stamped as the
       *  X-Loonext-Caller custom SIP header. `from` above is the business
       *  number the connection owns (Telnyx rewrites any other `from` for a
       *  WebRTC leg), so the caller cannot ride it - the client reads this
       *  header and shows the caller instead of our own number. Null for an
       *  anonymous/CLIR caller: no header, client shows "Unknown caller". */
      caller?: string | null;
      /**
       * Telnyx's Dial dedup key — the leg's `pendingKey`, which is already
       * minted once and frozen inside the journaled effect.
       *
       * §4.1 effect execution is deliberately at-least-once: the cursor
       * advances only AFTER `execute` returns, so an isolate eviction between
       * the dial and that write re-runs the dial. Every other command tolerates
       * replay; `dial` was the one that creates a new BILLABLE leg, and because
       * the pendingKey is frozen in the journal the duplicate could not even be
       * adopted afterwards (reduceMemberAnswered only considers legs whose ccid
       * is still null) — it just rang and billed to the 45s timeout.
       *
       * Verified against the live Telnyx API before shipping: a repeated
       * command_id returns HTTP 202 with the SAME call_control_id, so no second
       * leg is created and the 4xx -> `known-dead` mapping below is never
       * reached by a replay.
       */
      commandId?: string;
    }): Promise<DialResult>;
    /** T2 step 2: answer the inbound leg (bri anchor). "ok" covers both a
     *  fresh 2xx and the replay case (4xx but the GET says alive/answered). */
    answerInbound(ccid: string, clientState: string): Promise<"ok" | "dead">;
    answerVm(ccid: string, clientState: string): Promise<"ok" | "dead">;
    bridge(memberCcid: string, inboundCcid: string): Promise<"ok" | "dead">;
    /** 4xx-discriminated like answer/bridge (#208 F4): "ok" = the command
     *  landed (or the leg is still alive and its own hangup webhook will
     *  follow); "dead" = the leg was ALREADY gone/uncontrollable, so no
     *  further webhook is guaranteed for it and the shell must synthesize
     *  the terminal for a customer-leg teardown. Routine dead-leg races
     *  still never throw (that's telephony). */
    hangup(ccid: string): Promise<"ok" | "dead">;
    reject(ccid: string, cause: "USER_BUSY"): Promise<void>;
    speak(ccid: string, payload: string, clientState: string): Promise<void>;
    /**
     * #309 — play a recorded greeting.
     *
     * Returns whether Telnyx accepted it, rather than swallowing a 4xx the way
     * `speak` does. That difference is the whole fail-safe: a swallowed 404 on
     * a missing audio object would leave the caller listening to nothing, and
     * "a caller hearing nothing is worse than a caller hearing a robot" is the
     * line #309 draws. The caller of this decides to speak instead.
     */
    playAudio(ccid: string, audioUrl: string, clientState: string): Promise<boolean>;
    recordStart(ccid: string): Promise<void>;
    probeLegAlive(ccid: string): Promise<boolean>;
  };
  /** Mirror one set of columns onto the calls row; throws on failure (the
   *  shell retries via the mirror-retry alarm). #209: a TERMINAL state
   *  mirror also back-fills a still-null `outcome` (coalesce semantics,
   *  written BEFORE the state) so (state 'ended_%', outcome null) is never a
   *  persistable pair even if the terminal merge dies mid-flight. */
  mirror(
    sessionId: string,
    set: {
      state?: CallState;
      answered_by_user_id?: string | null;
      answered_at?: string | null;
      /** #490: this call reached a line that could not take it — the count an
       *  owner is shown when deciding whether to reinstate. */
      unattended?: boolean;
      /** #490: we answered and spoke the notice rather than ringing out. The
       *  billable half, and what the per-company daily cap counts. */
      notice_spoken?: boolean;
    },
  ): Promise<void>;
  /** call_member_legs audit insert (§2.2 — no longer decides any race). */
  ledgerInsert(input: {
    sessionId: string;
    ccid: string;
    companyId: string;
    userId: string;
  }): Promise<void>;
  /** §4 T1: the pre-reduce I/O (claim line, gates, targets, audience). */
  loadInitiatedContext(payload: {
    call_control_id: string;
    call_session_id: string;
    to: string;
    from?: string;
    call_screening_result?: string;
    shaken_stir_attestation?: string;
    caller_id_name?: string;
  }): Promise<InitiatedContext | "drop" | "replay-ended">;
  /** #211 T-O1: the pre-reduce I/O for a 4-part oc call.initiated — consume the
   *  nonce (deriving the calls-row PK from the STORED S), enforce the part-4==S
   *  identity check (S1/M3), the #136 NANP re-validation, and the lapsed-sub /
   *  voice-cap re-check, then stamp the customer leg ccid. Returns the authorized
   *  context to mint from, "reject" to hang up the leg and mint nothing, or
   *  "drop" to silently ignore. A REPLAY (already-authorized re-delivery) returns
   *  "drop": no mint, no stamp, and NOT a hangup (the live customer leg must
   *  survive); the call-hijack fix forbids any write derived from the
   *  caller-supplied session id on the replay path. */
  loadOutboundInitiatedContext(payload: {
    call_control_id: string;
    call_session_id: string;
    client_state: string | null;
    to: string;
    from?: string;
    /** #213 defense-in-depth: the oc leg's custom SIP headers. A leg carrying any
     *  X-RTC-* header is a WebRTC/browser leg (the placer), NEVER the customer —
     *  stamping it as customer_call_control_id is exactly the #213 wrong-bridge.
     *  The server now dials the customer on the VOICE connection (no X-RTC), so
     *  this never trips in practice; it converts any future regression that
     *  re-routes a browser leg here into an honest reject, not a silent hijack. */
    custom_headers?: { name?: string; value?: string }[] | null;
  }): Promise<OutboundInitiatedContext | "reject" | "drop">;
  /** §7.5 adoption read. */
  loadAdoptionRow(sessionId: string): Promise<AdoptionRow | null>;
  /** §7.7 adopted-machine ledger-less minting gate: active member holding a
   *  telephony credential AND #106-'text'-eligible on the session's number. */
  memberEligible(
    companyId: string,
    phoneNumberId: string | null,
    userId: string,
  ): Promise<boolean>;
  /** Recompute the §5.4 push audience (adoption + fanout-settle synthesis). */
  computePushAudience(
    companyId: string,
    phoneNumberId: string | null,
  ): Promise<string[]>;
  pushFanout(input: {
    companyId: string;
    userIds: string[];
    caller: string | null;
    sessionId: string;
  }): Promise<{ unreachableUserIds: string[] }>;
  pushCallEnd(input: {
    companyId: string;
    userIds: string[];
    sessionId: string;
    reason: "answered" | "voicemail" | "missed";
    /** The far party and the answerer, for the outcome card copy (#265). */
    caller: string | null;
    answeredByUserId: string | null;
  }): Promise<void>;
  threadAtAnswer(machine: SessionMachine): Promise<void>;
  /** Event-mode terminal merge: replay the triggering Telnyx payload through
   *  the existing replay-idempotent delegate (billing, outcome, thread, MCTB).
   *  #211 M1: for outbound, `opts` carries S as an explicit session-id override
   *  (the raw payload keys on Telnyx's T; the calls row is under S) AND the
   *  DO-authoritative answered-at anchor, so billing addresses the S-row and
   *  meters talk time even if the answered_at mirror never landed. Inbound
   *  passes no opts → byte-identical to today. */
  terminalMergeEvent(
    payload: Record<string, unknown>,
    opts?: { outboundSessionId?: string; outboundAnsweredAtIso?: string | null },
  ): Promise<void>;
  /** Synthetic merge (dead-inbound discrimination, janitor): no payload
   *  exists — merge from the machine's own facts. */
  terminalMergeSynthetic(
    machine: SessionMachine,
    outcome: "answered" | "voicemail" | "missed",
    briAnsweredAtIso: string | null,
  ): Promise<void>;
  voicemailPipeline(payload: Record<string, unknown>): Promise<void>;
  sentryWarn(message: string): void;
  sentryError(cause: unknown): void;
  buildClientStates: {
    memberRing(input: {
      sessionId: string;
      userId: string;
      caller: string | null;
      inboundCcid: string;
    }): string;
    briAnswered(caller: string | null, answeredAtIso: string): string;
    vmi(caller: string | null): string;
    /** #213: the outbound placer (op) leg's client_state — `op|S|userId`. */
    outboundPlacer(sessionId: string, userId: string): string;
  };
  greetingText(machine: SessionMachine): string;
  /**
   * #309 — a signed URL for this line's RECORDED greeting, or null.
   *
   * Resolved HERE, when the greeting is about to play, rather than stamped on
   * the machine at call initiation. Two reasons, and both matter on a path
   * where somebody is listening to silence for every millisecond:
   *
   * - A call that gets ANSWERED never reaches voicemail, so stamping the URL
   *   up front would make every caller pay a read and a signature for audio
   *   that is usually never played.
   * - A signed URL expires. One minted at initiation and played after a long
   *   ring is exactly the "unplayable recording" case #309 says must never
   *   produce silence — and the cheapest way not to have that case is not to
   *   mint the URL early.
   *
   * Returns null on ANY failure, which puts the caller on the TTS line.
   */
  greetingAudioUrl(machine: SessionMachine): Promise<string | null>;
}

/** §4.1: is this Telnyx leg alive? GET /v2/calls/{ccid} — the DO-era
 *  re-creation of legacy's durable 'already' verdict. */
async function legAlive(env: Env, ccid: string): Promise<boolean> {
  try {
    const response = (await telnyxRequest(env, {
      method: "GET",
      path: `/v2/calls/${ccid}`,
    })) as { data?: { is_alive?: boolean } };
    return response.data?.is_alive === true;
  } catch (cause) {
    if (cause instanceof TelnyxApiError && cause.status < 500) return false;
    throw cause;
  }
}

/** POST an action, discriminating 4xx by the counterparty leg's liveness:
 *  alive → OUR earlier command succeeded (journal replay / raced duplicate) →
 *  "ok"; dead/not-found → the counterparty is really gone → "dead" (§4.1). */
async function commandWithDiscrimination(
  env: Env,
  ccid: string,
  action: string,
  body: Record<string, unknown>,
): Promise<"ok" | "dead"> {
  try {
    await telnyxRequest(env, {
      method: "POST",
      path: `/v2/calls/${ccid}/actions/${action}`,
      body,
    });
    return "ok";
  } catch (cause) {
    if (cause instanceof TelnyxApiError && cause.status < 500) {
      return (await legAlive(env, ccid)) ? "ok" : "dead";
    }
    throw cause;
  }
}

/** #309: the private bucket recorded greetings live in. */
const GREETING_BUCKET = "voicemail-greetings";

/** 4xx-swallowing hangup/cancel/speak-family command (dead leg = done). */
async function swallow4xx(
  env: Env,
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  try {
    await telnyxRequest(env, { method: "POST", path, body });
  } catch (cause) {
    if (cause instanceof TelnyxApiError && cause.status < 500) return;
    throw cause;
  }
}

interface InboundCompanyRow {
  id: string;
  name: string;
  plan: string | null;
  current_period_start: string | null;
  overage_cap_multiplier: number | string | null;
  subscription_status: string;
  /** #277: the seasonal pause. Optional — a row read before the column shipped
   *  reads undefined, which is coalesced to "not paused" at the gate. */
  paused_at?: string | null;
  call_screening: "off" | "flag" | "divert";
  voicemail_greeting: string | null;
  /** #278: the clock the call path now consults. Every one nullable, because
   *  most workspaces have never set any of them and must keep ringing exactly
   *  as they do today. */
  timezone: string | null;
  business_hours: BusinessHours | null;
  business_hours_exceptions: HoursException[] | null;
  after_hours_calls: AfterHoursCalls | null;
  after_hours_greeting_id: string | null;
  ring_strategy: RingStrategy | null;
  ring_seconds: number | null;
}

/** In-flight window for the line-busy read (mirrors voice-webhook.ts). */
const LINE_BUSY_WINDOW_MS = 4 * 60 * 60 * 1000;

export function createSessionRuntime(env: Env): SessionRuntime {
  const db = getDb(env);
  return {
    now: () => Date.now(),
    uuid: () => crypto.randomUUID(),

    telnyx: {
      async dial(input): Promise<DialResult> {
        try {
          const response = (await telnyxRequest(env, {
            method: "POST",
            path: "/v2/calls",
            body: {
              connection_id: env.TELNYX_VOICE_CONNECTION_ID,
              to: input.sipTarget,
              from: input.fromE164,
              // Makes the ONE non-idempotent command in the journal safe to
              // replay: Telnyx returns 202 + the original call_control_id
              // instead of ringing a second billable leg. Omitted only if a
              // caller has no pendingKey to offer.
              ...(input.commandId ? { command_id: input.commandId } : {}),
              // Load-bearing leg-level bound: it is the outer bound on
              // §7.7's ambiguous-dial orphans — must not be raised (§5).
              timeout_secs: RING_TIMEOUT_SECS,
              client_state: input.clientState,
              // CALLS-CLIENT-V2 §3.2: session-correlation header on the DO
              // (T1d/T4) dial path. Name MUST start with X-; value = the same S
              // as clientState.
              // #212: X-Loonext-Caller carries the REAL caller (from is the
              // owned business number, which Telnyx keeps for the WebRTC leg);
              // omitted entirely for an anonymous/CLIR caller so the client
              // shows "Unknown caller", never our own number.
              custom_headers: [
                { name: LOONEXT_SESSION_HEADER, value: input.sessionId },
                ...(input.caller
                  ? [{ name: LOONEXT_CALLER_HEADER, value: input.caller }]
                  : []),
              ],
            },
          })) as { data?: { call_control_id?: string } };
          const ccid = response.data?.call_control_id;
          if (!ccid) return { failure: "ambiguous" };
          return { ccid };
        } catch (cause) {
          if (cause instanceof TelnyxApiError && cause.status < 500) {
            return { failure: "known-dead" }; // definite Telnyx refusal
          }
          return { failure: "ambiguous" }; // network timeout / 5xx-after-create
        }
      },
      answerInbound: (ccid, clientState) =>
        commandWithDiscrimination(env, ccid, "answer", {
          client_state: clientState,
        }),
      answerVm: (ccid, clientState) =>
        commandWithDiscrimination(env, ccid, "answer", {
          client_state: clientState,
        }),
      bridge: (memberCcid, inboundCcid) =>
        commandWithDiscrimination(env, memberCcid, "bridge", {
          call_control_id: inboundCcid,
        }),
      // #208 F4: hangup discriminates its 4xx (was swallow4xx) so the shell
      // can tell "already dead, no webhook coming" from the routine race.
      hangup: (ccid) => commandWithDiscrimination(env, ccid, "hangup", {}),
      reject: (ccid, cause) =>
        swallow4xx(env, `/v2/calls/${ccid}/actions/reject`, { cause }),
      speak: (ccid, payload, clientState) =>
        swallow4xx(env, `/v2/calls/${ccid}/actions/speak`, {
          payload,
          voice: "female",
          language: "en-US",
          client_state: clientState,
        }),
      playAudio: async (ccid, audioUrl, clientState) => {
        try {
          await telnyxRequest(env, {
            method: "POST",
            path: `/v2/calls/${ccid}/actions/playback_start`,
            body: {
              audio_url: audioUrl,
              client_state: clientState,
              // One pass. A greeting that loops is a caller who cannot get to
              // the beep, which is worse than the robot voice we replaced.
              loop: 1,
            },
          });
          return true;
        } catch (cause) {
          // A 4xx here is the expected failure — a deleted object, an expired
          // signature, a format Telnyx will not fetch. Report it so the caller
          // gets the TTS line. A 5xx is reported the same way for the same
          // reason: the caller is on the phone NOW, and there is no retry that
          // helps them.
          if (cause instanceof TelnyxApiError) return false;
          throw cause;
        }
      },
      recordStart: (ccid) =>
        swallow4xx(env, `/v2/calls/${ccid}/actions/record_start`, {
          format: "mp3",
          channels: "single",
          play_beep: true,
          max_length: 120,
          timeout_secs: 15,
        }),
      probeLegAlive: (ccid) => legAlive(env, ccid),
    },

    async mirror(sessionId, set) {
      // #209 write-time coupling: a terminal state must never be persistable
      // alongside a NULL outcome (tonight's incident: state='ended_answered'
      // + outcome null wedged the line for 4h and rendered as in-progress).
      // Back-fill the outcome FIRST, coalesce-style (`.is("outcome", null)` =
      // outcome = coalesce(outcome, derived) - the api_upsert_call merge owns
      // any richer resolution, e.g. the voicemail-wins upgrade), so whichever
      // write the crash interrupts, the bad pair never lands: outcome-first
      // means a lone first write frees the line and reads as ended, and the
      // mirror-retry alarm re-runs both (the fill is idempotent).
      if (set.state && isTerminal(set.state)) {
        const derived = outcomeForState(set.state);
        if (derived) {
          const { error: outcomeError } = await db
            .from("calls")
            .update({ outcome: derived })
            .eq("call_session_id", sessionId)
            .is("outcome", null);
          if (outcomeError) {
            throw new Error(`calls-v3 mirror failed: ${outcomeError.message}`);
          }
        }
      }
      const { error } = await db
        .from("calls")
        .update(set)
        .eq("call_session_id", sessionId);
      if (error) throw new Error(`calls-v3 mirror failed: ${error.message}`);
    },

    async ledgerInsert(input) {
      const { error } = await db.from("call_member_legs").upsert(
        {
          call_session_id: input.sessionId,
          call_control_id: input.ccid,
          company_id: input.companyId,
          user_id: input.userId,
        },
        {
          onConflict: "call_session_id,call_control_id",
          ignoreDuplicates: true,
        },
      );
      if (error) {
        // Audit-only (§2.2): log, never wedge the journal on it.
        console.error(`calls-v3 ledger insert failed: ${error.message}`);
      }
    },

    async loadInitiatedContext(payload) {
      const callerE164 = normalizeCaller(payload.from);
      const { data: numberRows, error: numberError } = await db
        .from("phone_numbers")
        // #307: the line's OWN identity, if it has one. Null on both columns
        // means inherit, which is every number until somebody sets an
        // override — so this read changes nothing for existing workspaces.
        // #278 adds the clock: a line's own hours, its exceptions, what a
        // call does outside them and which recording says so. All nullable,
        // all meaning INHERIT, so this read changes nothing for a workspace
        // that has never touched any of it.
        .select(
          "id,company_id,status,label,voicemail_greeting,timezone," +
            "business_hours,business_hours_exceptions,after_hours_calls," +
            "after_hours_greeting_id,ring_strategy,ring_seconds",
        )
        .eq("number_e164", payload.to)
        .neq("status", "released")
        .limit(1);
      if (numberError) {
        throw new Error(`phone_numbers lookup failed: ${numberError.message}`);
      }
      const number = numberRows?.[0] as unknown as
        | {
            id: string;
            company_id: string;
            status: string;
            label: string | null;
            voicemail_greeting: string | null;
            timezone: string | null;
            business_hours: BusinessHours | null;
            business_hours_exceptions: HoursException[] | null;
            after_hours_calls: AfterHoursCalls | null;
            after_hours_greeting_id: string | null;
            ring_strategy: RingStrategy | null;
            ring_seconds: number | null;
          }
        | undefined;
      if (!number) return "drop"; // a number we do not own

      // Replay guard (§4 T1): an initiated redelivered after the call ended.
      const { data: priorRows, error: priorError } = await db
        .from("calls")
        .select("outcome")
        .eq("call_session_id", payload.call_session_id)
        .limit(1);
      if (priorError) {
        throw new Error(`initiated replay read failed: ${priorError.message}`);
      }
      if (priorRows?.[0] && (priorRows[0] as { outcome: string | null }).outcome) {
        return "replay-ended";
      }

      const { data: companyRows, error: companyError } = await db
        .from("companies")
        .select(
          "id,name,plan,current_period_start,overage_cap_multiplier," +
            "subscription_status,paused_at,call_screening,voicemail_greeting,timezone," +
            "business_hours,business_hours_exceptions,after_hours_calls," +
            "after_hours_greeting_id,ring_strategy,ring_seconds",
        )
        .eq("id", number.company_id)
        .limit(1);
      if (companyError) {
        throw new Error(`company lookup failed: ${companyError.message}`);
      }
      const company = companyRows?.[0] as unknown as InboundCompanyRow | undefined;
      if (!company) return "drop";

      // Line model (D43, binding): api_claim_inbound_line kept verbatim.
      const { data: busyData, error: busyError } = await db.rpc(
        "api_claim_inbound_line",
        {
          p_company_id: number.company_id,
          p_phone_number_id: number.id,
          p_call_session_id: payload.call_session_id,
          p_caller_e164: callerE164,
          p_window_start: new Date(
            Date.now() - LINE_BUSY_WINDOW_MS,
          ).toISOString(),
        },
      );
      if (busyError) {
        throw new Error(`api_claim_inbound_line failed: ${busyError.message}`);
      }
      const lineBusy = busyData === true;

      // #277: a paused workspace joins the suspended/inactive arm, which means
      // the caller hears the existing "line is down" notice — bounded by
      // companyUnderNoticeCap (#490) — instead of the crew's browsers ringing.
      //
      // Two reasons, and the money is only one of them. A ringing call that
      // somebody answers bills per minute on both legs against a holding fee of
      // a few dollars, which is the same unbounded shape a pause exists to
      // close. But the product reason is the stronger one: a crew that has
      // paused for the winter is not working, and a phone that rings their
      // browsers all season is not a held number, it is the plan they thought
      // they had stopped paying for.
      const suspendedOrInactive =
        number.status === "suspended" ||
        company.subscription_status !== "active" ||
        (company.paused_at ?? null) !== null;
      const overCap = suspendedOrInactive
        ? false
        : await companyOverVoiceCap(db, number.company_id, {
            plan: company.plan as never,
            current_period_start: company.current_period_start,
            overage_cap_multiplier: company.overage_cap_multiplier,
          });

      // #490: may we answer this one to say the line is down?
      //
      // Counted off the `calls` rows we already write, so the cap needs no
      // counter of its own and can never disagree with what actually happened.
      // Asked only when the answer could matter — a healthy line never pays for
      // this query, and this is the inbound hot path where a caller is
      // listening to silence for every millisecond.
      //
      // Fails OPEN to the CHEAP side: if the count cannot be read we do not
      // speak, because the failure we must never have is an unbounded spend on
      // a workspace that is not paying. The caller then hears what they heard
      // before #490, which is a degradation and not a break.
      const noticeAllowed = suspendedOrInactive
        ? await companyUnderNoticeCap(db, number.company_id)
        : false;

      // v2 metadata stamp (screening verdict, attestation, dipped name, the
      // customer leg's ccid) onto the inbound calls row.
      const { error: metaError } = await db
        .from("calls")
        .update({
          screening_result: payload.call_screening_result ?? null,
          stir_attestation: payload.shaken_stir_attestation ?? null,
          caller_name: payload.caller_id_name ?? null,
          customer_call_control_id: payload.call_control_id,
        })
        .eq("call_session_id", payload.call_session_id);
      if (metaError) {
        throw new Error(`call metadata stamp failed: ${metaError.message}`);
      }

      const screeningDivert =
        company.call_screening === "divert" &&
        screeningFlagged(payload.call_screening_result);

      const { dialTargets, pushAudience } = await computeRingContext(
        db,
        number.company_id,
        number.id,
      );

      const identity = resolveNumberIdentity(
        {
          name: company.name,
          // #278: the clock is REAL on this path now. It was "" and null
          // before because nothing on the call side had ever consulted the
          // hours the away-reply has been using since #402.
          timezone: company.timezone ?? "",
          voicemailGreeting: company.voicemail_greeting,
          awayMessage: null,
          awayEnabled: false,
          businessHours: company.business_hours,
          businessHoursExceptions: company.business_hours_exceptions,
          // Not read on this path — mctb resolves where the missed call is
          // handled. Passed because CompanyIdentity is one shape: a resolver
          // with optional halves would let a caller forget the half it does
          // need.
          mctbEnabled: false,
          mctbMessage: null,
          // Not read on this path — the recording is resolved where the
          // greeting actually plays (greetingAudioUrl). Passed because
          // CompanyIdentity is one shape.
          voicemailGreetingId: null,
          afterHoursCalls: company.after_hours_calls ?? "ring_everyone",
          // Resolved here so the LINE's selection wins, then read again at
          // play time for the same reason the ordinary one is (see
          // greetingAudioUrl) — this half only decides the routing.
          afterHoursGreetingId: company.after_hours_greeting_id,
          // A workspace row's values are NOT NULL in the schema; the coalesces
          // are for a row read before the columns existed, which resolve to
          // the behaviour that predates them.
          ringStrategy: company.ring_strategy ?? "all",
          ringSeconds: company.ring_seconds ?? RING_SECONDS_MAX,
        },
        {
          label: number.label,
          voicemailGreeting: number.voicemail_greeting,
          timezone: number.timezone,
          businessHours: number.business_hours,
          businessHoursExceptions: number.business_hours_exceptions,
          afterHoursCalls: number.after_hours_calls,
          afterHoursGreetingId: number.after_hours_greeting_id,
          ringStrategy: number.ring_strategy,
          ringSeconds: number.ring_seconds,
        },
      );

      // #278 — the clock, asked once, on the instant the caller rang.
      //
      // Every uncertainty answers "not after hours", which rings exactly as
      // the product does today: no timezone, no schedule, an unknown IANA
      // zone. That is the #244 rule on the call side — reaching nobody is a
      // customer who rings a competitor, and it is the failure only they find
      // out about.
      const now = new Date();
      const clockTz = identity.timezone.value;
      const clockHours = identity.businessHours.value as BusinessHours | null;
      const afterHours =
        Boolean(clockTz) &&
        Boolean(clockHours) &&
        isAfterHours(
          clockTz,
          clockHours as BusinessHours,
          now,
          identity.businessHoursExceptions.value as HoursException[] | null,
        );
      const nextOpenLabel = afterHours
        ? (nextOpening(
            clockTz,
            clockHours,
            now,
            identity.businessHoursExceptions.value as HoursException[] | null,
          )?.label ?? null)
        : null;

      // #278 — after hours, who is actually reachable?
      //
      // `on_call_only` and `voicemail` both narrow to whoever is holding the
      // phone (#244's shift), which is where the issue's emergency path lives:
      // hours-based routing with no hole in it is how a 3am burst pipe reaches
      // nobody. Only when NOBODY is on call do the two differ — one rings
      // everybody anyway, the other takes a message.
      let routedTargets = dialTargets;
      let routedAudience = pushAudience;
      let afterHoursVoicemail = false;
      const mode = identity.afterHoursCalls.value;
      if (afterHours && mode !== "ring_everyone") {
        const onCallUserId = await onCallMemberNow(
          db,
          number.company_id,
          number.id,
          now,
        );
        if (onCallUserId) {
          const narrowedTargets = dialTargets.filter(
            (target) => target.userId === onCallUserId,
          );
          const narrowedAudience = pushAudience.filter(
            (userId) => userId === onCallUserId,
          );
          // If the person on call can be reached at all, they are the only one
          // rung. If they can be reached by NEITHER channel, narrowing would
          // silence the call entirely — so the whole crew rings instead, which
          // is the same widen-on-uncertainty rule.
          if (narrowedTargets.length > 0 || narrowedAudience.length > 0) {
            routedTargets = narrowedTargets;
            routedAudience = narrowedAudience;
          }
        } else if (mode === "voicemail") {
          afterHoursVoicemail = true;
        }
      }

      return {
        callSessionId: payload.call_session_id,
        inboundCcid: payload.call_control_id,
        companyId: number.company_id,
        phoneNumberId: number.id,
        // #307: the identity this CALLER meets, resolved once so the greeting
        // and the name it uses cannot disagree. A line with no overrides
        // resolves to exactly the company values used before this existed.
        companyName: identity.label.value,
        greeting: identity.voicemailGreeting.value,
        callerE164,
        businessNumberE164: payload.to,
        lineBusy,
        screeningDivert,
        afterHours,
        nextOpenLabel,
        afterHoursVoicemail,
        ringStrategy: identity.ringStrategy.value,
        // Clamped here as well as at the column, because this value decides
        // when a caller stops hearing ringback and the machine must never be
        // handed a window it cannot honour.
        ringSeconds: clampRingSeconds(identity.ringSeconds.value),
        suspendedOrInactive,
        noticeAllowed,
        overCap,
        dialTargets: routedTargets,
        pushAudience: routedAudience,
      };
    },

    async loadOutboundInitiatedContext(payload) {
      // (1) The tag's part-4 (S) MUST be a well-formed UUID and its part-3 the
      //     nonce. The router validated part-4 before idFromName; re-validate
      //     here (defense in depth) BEFORE any RPC/idFromName/PK use (S1).
      const embeddedSession = parseOutboundSessionId(payload.client_state);
      const nonce = parseOutboundNonce(payload.client_state);
      const callControlId = payload.call_control_id;
      const businessNumberE164 = payload.from; // we present the business number
      if (!embeddedSession || !nonce || !callControlId || !businessNumberE164) {
        return "reject";
      }

      // (1.5) #213 defense-in-depth: the oc leg MUST be the SERVER-dialed customer
      //       leg (voice connection, no WebRTC headers). A leg carrying any
      //       X-RTC-* custom header is a browser/WebRTC leg — the placer, NEVER the
      //       customer; stamping it as customer_call_control_id is exactly the #213
      //       wrong-bridge. Reject it (hang up + mint nothing) so a future
      //       regression that re-routes a browser leg here fails HONESTLY instead
      //       of silently hijacking the transfer target. The server's own oc dial
      //       carries only X-Loonext-Session, so this never trips in practice.
      if (
        (payload.custom_headers ?? []).some((header) =>
          /^x-rtc/i.test(header?.name ?? ""),
        )
      ) {
        Sentry.captureMessage(
          `#213 guard: oc call.initiated for ${embeddedSession} carried an X-RTC-* ` +
            `header (a browser/placer leg, not the customer) — rejected to prevent ` +
            `a wrong-leg customer_call_control_id stamp`,
          "warning",
        );
        return "reject";
      }

      // (2) #136: enforce US/CA on the TELNYX-REPORTED destination (payload.to,
      //     unforgeable) — NEVER the browser-echoed customer, which a member
      //     could keep benign while dialing a premium/Caribbean number.
      const customerE164 = normalizeNanpPhone(payload.to ?? "");
      if (!customerE164) return "reject";

      // (3) Consume the nonce. api_authorize_outbound_call DERIVES the calls-row
      //     PK from the STORED S (never the caller's tag) and RETURNS it, and
      //     creates the row under it (bound to the AUTHORIZED company/number).
      const { data: authData, error: authError } = await db.rpc(
        "api_authorize_outbound_call",
        {
          p_nonce: nonce,
          p_from: businessNumberE164,
          p_customer: customerE164,
          // The honest client's part-4 IS S; the RPC ignores it in favor of the
          // stored S when one exists (coalesce), so the caller can never
          // substitute a session id.
          p_call_session_id: embeddedSession,
          p_max_age_secs: OUTBOUND_AUTH_MAX_AGE_SECS,
        },
      );
      if (authError) {
        throw new Error(`outbound authorize failed: ${authError.message}`);
      }
      const auth = (authData ?? {}) as {
        authorized?: boolean;
        company_id?: string;
        phone_number_id?: string;
        replay?: boolean;
        session_id?: string;
        user_id?: string | null;
      };
      if (
        !auth.authorized ||
        !auth.company_id ||
        !auth.phone_number_id ||
        !auth.session_id
      ) {
        // Forged / expired / already-consumed nonce, mismatched caller number,
        // or a leg that skipped /calls/browser — refuse it (mint nothing).
        return "reject";
      }

      // (4) S1/M3 — the ONE-id gate: the row PK the RPC returns MUST equal the
      //     tag's part-4. A forger supplying a wrong part-4 for their OWN valid
      //     nonce lands on their own nonce-bound S (session_id != part-4) →
      //     reject WITHOUT minting (bounded self-DoS on their own line, sweeper-
      //     freed), NEVER binding a victim's row. The stamp below never runs.
      if (auth.session_id !== embeddedSession) return "reject";

      // (5) #211 call-hijack fix: a REPLAY is a re-delivery of an ALREADY-
      //     authorized initiated: its row + machine were minted (and stamped)
      //     by the FRESH delivery. DROP it here (acked no-op, NEVER "reject": a
      //     reject would hang up what, on a genuine replay, is the LIVE customer
      //     leg). A live DO absorbs the redelivery via the reducer's machine-
      //     exists guard; an EVICTED DO reconstructs from the row on the next
      //     non-initiated event. Returning a mint-capable context on replay was
      //     the forgery vector: a random nonce misses the DELETE, falls to the
      //     RPC replay branch, and (on an evicted DO) reduceOutboundInitiated
      //     would re-mint a machine + stamp customer_call_control_id from a
      //     CALLER-SUPPLIED session id (S_v), hijacking the victim leg. No mint,
      //     no stamp, no DB write derived from the caller's id on replay.
      if (auth.replay) return "drop";

      // (6) Defense in depth: a subscription that LAPSED between authorize and
      //     dial must not connect (port of voice-webhook.ts). Keyed on the
      //     AUTHORIZED company. Only a FRESH mint reaches here (replay dropped).
      {
        const { data: companyRows, error: companyError } = await db
          .from("companies")
          .select(
            "plan,current_period_start,overage_cap_multiplier,subscription_status,paused_at",
          )
          .eq("id", auth.company_id)
          .limit(1);
        if (companyError) {
          throw new Error(`outbound company lookup failed: ${companyError.message}`);
        }
        const company = (companyRows ?? [])[0] as
          | (CompanyVoiceState & {
              subscription_status: string;
              paused_at: string | null;
            })
          | undefined;
        if (
          !company ||
          company.subscription_status !== "active" ||
          // #277: a workspace that PAUSED between authorize and dial must not
          // connect either — a paused subscription is genuinely `active`, so
          // the status test above cannot see it. Same defence-in-depth reason
          // as the lapse case it sits beside: the route already refused this,
          // and this is the check that holds if the route is ever bypassed.
          (company.paused_at ?? null) !== null ||
          (await companyOverVoiceCap(db, auth.company_id, company))
        ) {
          return "reject";
        }
      }

      // (7) S1 defense in depth: stamp the customer leg's control id onto the
      //     S-row. Only a FRESH mint reaches here: the row the RPC just created
      //     from the CONSUMED nonce (never a caller-controlled id). Scoped by
      //     company AND number so even the fresh stamp cannot cross a tenant/
      //     number boundary, AND SET-ONCE (`.is customer_call_control_id null`,
      //     F2b): now that the legacy handleOutboundInitiated stamp is deleted
      //     this is the SOLE outbound stamp path, so it carries the same
      //     scoped+set-once guarantee — a fresh mint's row is null here, and a
      //     replay never reaches this point (dropped at step 5), so the guard is
      //     belt-and-suspenders against any future path that could reach it with
      //     a live row.
      const { error: stampError } = await db
        .from("calls")
        .update({ customer_call_control_id: callControlId })
        .eq("call_session_id", auth.session_id)
        .eq("company_id", auth.company_id)
        .eq("phone_number_id", auth.phone_number_id)
        .is("customer_call_control_id", null);
      if (stampError) {
        throw new Error(`outbound metadata stamp failed: ${stampError.message}`);
      }

      // (8) #213: the placer's SIP credential — the DO dials it as the `op` leg so
      //     the placer's browser rings, auto-answers, and bridges to this oc leg.
      //     Scoped to the AUTHORIZED company + the placing member. A missing
      //     credential (the placer holds none) leaves placerSipUsername null; the
      //     reducer then rings no placer (the oc timeout / janitor resolves it).
      let placerSipUsername: string | null = null;
      if (auth.user_id) {
        const { data: credRows, error: credError } = await db
          .from("member_telephony_credentials")
          .select("sip_username")
          .eq("company_id", auth.company_id)
          .eq("user_id", auth.user_id)
          .limit(1);
        if (credError) {
          throw new Error(`placer credential lookup failed: ${credError.message}`);
        }
        placerSipUsername =
          (credRows?.[0] as { sip_username?: string } | undefined)?.sip_username ??
          null;
      }

      return {
        callSessionId: auth.session_id,
        customerCcid: callControlId,
        companyId: auth.company_id,
        phoneNumberId: auth.phone_number_id,
        userId: auth.user_id ?? null,
        placerSipUsername,
        customer: customerE164,
        businessNumberE164,
      };
    },

    async loadAdoptionRow(sessionId) {
      const { data: rows, error } = await db
        .from("calls")
        .select(
          "call_session_id,company_id,phone_number_id,caller_e164,outcome,answered_at,answered_by_user_id,started_at,customer_call_control_id,direction",
        )
        .eq("call_session_id", sessionId)
        .limit(1);
      if (error) throw new Error(`adoption calls read failed: ${error.message}`);
      const row = rows?.[0] as
        | {
            call_session_id: string;
            company_id: string;
            phone_number_id: string | null;
            caller_e164: string | null;
            outcome: "answered" | "voicemail" | "missed" | null;
            answered_at: string | null;
            answered_by_user_id: string | null;
            started_at: string;
            customer_call_control_id: string | null;
            direction: string | null;
          }
        | undefined;
      if (!row) return null;

      const [companyResult, legsResult, numberResult] = await Promise.all([
        db
          .from("companies")
          .select("name,voicemail_greeting")
          .eq("id", row.company_id)
          .limit(1),
        db
          .from("call_member_legs")
          .select("call_control_id,user_id,state")
          .eq("call_session_id", sessionId)
          .eq("kind", "ring"),
        row.phone_number_id
          ? db
              .from("phone_numbers")
              .select("number_e164")
              .eq("id", row.phone_number_id)
              .limit(1)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (companyResult.error) {
        throw new Error(`adoption company read failed: ${companyResult.error.message}`);
      }
      if (legsResult.error) {
        throw new Error(`adoption ledger read failed: ${legsResult.error.message}`);
      }
      const company = companyResult.data?.[0] as
        | { name: string; voicemail_greeting: string | null }
        | undefined;
      const startedMs = Date.parse(row.started_at);
      return {
        callSessionId: row.call_session_id,
        companyId: row.company_id,
        phoneNumberId: row.phone_number_id,
        callerE164: row.caller_e164,
        outcome: row.outcome,
        answeredAt: row.answered_at,
        answeredByUserId: row.answered_by_user_id,
        startedAtMs: Number.isFinite(startedMs) ? startedMs : Date.now(),
        customerCallControlId: row.customer_call_control_id,
        direction: row.direction,
        companyName: company?.name ?? "this business",
        greeting: company?.voicemail_greeting ?? null,
        businessNumberE164:
          ((numberResult.data ?? [])[0] as { number_e164?: string } | undefined)
            ?.number_e164 ?? null,
        ledgerLegs: (legsResult.data ?? []).map((leg) => ({
          ccid: leg.call_control_id as string,
          userId: leg.user_id as string,
          state: leg.state as string,
        })),
      };
    },

    async memberEligible(companyId, phoneNumberId, userId) {
      if (!phoneNumberId) return false;
      // #480: one resolver. This used to read the rules and apply the #106
      // precedence here, with its own owner/admin override — a third copy of the
      // rule, deciding whose phone rings. `member_number_level` already checks
      // membership and deactivation, so the separate member read is gone too.
      const [cred, level] = await Promise.all([
        db
          .from("member_telephony_credentials")
          .select("sip_username")
          .eq("company_id", companyId)
          .eq("user_id", userId)
          .limit(1),
        db.rpc("member_number_level", {
          p_user_id: userId,
          p_phone_number_id: phoneNumberId,
        }),
      ]);
      // Ringing nobody is the safe direction for a failure here: the caller
      // still reaches voicemail, where a wrongly-rung phone would hand a member
      // a call on a number they were denied.
      if (cred.error || level.error) return false;
      if (!cred.data?.[0]) return false;
      return level.data === "text";
    },

    async computePushAudience(companyId, phoneNumberId) {
      if (!phoneNumberId) return [];
      const { pushAudience } = await computeRingContext(
        db,
        companyId,
        phoneNumberId,
      );
      return pushAudience;
    },

    async pushFanout(input) {
      const report: IncomingCallPushReport = await notifyIncomingCall(
        env,
        db,
        {
          companyId: input.companyId,
          userIds: input.userIds,
          caller: input.caller,
          callSessionId: input.sessionId,
        },
      );
      return { unreachableUserIds: report.unreachableUserIds };
    },

    async pushCallEnd(input) {
      await notifyCallEnd(env, db, {
        companyId: input.companyId,
        userIds: input.userIds,
        callSessionId: input.sessionId,
        reason: input.reason,
        caller: input.caller,
        answeredByUserId: input.answeredByUserId,
      });
    },

    async threadAtAnswer(machine) {
      // Best-effort (§4 T2 step 6): a threading fault must never kill the
      // answer.
      try {
        if (!machine.phoneNumberId) return;
        await threadCallSession(db, {
          companyId: machine.companyId,
          phoneNumberId: machine.phoneNumberId,
          callSessionId: machine.callSessionId,
          caller: machine.callerE164,
          outcome: "answered",
          forwardSeconds: 0,
          direction: "inbound",
        });
      } catch (cause) {
        console.error(
          `calls-v3 answer-time threading failed for ${machine.callSessionId}:`,
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    },

    async terminalMergeEvent(payload, opts) {
      await handleTerminalCallEvent(
        env,
        db,
        "call.hangup",
        payload as never,
        opts,
      );
    },

    async terminalMergeSynthetic(machine, outcome, briAnsweredAtIso) {
      // Outcome + window merge via the convergent RPC (same one the event
      // path uses), then thread + MCTB for the missed path — the delegates
      // are all claim-guarded/idempotent, so a replay never double-texts.
      const endedAtIso = new Date().toISOString();
      let forwardSeconds = 0;
      if (outcome === "answered" && briAnsweredAtIso) {
        const anchorMs = Date.parse(briAnsweredAtIso);
        if (Number.isFinite(anchorMs)) {
          forwardSeconds = Math.max(
            0,
            Math.round((Date.now() - anchorMs) / 1000),
          );
        }
      }
      const { error } = await db.rpc("api_upsert_call", {
        p_company_id: machine.companyId,
        p_phone_number_id: machine.phoneNumberId,
        p_call_session_id: machine.callSessionId,
        p_caller_e164: machine.callerE164,
        p_outcome: outcome,
        p_forward_seconds: forwardSeconds,
        p_started_at: new Date(machine.startedAtMs).toISOString(),
        p_ended_at: endedAtIso,
        // #211 D8: direction-aware — api_upsert_call never changes direction
        // after insert, so this can only ever agree with the row's own value.
        p_direction: machine.direction,
      });
      if (error) {
        throw new Error(`calls-v3 synthetic merge failed: ${error.message}`);
      }
      if (!machine.phoneNumberId) return;
      const thread = await threadCallSession(db, {
        companyId: machine.companyId,
        phoneNumberId: machine.phoneNumberId,
        callSessionId: machine.callSessionId,
        caller: machine.callerE164,
        outcome,
        forwardSeconds,
        direction: machine.direction,
      });
      // #211 D8: the missed-call TEXT-BACK and the #132 crew alert are INBOUND
      // behaviors — a janitor-resolved OUTBOUND no-answer must NEVER text the
      // customer "sorry we missed you" (the event path already guards on
      // outboundLeg; this closes the synthetic path). Threading above already
      // ran (join-only), so the journey line is intact either way.
      if (machine.direction === "outbound") return;
      if (outcome !== "missed" || !machine.callerE164 || !machine.businessNumberE164) {
        return;
      }
      const textBack = await sendMissedCallText(env, db, {
        companyId: machine.companyId,
        phoneNumberId: machine.phoneNumberId,
        fromNumberE164: machine.businessNumberE164,
        callerE164: machine.callerE164,
        callId: machine.callSessionId,
      });
      if (!textBack.alerted && thread?.eventInserted && thread.conversationId) {
        try {
          await notifyMissedCall(
            env,
            {
              companyId: machine.companyId,
              conversationId: thread.conversationId,
              callerE164: machine.callerE164,
              textStatus: "none",
            },
            db,
          );
        } catch (cause) {
          console.error(
            `calls-v3 missed-call alert failed for ${machine.callSessionId}:`,
            cause instanceof Error ? cause.message : String(cause),
          );
        }
      }
    },

    async voicemailPipeline(payload) {
      await handleVoicemailSaved(env, db, payload as never);
    },

    sentryWarn(message) {
      Sentry.captureMessage(message, "warning");
    },
    sentryError(cause) {
      Sentry.captureException(cause);
    },

    buildClientStates: {
      memberRing: (input) => buildMemberRingState(input),
      briAnswered: (caller, answeredAtIso) =>
        buildBrowserAnsweredState(caller, answeredAtIso),
      vmi: (caller) => buildVoicemailState(caller),
      outboundPlacer: (sessionId, userId) =>
        buildOutboundPlacerState(sessionId, userId),
    },

    greetingText(machine) {
      // #518: the owner's words, and nothing appended to them.
      //
      // #278 does NOT change that, and the distinction is the whole reason
      // this reads the way it does. What gains a sentence is OUR OWN default
      // greeting — the one a workspace hears because it never wrote one. An
      // owner who wrote their own gets exactly their own, after hours or not,
      // because #518 settled that: a sentence of ours bolted onto the end of
      // theirs, in our voice, on every call, is not an improvement they asked
      // for. Their honesty about their own hours is theirs to write.
      const own = (machine.greeting ?? "").trim();
      if (own) return sanitizeGreeting(machine.greeting, machine.companyName);
      return machine.afterHours
        ? afterHoursDefaultGreeting(machine.companyName, machine.nextOpenLabel)
        : sanitizeGreeting(null, machine.companyName);
    },

    async greetingAudioUrl(machine) {
      if (!machine.phoneNumberId) return null;
      const db = getDb(env);

      // One read: the line's selection and the workspace's, together. #307's
      // rule — null on the number means INHERIT, never "no greeting".
      const [numberRes, companyRes] = await Promise.all([
        db
          .from("phone_numbers")
          .select("voicemail_greeting_id,after_hours_greeting_id")
          .eq("id", machine.phoneNumberId)
          .limit(1),
        db
          .from("companies")
          .select("voicemail_greeting_id,after_hours_greeting_id")
          .eq("id", machine.companyId)
          .limit(1),
      ]);
      // No throw on error, deliberately: every failure here means TTS, and a
      // caller on the line gets words rather than an exception nobody can act
      // on before they hang up.
      type GreetingSelection = {
        voicemail_greeting_id: string | null;
        after_hours_greeting_id: string | null;
      };
      const numberSel = (numberRes.data ?? [])[0] as GreetingSelection | undefined;
      const companySel = (companyRes.data ?? [])[0] as GreetingSelection | undefined;

      // #278: after hours, the after-hours recording if there IS one, and the
      // ordinary one otherwise. Four values in one precedence, and the order
      // matters twice over: the line beats the workspace (#307), and the
      // situation beats the general case — but a workspace that recorded an
      // after-hours greeting and a line that recorded only an ordinary one
      // should play the LINE's, because that is the identity the caller
      // reached. Null anywhere falls through rather than silencing anything.
      const selected =
        (machine.afterHours
          ? (numberSel?.after_hours_greeting_id ??
            numberSel?.voicemail_greeting_id ??
            companySel?.after_hours_greeting_id ??
            companySel?.voicemail_greeting_id)
          : (numberSel?.voicemail_greeting_id ??
            companySel?.voicemail_greeting_id)) ?? null;
      if (!selected) return null;

      const { data: rows } = await db
        .from("voicemail_greetings")
        .select("storage_path")
        .eq("id", selected)
        .eq("company_id", machine.companyId)
        .limit(1);
      const path = ((rows ?? [])[0] as { storage_path: string } | undefined)?.storage_path;
      if (!path) return null;

      // Long enough to survive a slow fetch on Telnyx's side, short enough
      // that a leaked URL is not a standing read of the workspace's audio.
      const { data: signed } = await db.storage
        .from(GREETING_BUCKET)
        .createSignedUrl(path.replace(`${GREETING_BUCKET}/`, ""), 300);
      return signed?.signedUrl ?? null;
    },
  };
}

/**
 * #490 — has this company been spoken fewer than the daily ceiling of
 * suspended-line notices?
 *
 * Counts the `calls` rows already written for today rather than keeping a
 * counter, so there is nothing to drift and nothing to reset. `head: true`
 * asks PostgREST for the count alone — no rows cross the wire on a path where
 * a caller is listening to silence.
 *
 * The day boundary is UTC and deliberately not the company's timezone: this is
 * a spend ceiling, not a report, and a caller does not care which midnight it
 * resets on.
 *
 * Fails CLOSED to the cheap side. A count we cannot read means we do not
 * spend — the caller hears the ring-out they heard before #490, which is a
 * degradation rather than a break, and the alternative is an unbounded bill on
 * a workspace that is not paying.
 */
async function companyUnderNoticeCap(
  db: ReturnType<typeof getDb>,
  companyId: string,
): Promise<boolean> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count, error } = await db
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("notice_spoken", true)
    .gte("started_at", since.toISOString());
  if (error) return false;
  return (count ?? 0) < MAX_UNAVAILABLE_NOTICES_PER_DAY;
}

/**
 * §4 T1d / §5.4: the dial targets AND the push audience, both #106-'text'
 * filtered; the audience additionally requires a push channel AND the #146
 * push_enabled pref (the SAME filter the delivery delegate applies — §5.5,
 * review R2-I1).
 */
export async function computeRingContext(
  db: SupabaseClient,
  companyId: string,
  phoneNumberId: string,
): Promise<{
  dialTargets: { userId: string; sipUsername: string }[];
  pushAudience: string[];
}> {
  const [credentials, members, rules, prefs] = await Promise.all([
    db
      .from("member_telephony_credentials")
      .select("user_id,sip_username")
      .eq("company_id", companyId),
    db
      .from("company_members")
      .select("user_id,role")
      .eq("company_id", companyId)
      .is("deactivated_at", null)
      .order("created_at", { ascending: true }),
    // #480: the one resolver, asked backwards — every active member of this
    // number's company with their effective level.
    db.rpc("number_member_levels", { p_phone_number_id: phoneNumberId }),
    db
      .from("notification_prefs")
      .select("user_id,push_enabled")
      .eq("company_id", companyId),
  ]);
  if (members.error) {
    throw new Error(`member list failed: ${members.error.message}`);
  }

  // Neither push table carries a company, so the only correct bound is the
  // people who could actually be rung. Read unscoped they return every row in
  // the project, which PostgREST truncates at its max-rows ceiling: past that,
  // whether a given member appears depends on an arbitrary page and their phone
  // is simply never woken. Scoping to this company's members also keeps the
  // read proportional to the crew rather than to the whole platform.
  const memberIds = (members.data ?? []).map(
    (member) => member.user_id as string,
  );
  const [subs, tokens] = await Promise.all([
    memberIds.length === 0
      ? { data: [], error: null }
      : db.from("push_subscriptions").select("user_id").in("user_id", memberIds),
    memberIds.length === 0
      ? { data: [], error: null }
      : db.from("device_push_tokens").select("user_id").in("user_id", memberIds),
  ]);
  if (credentials.error) {
    throw new Error(`credential list failed: ${credentials.error.message}`);
  }
  if (rules.error) {
    throw new Error(`number_access read failed: ${rules.error.message}`);
  }
  // Treat the push-channel reads like their siblings: a TRANSIENT failure must
  // fail the whole initiated context (Telnyx retries) rather than silently
  // empty the push audience — for a push-only crew that would short-circuit a
  // real incoming call straight to voicemail.
  if (subs.error) {
    throw new Error(`push_subscriptions read failed: ${subs.error.message}`);
  }
  if (tokens.error) {
    throw new Error(`device_push_tokens read failed: ${tokens.error.message}`);
  }
  if (prefs.error) {
    // Prefs default to enabled when a row is absent, so an empty map is safe
    // enough to proceed — but don't let a transient failure pass unseen.
    Sentry.captureException(
      new Error(`notification_prefs read failed: ${prefs.error.message}`),
    );
  }
  // #480: the levels come from the one resolver now, keyed by user.
  const levelByUser = new Map(
    ((rules.data ?? []) as { user_id: string; level: string }[]).map((row) => [
      row.user_id,
      row.level,
    ]),
  );
  const sipByUser = new Map(
    (credentials.data ?? []).map((row) => [
      row.user_id as string,
      row.sip_username as string,
    ]),
  );
  const prefByUser = new Map(
    (prefs.error ? [] : (prefs.data ?? [])).map((row) => [
      (row as { user_id: string }).user_id,
      (row as { push_enabled: boolean | null }).push_enabled,
    ]),
  );
  // subs/tokens errors already threw above, so these reads are safe.
  const channelUsers = new Set<string>([
    ...(subs.data ?? []).map((row) => (row as { user_id: string }).user_id),
    ...(tokens.data ?? []).map((row) => (row as { user_id: string }).user_id),
  ]);

  const dialTargets: { userId: string; sipUsername: string }[] = [];
  const pushAudience: string[] = [];
  for (const member of members.data ?? []) {
    const userId = member.user_id as string;
    // Only full-use members are rung or pushed for a call. A notes-only member
    // reads the thread; handing them the phone would let them speak to a
    // customer on a number they were denied texting on.
    if (levelByUser.get(userId) !== "text") continue;
    /**
     * #581 — and the ROLE, which this loop had in hand and never asked.
     *
     * Number level answers "which lines may this person work on". Since the #315
     * presets it stopped answering "may this person work on lines at all", and
     * the two questions came apart: on a number with no access rules — the state
     * of every number until somebody writes one — the resolver's default level is
     * `text` for the whole company. So `bookkeeper`, the preset documented and
     * unit-tested as the one role that never sees a customer, was rung and pushed
     * for every inbound call, and the push carries the caller's number in its
     * title.
     *
     * Two capabilities rather than one, because the two audiences are different
     * acts. Being RUNG means being handed a live line to speak to a customer on,
     * which is `conversations.send`. Being PUSHED means being told a customer's
     * number, which is `conversations.read`. A `read_only` member legitimately
     * gets the second and must never get the first.
     *
     * Fails CLOSED on a role this build has not heard of, because
     * `roleHasCapability` does — the enum can grow a value ahead of a deployed
     * Worker, and the safe side of that window is a missed notification rather
     * than a leaked number.
     *
     * The sibling audience builder (`auth/conversation-audience.ts`) got this
     * fix; this one was missed. Two builders, one rule, and the one that
     * disagreed was the gap.
     */
    const role = member.role as Parameters<typeof roleHasCapability>[0];
    const sip = sipByUser.get(userId);
    if (sip && roleHasCapability(role, "conversations.send")) {
      dialTargets.push({ userId, sipUsername: sip });
    }
    const pushEnabled = prefByUser.get(userId) ?? true;
    if (
      pushEnabled &&
      channelUsers.has(userId) &&
      roleHasCapability(role, "conversations.read")
    ) {
      pushAudience.push(userId);
    }
  }
  return { dialTargets, pushAudience };
}

/**
 * #278/#244 — who is holding the phone right now, or null.
 *
 * `api_on_call_now` is the same RPC the alert fan-out asks, deliberately: "who
 * is on call" must have one answer, and a call and the missed-call push that
 * follows it disagreeing about who that is would be worse than neither
 * narrowing at all.
 *
 * NULL IS AN ANSWER, not a missing value — most crews will never set a shift,
 * and that is the commonest state in the product. A failed read is ALSO null,
 * which widens: the caller's line then rings exactly as it does today rather
 * than being narrowed on the strength of a lookup that did not work.
 */
async function onCallMemberNow(
  db: SupabaseClient,
  companyId: string,
  phoneNumberId: string,
  at: Date,
): Promise<string | null> {
  const { data, error } = await db.rpc("api_on_call_now", {
    p_company_id: companyId,
    p_phone_number_id: phoneNumberId,
    p_at: at.toISOString(),
  });
  if (error) {
    // Loud for us, invisible to the caller. Narrowing a live call on a read we
    // could not perform is the one thing this must not do.
    Sentry.captureMessage(
      `#278 on-call lookup failed for ${companyId}: ${error.message}`,
      "warning",
    );
    return null;
  }
  return typeof data === "string" && data ? data : null;
}

/** Build the answer-intent bri tag payload for a T2 answer. */
export function briTagFor(
  machine: SessionMachine,
  intent: AnswerIntent,
): string {
  return buildBrowserAnsweredState(machine.callerE164, intent.answeredAtIso);
}

/** Re-export for the shell: the greeting fallback. */
export { defaultGreeting, RING_WINDOW_SECS };
