/**
 * D43 (#135) softphone state machine — the SDK-agnostic core, unit-tested
 * without @telnyx/webrtc or a browser. (The audio glue in provider.tsx is
 * verified on a real device; the transitions here are not.)
 */
import { describe, expect, it } from "vitest";

import {
  INITIAL_SOFTPHONE_STATE,
  phaseFromSdkState,
  softphoneReducer,
  type SoftphoneState,
} from "./state";

describe("phaseFromSdkState", () => {
  it("collapses the @telnyx/webrtc states to UI phases", () => {
    for (const s of ["new", "trying", "requesting", "ringing", "early"]) {
      expect(phaseFromSdkState(s)).toBe("connecting");
    }
    expect(phaseFromSdkState("active")).toBe("active");
    for (const s of ["hangup", "destroy", "purge"]) {
      expect(phaseFromSdkState(s)).toBe("ended");
    }
    // Unknown states fail SAFE to connecting (never a false "active").
    expect(phaseFromSdkState("weird")).toBe("connecting");
  });
});

describe("softphoneReducer", () => {
  const ready: SoftphoneState = { ...INITIAL_SOFTPHONE_STATE, ready: true };

  it("ready clears any prior error", () => {
    const errored = { ...ready, error: "boom" };
    expect(softphoneReducer(errored, { type: "ready" })).toMatchObject({
      ready: true,
      error: null,
    });
  });

  it("placing sets the peer and connecting phase, unmuted", () => {
    const next = softphoneReducer(ready, {
      type: "placing",
      peer: { name: "Dana", number: "+16135551000" },
    });
    expect(next).toMatchObject({
      phase: "connecting",
      peer: { name: "Dana", number: "+16135551000" },
      muted: false,
      activeSince: null,
    });
  });

  it("stamps activeSince exactly once when the call goes active", () => {
    let s = softphoneReducer(ready, {
      type: "placing",
      peer: { name: "Dana", number: "+1" },
    });
    s = softphoneReducer(s, { type: "sdk_state", state: "active", now: 1000 });
    expect(s.phase).toBe("active");
    expect(s.activeSince).toBe(1000);
    // A second active event (e.g. a media renegotiation) never resets the timer.
    s = softphoneReducer(s, { type: "sdk_state", state: "active", now: 5000 });
    expect(s.activeSince).toBe(1000);
  });

  it("ended phase is reached from hangup/destroy", () => {
    let s = softphoneReducer(ready, {
      type: "placing",
      peer: { name: "Dana", number: "+1" },
    });
    s = softphoneReducer(s, { type: "sdk_state", state: "active", now: 1 });
    s = softphoneReducer(s, { type: "sdk_state", state: "hangup", now: 2 });
    expect(s.phase).toBe("ended");
  });

  it("cleared returns to idle but keeps the SDK registered (ready)", () => {
    let s = softphoneReducer(ready, {
      type: "placing",
      peer: { name: "Dana", number: "+1" },
    });
    s = softphoneReducer(s, { type: "sdk_state", state: "active", now: 1 });
    s = softphoneReducer(s, { type: "cleared" });
    expect(s).toEqual({ ...INITIAL_SOFTPHONE_STATE, ready: true });
  });

  it("a registration error never disturbs an in-progress call's phase", () => {
    let s = softphoneReducer(ready, {
      type: "placing",
      peer: { name: "Dana", number: "+1" },
    });
    s = softphoneReducer(s, { type: "sdk_state", state: "active", now: 1 });
    s = softphoneReducer(s, { type: "error", message: "reconnecting" });
    expect(s.phase).toBe("active");
    expect(s.error).toBe("reconnecting");
  });

  it("muted toggles independently", () => {
    const muted = softphoneReducer(ready, { type: "muted", muted: true });
    expect(muted.muted).toBe(true);
    expect(softphoneReducer(muted, { type: "muted", muted: false }).muted).toBe(
      false,
    );
  });
});
