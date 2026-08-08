/**
 * @vitest-environment happy-dom
 */
/**
 * #539 — the clock switch in the custom send-later picker.
 *
 * The founder's question was "why cant i choose? let me switch?", and the part
 * worth testing is not that two buttons render — it is that choosing "their time"
 * changes the INSTANT the message is scheduled for, and that the switch stays away
 * when it would make no difference.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DestinationClock } from "@/lib/api/types";

import { parseLocalInput, SendLaterDialog } from "./send-later-menu";

afterEach(cleanup);

const VANCOUVER: DestinationClock = {
  timezone: "America/Vancouver",
  source: "area_code",
  local_hour: 8,
  quiet: false,
};

/** The device's own zone, whatever this machine happens to be set to. */
const HERE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * A `datetime-local` value 30 days out, at 08:30.
 *
 * Computed rather than hard-coded: the API's 90-day horizon is enforced in the
 * dialog, so a literal date far enough out to be safely "the future" is also past
 * the horizon and silently disables the button — which is how the first version of
 * these tests failed while looking like a switch bug.
 */
function soonAt0830(): string {
  const at = new Date(Date.now() + 30 * 86_400_000);
  at.setHours(8, 30, 0, 0);
  const local = new Date(at.getTime() - at.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const SAME_AS_HERE: DestinationClock = { ...VANCOUVER, timezone: HERE };

function open(clock: DestinationClock | null) {
  const onConfirm = vi.fn();
  render(
    <SendLaterDialog
      open
      clock={clock}
      onOpenChange={() => {}}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

describe("parseLocalInput (#539)", () => {
  it("keeps the typed digits as a bare wall clock", () => {
    // Deliberately NOT `new Date(value)`: that resolves the digits in the
    // DEVICE's zone, and the whole point of the switch is to resolve the same
    // digits in the customer's zone instead.
    expect(parseLocalInput("2026-08-11T08:30")).toEqual({
      year: 2026,
      month: 8,
      day: 11,
      hour: 8,
      minute: 30,
    });
  });

  it("yields NaNs for an empty or malformed field", () => {
    // Which the resolver rejects, and the caller reads as "not valid yet" — the
    // state a blank field was already in.
    expect(Number.isNaN(parseLocalInput("").year)).toBe(true);
    expect(Number.isNaN(parseLocalInput("tomorrow morning").hour)).toBe(true);
  });
});

describe("SendLaterDialog clock switch (#539)", () => {
  it("offers the switch when the customer's clock differs from the reader's", () => {
    open(VANCOUVER);
    expect(screen.getByRole("group", { name: "Which clock" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Your time" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Their time" })).toBeTruthy();
  });

  it("starts on the reader's own clock", () => {
    // A datetime-local field reads and writes the DEVICE's zone, so starting on
    // "theirs" would mean the value shown is not the value held.
    open(VANCOUVER);
    expect(
      screen.getByRole("button", { name: "Your time" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("does NOT offer the switch when both clocks read the same", () => {
    // Two buttons that do the same thing are worse than no buttons, because they
    // imply a difference that is not there.
    open(SAME_AS_HERE);
    expect(screen.queryByRole("group", { name: "Which clock" })).toBeNull();
  });

  it("does NOT offer the switch when there is no contact to resolve a clock from", () => {
    open(null);
    expect(screen.queryByRole("group", { name: "Which clock" })).toBeNull();
  });

  it("schedules a DIFFERENT instant once the switch is flipped", () => {
    // THE WHOLE POINT. The digits in the field do not change; what they mean
    // does. If both branches produced the same instant the switch would be
    // decorative, which is exactly the failure mode worth a test.
    const onConfirm = open(VANCOUVER);
    const field = screen.getByLabelText(/Send date and time/);
    // A date far enough out to stay in the future whenever this runs.
    fireEvent.change(field, { target: { value: soonAt0830() } });

    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    const asYours = onConfirm.mock.calls[0][0] as string;

    cleanup();
    const second = open(VANCOUVER);
    const field2 = screen.getByLabelText(/Send date and time/);
    fireEvent.change(field2, { target: { value: soonAt0830() } });
    fireEvent.click(screen.getByRole("button", { name: "Their time" }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    const asTheirs = second.mock.calls[0][0] as string;

    expect(asTheirs).not.toBe(asYours);
    // And "8:30 their time" really is 8:30 in Vancouver.
    expect(
      new Date(asTheirs).toLocaleString("en-US", {
        timeZone: "America/Vancouver",
        hour: "numeric",
        minute: "2-digit",
      }),
    ).toBe("8:30 AM");
    // ...while "8:30 your time" is 8:30 on the READER's clock, which is the other
    // half of the claim and the half a one-sided assertion would miss.
    expect(
      new Date(asYours).toLocaleString("en-US", {
        timeZone: HERE,
        hour: "numeric",
        minute: "2-digit",
      }),
    ).toBe("8:30 AM");
  });

  it("shows the same instant on the other clock, as a time rather than a gap", () => {
    // "what about my timzeone equivalent?" — answered with a rendered time, not
    // an hours-apart number, which is wrong every day in the half-hour zones.
    open(VANCOUVER);
    const field = screen.getByLabelText(/Send date and time/);
    fireEvent.change(field, { target: { value: soonAt0830() } });
    expect(screen.getByRole("status").textContent).toMatch(/their time$/);

    fireEvent.click(screen.getByRole("button", { name: "Their time" }));
    expect(screen.getByRole("status").textContent).toMatch(/your time$/);
  });

  it("names the chosen clock in the field's own label", () => {
    // Somebody navigating by label must not have to find the segmented control
    // to know which clock they are typing in.
    open(VANCOUVER);
    expect(screen.getByLabelText("Send date and time, your time")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Their time" }));
    expect(screen.getByLabelText("Send date and time, their time")).toBeTruthy();
  });
});
