/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatWrapUpClock, WrapUpButton, WrapUpStrip } from "./wrap-up-dictation";

afterEach(cleanup);

// The button lives inside a Tooltip; the provider is mounted app-wide in
// AppProviders, so tests supply their own.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

describe("formatWrapUpClock", () => {
  it("reads as a recording clock, zero-padded", () => {
    expect(formatWrapUpClock(0)).toBe("0:00");
    expect(formatWrapUpClock(7)).toBe("0:07");
    expect(formatWrapUpClock(62)).toBe("1:02");
    expect(formatWrapUpClock(120)).toBe("2:00");
  });

  it("never renders a negative or fractional clock", () => {
    expect(formatWrapUpClock(-3)).toBe("0:00");
    expect(formatWrapUpClock(9.8)).toBe("0:09");
  });
});

describe("WrapUpButton", () => {
  const noop = () => {};

  it("offers to dictate at rest, and to stop while recording", () => {
    const { rerender } = render(
      <WrapUpButton
        recording={false}
        transcribing={false}
        onStart={noop}
        onStop={noop}
      />,
    );
    expect(
      screen.getByLabelText("Dictate a wrap-up").getAttribute("aria-pressed"),
    ).toBe("false");

    rerender(
      <WrapUpButton
        recording
        transcribing={false}
        onStart={noop}
        onStop={noop}
      />,
    );
    expect(
      screen
        .getByLabelText("Stop and write it down")
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("cannot be pressed while the words are coming back", () => {
    render(
      <WrapUpButton
        recording={false}
        transcribing
        onStart={noop}
        onStop={noop}
      />,
    );
    expect(
      screen.getByLabelText("Writing your wrap-up down"),
    ).toHaveProperty("disabled", true);
  });

  /**
   * D117 — the tooltip is the first thing anybody reads about this feature, and
   * a version of it that implied we hear the call would be false. This is a
   * copy test on purpose: nothing else in the repo would catch that.
   */
  it("says whose voice it is, right on the control", () => {
    render(
      <WrapUpButton
        recording={false}
        transcribing={false}
        onStart={noop}
        onStop={noop}
      />,
    );
    const page = document.body.textContent ?? "";
    expect(page).toContain("Your voice, not the call");
  });
});

describe("WrapUpStrip", () => {
  const noop = () => {};

  it("renders nothing at rest, so the composer does not grow a dead region", () => {
    const { container } = render(
      <WrapUpStrip
        recording={false}
        transcribing={false}
        seconds={0}
        maxSeconds={120}
        error={null}
        onCancel={noop}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("shows the clock against the ceiling while recording, with a way out", () => {
    render(
      <WrapUpStrip
        recording
        transcribing={false}
        seconds={12}
        maxSeconds={120}
        error={null}
        onCancel={noop}
      />,
    );
    expect(screen.getByText("Recording your wrap-up")).toBeTruthy();
    expect(screen.getByText("0:12 / 2:00")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("states the D117 line while the mic is open", () => {
    render(
      <WrapUpStrip
        recording
        transcribing={false}
        seconds={1}
        maxSeconds={120}
        error={null}
        onCancel={noop}
      />,
    );
    const page = document.body.textContent ?? "";
    expect(page).toContain("Your voice, after the call");
    expect(page).toContain(
      "never the call itself",
    );
  });

  it("puts a failure inline and in an alert, never in a toast that leaves", () => {
    render(
      <WrapUpStrip
        recording={false}
        transcribing={false}
        seconds={0}
        maxSeconds={120}
        error="Microphone access is blocked."
        onCancel={noop}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Microphone access is blocked.");
  });
});
