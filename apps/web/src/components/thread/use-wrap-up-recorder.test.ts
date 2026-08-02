/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canRecordAudio,
  micFailureMessage,
  pickWrapUpMimeType,
  useWrapUpRecorder,
} from "./use-wrap-up-recorder";

afterEach(cleanup);

/**
 * #507 Phase 1 — dictation is a shortcut and typing is the product, so every
 * one of these paths has to end with a SENTENCE and a usable composer. The
 * failure this guards against is silence: a mic button that does nothing on a
 * browser without MediaRecorder, or on a browser that has remembered a Block,
 * is indistinguishable from a broken app.
 */

/** Install a mediaDevices whose getUserMedia does whatever the test needs. */
function stubMediaDevices(getUserMedia: () => Promise<MediaStream>): void {
  const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  restores.push(() => {
    if (original) Object.defineProperty(navigator, "mediaDevices", original);
    else Reflect.deleteProperty(navigator as object, "mediaDevices");
  });
}

const restores: (() => void)[] = [];
afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
});

describe("canRecordAudio", () => {
  it("is false on a browser with no MediaRecorder at all", () => {
    // happy-dom ships none, which is exactly the shape of an old Safari or a
    // locked-down embedded webview.
    expect(canRecordAudio()).toBe(false);
  });

  it("is false when MediaRecorder exists but there is no mediaDevices", () => {
    vi.stubGlobal("MediaRecorder", class {});
    expect(canRecordAudio()).toBe(false);
  });

  it("is true only when both halves are present", () => {
    vi.stubGlobal("MediaRecorder", class {});
    stubMediaDevices(async () => ({}) as MediaStream);
    expect(canRecordAudio()).toBe(true);
  });
});

/**
 * The two recoveries are OPPOSITES, which is why one sentence would not do: a
 * remembered Block throws instantly with no prompt, so "try again" is telling
 * somebody to do the one thing that cannot work.
 */
describe("micFailureMessage", () => {
  it("sends a blocked permission to the address bar, not to a retry", () => {
    const message = micFailureMessage(
      new DOMException("denied", "NotAllowedError"),
    );
    expect(message).toContain("blocked");
    expect(message).toContain("address bar");
  });

  it("treats a SecurityError as the same block", () => {
    expect(micFailureMessage(new DOMException("x", "SecurityError"))).toBe(
      micFailureMessage(new DOMException("x", "NotAllowedError")),
    );
  });

  it("tells someone with no microphone to connect one", () => {
    const message = micFailureMessage(
      new DOMException("none", "NotFoundError"),
    );
    expect(message).toContain("No microphone found");
    expect(message).not.toContain("blocked");
  });

  it("names the busy-device case, which looks identical without it", () => {
    expect(micFailureMessage(new DOMException("x", "NotReadableError"))).toContain(
      "busy in another app",
    );
  });

  it("falls back rather than rendering an empty string for an unknown cause", () => {
    expect(micFailureMessage(new Error("who knows"))).toContain(
      "Couldn't reach your microphone",
    );
  });

  it("always leaves the member holding the keyboard", () => {
    const causes = [
      new DOMException("x", "NotAllowedError"),
      new DOMException("x", "NotFoundError"),
      new DOMException("x", "NotReadableError"),
      new DOMException("x", "AbortError"),
      new Error("unknown"),
    ];
    for (const cause of causes) {
      expect(micFailureMessage(cause).toLowerCase()).toContain("type the note");
    }
  });

  /** D117 — nothing here may imply the product hears a call or a customer. */
  it("never implies we listened to the call or the customer", () => {
    const message = micFailureMessage(
      new DOMException("x", "NotAllowedError"),
    ).toLowerCase();
    expect(message).not.toContain("the call");
    expect(message).not.toContain("customer");
  });
});

describe("pickWrapUpMimeType", () => {
  it("prefers WebM/Opus where it exists (Chromium, Firefox)", () => {
    expect(pickWrapUpMimeType((type) => type.startsWith("audio/webm"))).toBe(
      "audio/webm;codecs=opus",
    );
  });

  it("lands on MP4 where WebM is refused (Safari)", () => {
    expect(pickWrapUpMimeType((type) => type === "audio/mp4")).toBe("audio/mp4");
  });

  it("returns undefined so the browser picks, rather than forcing a refusal", () => {
    expect(pickWrapUpMimeType(() => false)).toBeUndefined();
  });

  it("treats a browser that THROWS on the query as having said no", () => {
    expect(
      pickWrapUpMimeType(() => {
        throw new TypeError("not a function here");
      }),
    ).toBeUndefined();
  });
});

describe("useWrapUpRecorder", () => {
  const onAudio = vi.fn();

  it("explains an unsupported browser instead of doing nothing", async () => {
    const { result } = renderHook(() =>
      useWrapUpRecorder({ maxSeconds: 120, maxBytes: 8_000_000, onAudio }),
    );

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.recording).toBe(false);
    expect(result.current.error).toContain("can't record audio");
    expect(result.current.error).toContain("type the note");
    expect(onAudio).not.toHaveBeenCalled();
  });

  it("explains a denied microphone instead of doing nothing", async () => {
    vi.stubGlobal("MediaRecorder", class {});
    stubMediaDevices(() =>
      Promise.reject(new DOMException("denied", "NotAllowedError")),
    );

    const { result } = renderHook(() =>
      useWrapUpRecorder({ maxSeconds: 120, maxBytes: 8_000_000, onAudio }),
    );

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.recording).toBe(false);
    expect(result.current.error).toContain("blocked");
    expect(onAudio).not.toHaveBeenCalled();
  });

  it("clears a stale error so a second attempt is not pre-judged", async () => {
    const { result } = renderHook(() =>
      useWrapUpRecorder({ maxSeconds: 120, maxBytes: 8_000_000, onAudio }),
    );

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.error).not.toBeNull();

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("stops and cancels are safe before anything has started", () => {
    const { result } = renderHook(() =>
      useWrapUpRecorder({ maxSeconds: 120, maxBytes: 8_000_000, onAudio }),
    );

    act(() => {
      result.current.stop();
      result.current.cancel();
    });

    expect(result.current.recording).toBe(false);
    expect(onAudio).not.toHaveBeenCalled();
  });
});
