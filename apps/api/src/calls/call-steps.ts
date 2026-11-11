/**
 * #725: what one transition of the call machine did, as steps on the call's
 * own timeline. Derived from the machine before and after, in the one place
 * every transition passes through, so a new reducer path cannot forget to
 * record itself.
 */
import type { CallStepKind } from "@loonext/shared";

import { isTerminal, type SessionMachine } from "./transitions";

export interface CallStep {
  kind: CallStepKind;
  atMs: number;
  /** The member who acted; null for the customer or the system. */
  actorUserId: string | null;
  actorType: "customer" | "system";
  payload: Record<string, unknown>;
}

const VOICEMAIL_STATES = new Set(["voicemail_greeting", "voicemail_recording"]);

export function callStepsBetween(
  before: SessionMachine | null,
  after: SessionMachine,
  nowMs: number,
): CallStep[] {
  const steps: CallStep[] = [];
  const step = (
    kind: CallStepKind,
    payload: Record<string, unknown> = {},
    actorUserId: string | null = null,
    actorType: CallStep["actorType"] = "system",
    atMs = nowMs,
  ) => steps.push({ kind, atMs, actorUserId, actorType, payload });

  if (before === null) {
    if (after.direction === "outbound") {
      step("call_placed", {}, after.answeredByUserId, "system", after.startedAtMs);
    } else {
      step("call_arrived", { routing: after.routing ?? null }, null, "customer", after.startedAtMs);
    }
  }

  // An outbound call's only leg is the placer's own, which is not a ring.
  if (after.direction === "inbound") {
    const known = new Set((before?.legs ?? []).map((leg) => leg.userId + "|" + leg.dialedAtMs));
    const fresh = after.legs.filter((leg) => !known.has(leg.userId + "|" + leg.dialedAtMs));
    const engine = [...new Set(fresh.filter((l) => l.source === "engine").map((l) => l.userId))];
    const asked = [...new Set(fresh.filter((l) => l.source === "ring_me").map((l) => l.userId))];
    if (engine.length > 0) step("call_rang", { user_ids: engine });
    if (asked.length > 0) step("call_rang", { user_ids: asked, asked: true });

    const declined = new Set(before?.declinedUserIds ?? []);
    for (const userId of after.declinedUserIds) {
      if (!declined.has(userId)) step("call_declined", {}, userId);
    }
  }

  // A transfer hands an answered call to another member: that is a pickup too.
  const pickedUp =
    after.state === "answered" &&
    (before?.state !== "answered" ||
      (after.direction === "inbound" && before.answeredByUserId !== after.answeredByUserId));
  if (pickedUp) {
    if (after.direction === "outbound") step("call_answered", {}, null, "customer");
    else step("call_answered", {}, after.answeredByUserId);
  }

  if (VOICEMAIL_STATES.has(after.state) && !(before && VOICEMAIL_STATES.has(before.state))) {
    step("call_voicemail", { cause: after.voicemailCause ?? after.routing ?? null });
  }

  if (isTerminal(after.state) && !(before && isTerminal(before.state))) {
    step("call_ended", {
      reason: after.endedReason ?? null,
      seconds: Math.max(0, Math.round((nowMs - after.startedAtMs) / 1000)),
    });
  }
  return steps;
}
