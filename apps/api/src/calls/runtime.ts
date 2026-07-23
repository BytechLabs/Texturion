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
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { levelFromRules, type NumberAccessRule } from "../auth/number-access";
import { getDb } from "../db";
import type { Env } from "../env";
import {
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
import { isTerminal, outcomeForState, RING_WINDOW_SECS } from "./transitions";

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
  businessNumberE164: string | null;
  ledgerLegs: { ccid: string; userId: string; state: string }[];
}

export interface SessionRuntime {
  now(): number;
  uuid(): string;
  legacyKillSwitch(): boolean;
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
  };
  greetingText(machine: SessionMachine): string;
}

/** True when the §12.4 kill switch is flipped. */
export function callsV3LegacyMode(env: Env): boolean {
  const raw = env.CALLS_V3_LEGACY;
  return raw === "1" || raw === "true";
}

/** True when the v3 path is live: DO binding present AND the kill switch is
 *  not flipped. The binding guard fails loudly via Sentry at the call sites. */
export function callsV3Active(env: Env): boolean {
  return Boolean(env.CALL_SESSIONS) && !callsV3LegacyMode(env);
}

/** #211: true when browser-originated outbound calls should mint the 4-part
 *  session id S at authorize (C1 gate). Requires BOTH the v3 path to be live
 *  (binding present AND no global kill) AND the CALLS_OUTBOUND_V3 flag, so a
 *  global kill or an absent binding reverts NEW outbound calls to the exact
 *  3-part legacy flow — never handing the client a session id the webhook path
 *  will not key on. Defaulted OFF: unset CALLS_OUTBOUND_V3 keeps it dark. */
export function callsOutboundV3Active(env: Env): boolean {
  const raw = env.CALLS_OUTBOUND_V3;
  return callsV3Active(env) && (raw === "1" || raw === "true");
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
  call_screening: "off" | "flag" | "divert";
  voicemail_greeting: string | null;
}

/** In-flight window for the line-busy read (mirrors voice-webhook.ts). */
const LINE_BUSY_WINDOW_MS = 4 * 60 * 60 * 1000;

