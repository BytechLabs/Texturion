/**
 * eventSentence — the one switch every timeline system line flows through.
 * #129 pins the call lines (the thread must read as the full history, texts
 * AND calls) and the forward-compat null for unknown types.
 */
import { describe, expect, it, vi } from "vitest";

import type { ConversationEvent } from "@/lib/api/types";

// D43: SystemLine renders the voicemail player, whose data hook chains to the
// env-validated API client — mocked out so this stays a pure-sentence test.
vi.mock("@/components/calls/voicemail-player", () => ({
  VoicemailPlayer: () => null,
}));

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

  it("names who picked the call up (#517)", () => {
    // "Call answered" left out the one thing the rest of the crew wanted to
    // know: whether anyone actually dealt with it, and which of them.
    const named = (userId: string | null) =>
      userId === "u1" ? "Sam Ortiz" : null;
    expect(
      eventSentence(
        event("call_completed", {
          outcome: "answered",
          forward_seconds: 272,
          answered_by_user_id: "u1",
        }),
        named,
      ),
    ).toBe("Call answered by Sam Ortiz · 4m 32s");
  });

  it("falls back to the bare line when the answerer cannot be named", () => {
    // A call answered before the server started reporting it, or answered by
    // somebody since off the roster. "Call answered by " with nothing after it
    // is worse than the line it replaced.
    expect(
      eventSentence(
        event("call_completed", {
          outcome: "answered",
          forward_seconds: 0,
          answered_by_user_id: "gone",
        }),
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
