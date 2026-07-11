/**
 * eventSentence — the one switch every timeline system line flows through.
 * #129 pins the call lines (the thread must read as the full history, texts
 * AND calls) and the forward-compat null for unknown types.
 */
import { describe, expect, it } from "vitest";

import type { ConversationEvent } from "@/lib/api/types";

import { eventSentence } from "./system-line";

function event(
  type: string,
  payload: Record<string, unknown> = {},
): ConversationEvent {
  return {
    id: "e-1",
    conversation_id: "c-1",
    actor_user_id: null,
    type: type as ConversationEvent["type"],
    payload,
    created_at: "2026-07-10T15:00:00Z",
  };
}

const noMember = () => null;

describe("eventSentence — #129 call lines", () => {
  it("narrates an answered call with its talk time", () => {
    expect(
      eventSentence(
        event("call_completed", { outcome: "answered", forward_seconds: 272 }),
        noMember,
      ),
    ).toBe("Call answered · 4m 32s");
  });

  it("narrates an answered call without a duration plainly", () => {
    expect(
      eventSentence(
        event("call_completed", { outcome: "answered", forward_seconds: 0 }),
        noMember,
      ),
    ).toBe("Call answered");
  });

  it("narrates voicemail and missed outcomes", () => {
    expect(
      eventSentence(
        event("call_completed", { outcome: "voicemail", forward_seconds: 31 }),
        noMember,
      ),
    ).toBe("Call went to voicemail");
    expect(
      eventSentence(
        event("call_completed", { outcome: "missed", forward_seconds: 0 }),
        noMember,
      ),
    ).toBe("Missed call");
  });

  it("keeps the missed_call text-back line untouched", () => {
    expect(eventSentence(event("missed_call"), noMember)).toBe(
      "This customer called and no one picked up, so we texted them back",
    );
  });

  it("narrates outbound bridge calls from the crew's side (D38)", () => {
    expect(
      eventSentence(
        event("call_completed", {
          outcome: "answered",
          forward_seconds: 192,
          direction: "outbound",
        }),
        noMember,
      ),
    ).toBe("You called · 3m 12s");
    expect(
      eventSentence(
        event("call_completed", {
          outcome: "missed",
          forward_seconds: 0,
          direction: "outbound",
        }),
        noMember,
      ),
    ).toBe("Called, no answer");
  });

  it("renders nothing for unknown event types (forward compatibility)", () => {
    expect(
      eventSentence(event("some_future_event_type"), noMember),
    ).toBeUndefined();
  });
});