export function createSessionRuntime(env: Env): SessionRuntime {
  const db = getDb(env);
  return {
    now: () => Date.now(),
    uuid: () => crypto.randomUUID(),
    legacyKillSwitch: () => callsV3LegacyMode(env),

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
              // Load-bearing leg-level bound: it is the outer bound on
              // §7.7's ambiguous-dial orphans — must not be raised (§5).
              timeout_secs: RING_TIMEOUT_SECS,
              client_state: input.clientState,
              // CALLS-CLIENT-V2 §3.2: session-correlation header on the DO
              // (T1d/T4) dial path — present whether or not CALLS_V3_LEGACY is
              // set. Name MUST start with X-; value = the same S as clientState.
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
        .select("id,company_id,status")
        .eq("number_e164", payload.to)
        .neq("status", "released")
        .limit(1);
      if (numberError) {
        throw new Error(`phone_numbers lookup failed: ${numberError.message}`);
      }
      const number = numberRows?.[0] as
        | { id: string; company_id: string; status: string }
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
          "id,name,plan,current_period_start,overage_cap_multiplier,subscription_status,call_screening,voicemail_greeting",
        )
        .eq("id", number.company_id)
        .limit(1);
      if (companyError) {
        throw new Error(`company lookup failed: ${companyError.message}`);
      }
      const company = companyRows?.[0] as InboundCompanyRow | undefined;
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

      const suspendedOrInactive =
        number.status === "suspended" ||
        company.subscription_status !== "active";
      const overCap = suspendedOrInactive
        ? false
        : await companyOverVoiceCap(db, number.company_id, {
            plan: company.plan as never,
            current_period_start: company.current_period_start,
            overage_cap_multiplier: company.overage_cap_multiplier,
          });

      // v2 metadata stamp (screening verdict, attestation, dipped name, the
      // customer leg's ccid) — same write handleInboundInitiated performed.
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

      return {
        callSessionId: payload.call_session_id,
        inboundCcid: payload.call_control_id,
        companyId: number.company_id,
        phoneNumberId: number.id,
        companyName: company.name,
        greeting: company.voicemail_greeting,
        callerE164,
        businessNumberE164: payload.to,
        lineBusy,
        screeningDivert,
        suspendedOrInactive,
        overCap,
        dialTargets,
        pushAudience,
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
            "plan,current_period_start,overage_cap_multiplier,subscription_status",
          )
          .eq("id", auth.company_id)
          .limit(1);
        if (companyError) {
          throw new Error(`outbound company lookup failed: ${companyError.message}`);
        }
        const company = (companyRows ?? [])[0] as
          | (CompanyVoiceState & { subscription_status: string })
          | undefined;
        if (
          !company ||
          company.subscription_status !== "active" ||
          (await companyOverVoiceCap(db, auth.company_id, company))
        ) {
          return "reject";
        }
      }

      // (7) S1 defense in depth: stamp the customer leg's control id onto the
      //     S-row. Only a FRESH mint reaches here: the row the RPC just created
      //     from the CONSUMED nonce (never a caller-controlled id). Scoped by
      //     company AND number so even the fresh stamp cannot cross a tenant/
      //     number boundary.
      const { error: stampError } = await db
        .from("calls")
        .update({ customer_call_control_id: callControlId })
        .eq("call_session_id", auth.session_id)
        .eq("company_id", auth.company_id)
        .eq("phone_number_id", auth.phone_number_id);
      if (stampError) {
        throw new Error(`outbound metadata stamp failed: ${stampError.message}`);
      }

      return {
        callSessionId: auth.session_id,
        customerCcid: callControlId,
        companyId: auth.company_id,
        phoneNumberId: auth.phone_number_id,
        userId: auth.user_id ?? null,
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
      const [cred, member, rules] = await Promise.all([
        db
          .from("member_telephony_credentials")
          .select("sip_username")
          .eq("company_id", companyId)
          .eq("user_id", userId)
          .limit(1),
        db
          .from("company_members")
          .select("role")
          .eq("company_id", companyId)
          .eq("user_id", userId)
          .is("deactivated_at", null)
          .limit(1),
        db
          .from("number_access")
          .select("phone_number_id,principal_kind,principal,level")
          .eq("company_id", companyId)
          .eq("phone_number_id", phoneNumberId),
      ]);
      if (cred.error || member.error || rules.error) return false;
      const role = member.data?.[0]?.role as string | undefined;
      if (!cred.data?.[0] || !role) return false;
      const level =
        role === "owner" || role === "admin"
          ? "text"
          : levelFromRules(
              (rules.data ?? []) as NumberAccessRule[],
              userId,
              role as "admin" | "member",
            );
      return level === "text";
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
    },

    greetingText(machine) {
      return sanitizeGreeting(machine.greeting, machine.companyName);
    },
  };
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
  const [credentials, members, rules, prefs, subs, tokens] = await Promise.all([
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
    db
      .from("number_access")
      .select("phone_number_id,principal_kind,principal,level")
      .eq("company_id", companyId)
      .eq("phone_number_id", phoneNumberId),
    db
      .from("notification_prefs")
      .select("user_id,push_enabled")
      .eq("company_id", companyId),
    db.from("push_subscriptions").select("user_id"),
    db.from("device_push_tokens").select("user_id"),
  ]);
  if (credentials.error) {
    throw new Error(`credential list failed: ${credentials.error.message}`);
  }
  if (members.error) {
    throw new Error(`member list failed: ${members.error.message}`);
  }
  if (rules.error) {
    throw new Error(`number_access read failed: ${rules.error.message}`);
  }
  const accessRules = (rules.data ?? []) as NumberAccessRule[];
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
  const channelUsers = new Set<string>([
    ...(subs.error ? [] : (subs.data ?? [])).map(
      (row) => (row as { user_id: string }).user_id,
    ),
    ...(tokens.error ? [] : (tokens.data ?? [])).map(
      (row) => (row as { user_id: string }).user_id,
    ),
  ]);

  const dialTargets: { userId: string; sipUsername: string }[] = [];
  const pushAudience: string[] = [];
  for (const member of members.data ?? []) {
    const userId = member.user_id as string;
    const role = member.role as string;
    const level =
      role === "owner" || role === "admin"
        ? "text"
        : levelFromRules(accessRules, userId, role as "admin" | "member");
    if (level !== "text") continue;
    const sip = sipByUser.get(userId);
    if (sip) dialTargets.push({ userId, sipUsername: sip });
    const pushEnabled = prefByUser.get(userId) ?? true;
    if (pushEnabled && channelUsers.has(userId)) pushAudience.push(userId);
  }
  return { dialTargets, pushAudience };
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
