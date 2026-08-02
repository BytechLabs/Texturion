/**
 * @vitest-environment happy-dom
 */
/**
 * #299 — the mid-session drop, which the offline ENTRY case never covered.
 *
 * `sw.js` already serves /offline.html when a NAVIGATION fails. The case with
 * no handling was the app already being open when the network goes: no
 * navigation happens, so nothing falls back, and every component reaches its
 * own error state at once saying something different.
 *
 * These pin the two properties that make the banner worth having: it is silent
 * when there is nothing to say, and it says what still works rather than only
 * what broke.
 */
import { cleanup, render, screen, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectionBanner } from "./connection-banner";

/** Drive `navigator.onLine` and fire the event the browser would. */
function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: online,
  });
  act(() => {
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  });
}

afterEach(() => {
  cleanup();
  setOnline(true);
  vi.restoreAllMocks();
});

describe("the connection banner", () => {
  it("says nothing on an ordinary day", () => {
    // The common case by an enormous margin. A strip that is present when
    // nothing is wrong is one nobody reads when something is.
    setOnline(true);
    const { container } = render(<ConnectionBanner />);

    expect(container.innerHTML).toBe("");
  });

  it("appears when the network drops with the tab still open", () => {
    render(<ConnectionBanner />);
    setOnline(false);

    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("says what still works, not only what broke", () => {
    // Without this the reader is left guessing whether the thread in front of
    // them is real. "Offline" alone makes every rendered conversation suspect.
    render(<ConnectionBanner />);
    setOnline(false);

    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/stays readable/i);
    expect(text).toMatch(/catch up/i);
  });

  it("clears itself when the connection returns", () => {
    // The banner must never be the thing a user has to dismiss: it describes a
    // condition, so it disappears when the condition does.
    const { container } = render(<ConnectionBanner />);
    setOnline(false);
    expect(screen.getByRole("status")).toBeTruthy();

    setOnline(true);
    expect(container.innerHTML).toBe("");
  });

  it("reads the state at mount, not just on the next event", () => {
    // A tab restored from the bfcache, or opened while already disconnected,
    // never fires `offline` — it was already offline. Waiting for an event
    // would leave exactly that user with no explanation at all.
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    render(<ConnectionBanner />);

    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("announces politely rather than interrupting", () => {
    // A screen-reader user mid-sentence should not be cut off by a condition
    // they cannot act on.
    render(<ConnectionBanner />);
    setOnline(false);

    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });
});
