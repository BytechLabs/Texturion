import { capabilityActions, defineMachine } from "./define-machine";

/**
 * An inbound or outbound call (calls v3, docs/CALLS-V3.md section 3.1).
 *
 * The only machine that already had an explicit table: reduce() in
 * apps/api/src/calls/transitions.ts owns it and the Durable Object in
 * session-do.ts executes it. This definition restates the edges so the other
 * two clients and the docs read the same graph; it does not replace the
 * reducer. NULL is a legacy row written before the column existed (the
 * constraint admits it); the machine has no state for it.
 *
 * Every live state may end in any terminal state: terminalize() in the reducer
 * picks the ending from the event, and a hangup that arrives after the machine
 * lost a transition (T17) ends the call from wherever it stood, as does the
 * stale-call sweeper (api_sweep_stale_calls). What the edges rule out is going
 * backwards: a live call returning to ringing, or an ended one coming back,
 * except the two late upgrades out of ended_missed. The trigger
 * calls_transition_guard enforces them (#722).
 */
export type CallState = "dialing" | "ringing" | "answered" | "voicemail_greeting" | "voicemail_recording" | "ended_answered" | "ended_voicemail" | "ended_missed" | "ended_rejected";

/** An inbound or outbound call (calls v3, docs/CALLS-V3.md section 3.1). */
export const callMachine = defineMachine<CallState>({
  id: "call",
  authority: "internal",
  db: {
    kind: "check",
    columns: [{ table: "calls", column: "state" }],
    nullable: true,
  },
  states: ["dialing", "ringing", "answered", "voicemail_greeting", "voicemail_recording", "ended_answered", "ended_voicemail", "ended_missed", "ended_rejected"],
  initial: ["dialing", "ringing", "voicemail_greeting"],
  transitions: {
    dialing: ["answered", "ended_answered", "ended_voicemail", "ended_missed", "ended_rejected"],
    ringing: ["answered", "voicemail_greeting", "ended_answered", "ended_voicemail", "ended_missed", "ended_rejected"],
    answered: ["ended_answered", "ended_voicemail", "ended_missed", "ended_rejected"],
    voicemail_greeting: ["voicemail_recording", "ended_answered", "ended_voicemail", "ended_missed", "ended_rejected"],
    voicemail_recording: ["ended_answered", "ended_voicemail", "ended_missed", "ended_rejected"],
    ended_answered: [],
    ended_voicemail: [],
    ended_missed: ["ended_voicemail", "ended_answered"],
    ended_rejected: [],
  },
  entryEffects: {
    ringing: ["push_incoming_call", "arm_ring_alarm", "dial_crew_legs"],
    answered: ["bridge_customer", "cancel_sibling_legs", "thread_call", "push_call_end"],
    voicemail_greeting: ["answer_with_vmi_tag", "speak_greeting", "cancel_live_legs", "push_call_end"],
    voicemail_recording: ["start_recording"],
    ended_missed: ["terminal_merge", "missed_call_text_back", "crew_alert"],
    ended_answered: ["terminal_merge", "bill_from_bri_anchor"],
    ended_voicemail: ["voicemail_pipeline"],
    ended_rejected: ["terminal_merge"],
  },
  actions: capabilityActions<CallState>({
    ringing: [{ action: "answer", capability: "conversations.send" }],
    answered: [{ action: "hang_up", capability: "conversations.send" }, { action: "transfer", capability: "conversations.send" }],
    // Calling back places a NEW call (POST /v1/calls/browser), which any ended
    // call row offers today, so every ended state does.
    ended_answered: [{ action: "call_back", capability: "conversations.send" }],
    ended_missed: [{ action: "call_back", capability: "conversations.send" }],
    ended_voicemail: [{ action: "call_back", capability: "conversations.send" }],
    ended_rejected: [{ action: "call_back", capability: "conversations.send" }],
  }),
});
