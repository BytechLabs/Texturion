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
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type CallState = "dialing" | "ringing" | "answered" | "voicemail_greeting" | "voicemail_recording" | "ended_answered" | "ended_voicemail" | "ended_missed" | "ended_rejected";

export const callMachine = defineMachine<CallState>({
  id: "call",
  description: "An inbound or outbound call (calls v3, docs/CALLS-V3.md section 3.1).",
  authority: "internal",
  db: {
    kind: "check",
    columns: [{ table: "calls", column: "state" }],
    nullable: true,
  },
  states: ["dialing", "ringing", "answered", "voicemail_greeting", "voicemail_recording", "ended_answered", "ended_voicemail", "ended_missed", "ended_rejected"],
  initial: ["dialing", "ringing", "voicemail_greeting"],
  transitions: {
    dialing: ["answered", "ended_missed"],
    ringing: ["answered", "voicemail_greeting", "ended_missed", "ended_answered", "ended_rejected"],
    answered: ["ended_answered"],
    voicemail_greeting: ["voicemail_recording", "ended_missed"],
    voicemail_recording: ["ended_voicemail", "ended_missed"],
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
    ended_missed: [{ action: "call_back", capability: "conversations.send" }],
    ended_voicemail: [{ action: "call_back", capability: "conversations.send" }],
  }),
});
