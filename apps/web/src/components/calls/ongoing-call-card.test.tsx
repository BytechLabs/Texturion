/**
 * #210 Ongoing card: a live (outcome-null) call renders above the log with
 * the caller's identity and whoever is holding the line — "Ringing…" before
 * anyone answers, the member's display name plus a live mm:ss once someone
 * has, the business line only when the company owns more than one — and the
 * card is absent entirely when nothing is live.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Call, Member, PhoneNumberSummary } from "@/lib/api/types";

// The card resolves member names from the roster the app already fetches and
// lines from the numbers query; both are seeded per test. The transitive
// call-row → voicemail-player chain reaches for the fetch client, so the
// calls hook module is stubbed exactly like calls-view.test.tsx does.
const state: { members: Partial<Member>[]; numbers: Partial<PhoneNumberSummary>[] } =
  {
    members: [],
    numbers: [],
  };

vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({ data: { data: state.members } }),
}));
vi.mock("@/lib/api/numbers", () => ({
  useNumbers: () => ({ data: { data: state.numbers } }),
}));
vi.mock("@/lib/api/calls", () => ({
  useVoicemailUrl: () => ({ data: undefined }),
}));
vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "co-1",
}));

import {
  isOngoingCall,
  liveDurationLabel,
  OngoingCalls,
  ongoingPhase,
} from "./ongoing-call-card";

function liveCall(overrides: Partial<Call> = {}): Call {
  return {
    id: "call-live-1",
    call_session_id: "sess-live-1",
    direction: "inbound",
    caller_e164: "+16135551000",
    contact_id: "ct-1",
    contact_name: "Dana Roofer",
    caller_name: null,
    phone_number_id: "pn-1",
    conversation_id: "conv-1",
    outcome: null,
    state: "ringing",
    forward_seconds: 0,
    screening_result: null,
    stir_attestation: null,
    voicemail_seconds: null,
    answered_by_user_id: null,
    answered_at: null,
    started_at: new Date().toISOString(),
    ...overrides,
  };
}

function render(calls: Call[]): string {
  return renderToStaticMarkup(<OngoingCalls calls={calls} />);
}

describe("liveDurationLabel (#210, pure)", () => {
  it("formats mm:ss with zero-padded seconds", () => {
    const anchor = "2026-07-22T12:00:00.000Z";
    const at = (secs: number) => Date.parse(anchor) + secs * 1000;
    expect(liveDurationLabel(anchor, at(0))).toBe("0:00");
    expect(liveDurationLabel(anchor, at(7))).toBe("0:07");
    expect(liveDurationLabel(anchor, at(65))).toBe("1:05");
    expect(liveDurationLabel(anchor, at(3672))).toBe("61:12");
  });

  it("clamps clock skew — never a negative tick", () => {
    const anchor = "2026-07-22T12:00:00.000Z";
    expect(liveDurationLabel(anchor, Date.parse(anchor) - 5000)).toBe("0:00");
  });
});

describe("ongoingPhase (#210)", () => {
  it("ranks the answer stamp above a lagging state mirror", () => {
    expect(
      ongoingPhase({
        direction: "inbound",
        state: "ringing",
        answered_by_user_id: "u1",
      }),
    ).toBe("answered");
  });

  it("maps the voicemail mirror states and defaults pre-answer to ringing", () => {
    expect(
      ongoingPhase({
        direction: "inbound",
        state: "voicemail_recording",
        answered_by_user_id: null,
      }),
    ).toBe("voicemail");
    expect(
      ongoingPhase({
        direction: "inbound",
        state: null,
        answered_by_user_id: null,
      }),
    ).toBe("ringing");
  });

  it("outbound rows (state null forever) are the crew's own call", () => {
    expect(
      ongoingPhase({
        direction: "outbound",
        state: null,
        answered_by_user_id: null,
      }),
    ).toBe("outbound");
  });
});

describe("OngoingCalls (#210)", () => {
  it("is absent entirely when nothing is live", () => {
    expect(render([])).toBe("");
  });

  it("a ringing call shows the caller and 'Ringing…' with no member", () => {
    state.members = [{ user_id: "u1", display_name: "Sam Mason" }];
    state.numbers = [];
    const html = render([liveCall()]);
    expect(html).toContain("Ongoing");
    expect(html).toContain("Dana Roofer");
    expect(html).toContain("Ringing…");
    expect(html).not.toContain("With ");
    expect(html).not.toContain("Sam Mason");
  });

  it("an answered call names the member on the line with a live mm:ss", () => {
    state.members = [{ user_id: "u1", display_name: "Sam Mason" }];
    state.numbers = [];
    const html = render([
      liveCall({
        state: "answered",
        answered_by_user_id: "u1",
        // 95.5s ago: the extra half second absorbs render-time slop so the
        // static markup deterministically reads 1:35.
        answered_at: new Date(Date.now() - 95_500).toISOString(),
      }),
    ]);
    expect(html).toContain("With Sam Mason");
    expect(html).toContain("1:35");
    expect(html).not.toContain("Ringing…");
  });

  it("shows which line is busy only when the company owns more than one", () => {
    state.members = [];
    state.numbers = [
      { id: "pn-1", number_e164: "+16135550100", released_at: null },
    ];
    let html = render([liveCall()]);
    expect(html).not.toContain("(613) 555-0100");

    state.numbers = [
      { id: "pn-1", number_e164: "+16135550100", released_at: null },
      { id: "pn-2", number_e164: "+16135550111", released_at: null },
    ];
    html = render([liveCall()]);
    expect(html).toContain("on (613) 555-0100");
  });

  it("simultaneous ongoing calls stack as rows in the one card", () => {
    state.members = [{ user_id: "u1", display_name: "Sam Mason" }];
    state.numbers = [];
    const html = render([
      liveCall(),
      liveCall({
        id: "call-live-2",
        call_session_id: "sess-live-2",
        contact_id: null,
        contact_name: null,
        caller_e164: "+16135551001",
        state: "answered",
        answered_by_user_id: "u1",
        answered_at: new Date(Date.now() - 10_500).toISOString(),
      }),
    ]);
    expect(html).toContain("Dana Roofer");
    expect(html).toContain("(613) 555-1001");
    expect(html).toContain("Ringing…");
    expect(html).toContain("With Sam Mason");
  });

  it("isOngoingCall keys on outcome null alone", () => {
    expect(isOngoingCall({ outcome: null })).toBe(true);
    expect(isOngoingCall({ outcome: "missed" })).toBe(false);
    expect(isOngoingCall({ outcome: "answered" })).toBe(false);
  });
});
