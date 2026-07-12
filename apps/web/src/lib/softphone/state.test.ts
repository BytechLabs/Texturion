/**
 * D43 (#135) softphone state machine — phase 3 multi-call. Pure reducer
 * tests: call waiting (answer holds the current call), hold/swap semantics,
 * the silent removal of an un-answered inbound ring (another member won the
 * race — never this member's "Call ended" moment), and the one-active-call
 * invariant.
 */
import { describe, expect, it } from "vitest";

import {
  INITIAL_SOFTPHONE_STATE,
  phaseFromSdkState,
  softphoneReducer,
  type SoftphoneAction,
  type SoftphoneState,
} from "./state";

function run(actions: SoftphoneAction[]): SoftphoneState {
  return actions.reduce(softphoneReducer, INITIAL_SOFTPHONE_STATE);
}

const PEER_A = { name: "Dana Roofer", number: "+16135551000" };
const PEER_B = { name: "Sam Plumber", number: "+16135552000" };

describe("phaseFromSdkState", () => {
  it("maps the SDK vocabulary onto the UI phases", () => {
    for (const s of ["new", "trying", "requesting", "recovering", "ringing", "early"]) {
      expect(phaseFromSdkState(s)).toBe("connecting");
    }
    expect(phaseFromSdkState("active")).toBe("active");
    expect(phaseFromSdkState("held")).toBe("held");
    for (const s of ["hangup", "destroy", "purge"]) {
      expect(phaseFromSdkState(s)).toBe("ended");
    }
    // Unknown states read as in-flight, never as ended.
    expect(phaseFromSdkState("wat")).toBe("connecting");
  });
});

describe("softphoneReducer — single call", () => {
  it("placing → active stamps activeSince once and keeps it", () => {
    const state = run([
      { type: "ready" },
      { type: "placing", id: "c1", sessionId: null, peer: PEER_A },
      { type: "sdk_state", id: "c1", state: "ringing", now: 1000 },
      { type: "sdk_state", id: "c1", state: "active", now: 2000 },
      { type: "sdk_state", id: "c1", state: "active", now: 9000 },
    ]);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].phase).toBe("active");
    expect(state.calls[0].activeSince).toBe(2000);
    expect(state.activeId).toBe("c1");
  });

  it("an inbound ring that ends un-answered vanishes silently", () => {
    const state = run([
      { type: "incoming", id: "c1", sessionId: null, peer: PEER_A },
      { type: "sdk_state", id: "c1", state: "hangup", now: 1000 },
    ]);
    expect(state.calls).toHaveLength(0);
    expect(state.activeId).toBeNull();
  });

  it("an inbound ring ignores the SDK's early-state noise", () => {
    const state = run([
      { type: "incoming", id: "c1", sessionId: null, peer: PEER_A },
      { type: "sdk_state", id: "c1", state: "trying", now: 500 },
    ]);
    expect(state.calls[0].phase).toBe("ringing");
  });

  it("an ACTIVE call ending keeps a dismissible 'ended' chip", () => {
    const state = run([
      { type: "placing", id: "c1", sessionId: null, peer: PEER_A },
      { type: "sdk_state", id: "c1", state: "active", now: 1000 },
      { type: "sdk_state", id: "c1", state: "hangup", now: 5000 },
    ]);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].phase).toBe("ended");
    expect(state.activeId).toBeNull();
    const cleared = softphoneReducer(state, { type: "dismissed", id: "c1" });
    expect(cleared.calls).toHaveLength(0);
  });

  it("session_known threads the Telnyx session id in later", () => {
    const state = run([
      { type: "incoming", id: "c1", sessionId: null, peer: PEER_A },
      { type: "session_known", id: "c1", sessionId: "sess-9" },
    ]);
    expect(state.calls[0].sessionId).toBe("sess-9");
  });
});

describe("softphoneReducer — call waiting (phase 3)", () => {
  const activeCallWithRing: SoftphoneAction[] = [
    { type: "placing", id: "c1", sessionId: "s1", peer: PEER_A },
    { type: "sdk_state", id: "c1", state: "active", now: 1000 },
    { type: "incoming", id: "c2", sessionId: "s2", peer: PEER_B },
  ];

  it("a second incoming call rings WITHOUT disturbing the active call", () => {
    const state = run(activeCallWithRing);
    expect(state.calls).toHaveLength(2);
    expect(state.activeId).toBe("c1");
    expect(state.calls.find((c) => c.id === "c2")?.phase).toBe("ringing");
  });

  it("answering the second call (provider holds the first) swaps the active", () => {
    const state = run([
      ...activeCallWithRing,
      // The provider calls hold() on c1 and dispatches held:
      { type: "held", id: "c1", held: true },
      // …then the SDK reports c2 active:
      { type: "sdk_state", id: "c2", state: "active", now: 3000 },
    ]);
    expect(state.calls.find((c) => c.id === "c1")?.phase).toBe("held");
    expect(state.calls.find((c) => c.id === "c2")?.phase).toBe("active");
    expect(state.activeId).toBe("c2");
  });

  it("flip: unholding the held call makes it active again", () => {
    const state = run([
      ...activeCallWithRing,
      { type: "held", id: "c1", held: true },
      { type: "sdk_state", id: "c2", state: "active", now: 3000 },
      // Flip back: provider holds c2, unholds c1.
      { type: "held", id: "c2", held: true },
      { type: "held", id: "c1", held: false },
    ]);
    expect(state.activeId).toBe("c1");
    expect(state.calls.find((c) => c.id === "c2")?.phase).toBe("held");
  });

  it("the un-answered waiting ring vanishing leaves the active call alone", () => {
    const state = run([
      ...activeCallWithRing,
      { type: "sdk_state", id: "c2", state: "destroy", now: 4000 },
    ]);
    expect(state.calls).toHaveLength(1);
    expect(state.activeId).toBe("c1");
  });

  it("hanging up the active call leaves the held one held (member flips when ready)", () => {
    const state = run([
      ...activeCallWithRing,
      { type: "held", id: "c1", held: true },
      { type: "sdk_state", id: "c2", state: "active", now: 3000 },
      { type: "sdk_state", id: "c2", state: "hangup", now: 9000 },
    ]);
    expect(state.calls.find((c) => c.id === "c1")?.phase).toBe("held");
    expect(state.calls.find((c) => c.id === "c2")?.phase).toBe("ended");
    expect(state.activeId).toBeNull();
  });

  it("muted flags are per call", () => {
    const state = run([
      ...activeCallWithRing,
      { type: "muted", id: "c1", muted: true },
    ]);
    expect(state.calls.find((c) => c.id === "c1")?.muted).toBe(true);
    expect(state.calls.find((c) => c.id === "c2")?.muted).toBe(false);
  });

  it("a duplicate incoming id is idempotent", () => {
    const state = run([
      { type: "incoming", id: "c1", sessionId: null, peer: PEER_A },
      { type: "incoming", id: "c1", sessionId: null, peer: PEER_A },
    ]);
    expect(state.calls).toHaveLength(1);
  });

  it("registration errors never disturb live calls", () => {
    const state = run([
      { type: "placing", id: "c1", sessionId: null, peer: PEER_A },
      { type: "sdk_state", id: "c1", state: "active", now: 1000 },
      { type: "error", message: "boom" },
    ]);
    expect(state.error).toBe("boom");
    expect(state.calls[0].phase).toBe("active");
    expect(state.activeId).toBe("c1");
  });
});
