/**
 * @vitest-environment happy-dom
 *
 * #307 — "When this line is open".
 *
 * NH-3 is the one that decides whether this dialog is safe to open. A clock
 * nobody touched must not be SENT: posting the resolved week back would turn
 * an inherited clock into an override just by opening the dialog, and the line
 * would stop following the workspace without anybody choosing that. Nothing
 * would look wrong until somebody changed the workspace hours and one number
 * ignored them.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { save, identity } = vi.hoisted(() => ({
  save: vi.fn(),
  identity: {
    current: {} as Record<string, { value: unknown; inherited: boolean }>,
  },
}));

vi.mock("@/lib/api/numbers", () => ({
  useNumberIdentity: () => ({ isPending: false, data: identity.current }),
  useSetNumberIdentity: () => ({ isPending: false, mutateAsync: save }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NumberHoursDialog, patchFrom } from "./number-hours-dialog";
import { toFormState } from "@/lib/settings/business-hours-form";

const WORKSPACE_WEEK = {
  mon: { open: "08:00", close: "17:00" },
  tue: { open: "08:00", close: "17:00" },
};

afterEach(cleanup);

beforeEach(() => {
  save.mockReset();
  save.mockResolvedValue(undefined);
  identity.current = {
    timezone: { value: "America/Toronto", inherited: true },
    business_hours: { value: WORKSPACE_WEEK, inherited: true },
    business_hours_exceptions: { value: [], inherited: true },
  };
});

function open() {
  render(<NumberHoursDialog numberId="n1" open onOpenChange={() => {}} />);
}

describe("#307 when this line is open", () => {
  it("NH-1: the week starts at the hours this line actually keeps", () => {
    // Never an empty week. A blank grid cannot tell an owner when the line is
    // open today, and showing that before it changes is this dialog's job.
    open();
    expect(
      (screen.getByLabelText("Monday open time") as HTMLInputElement).value,
    ).toBe("08:00");
    expect(
      (screen.getByLabelText("Monday close time") as HTMLInputElement).value,
    ).toBe("17:00");
  });

  it("NH-2: an inherited clock says so, per setting", () => {
    // Two settings, two statements — the timezone and the week are separate
    // columns and a line can override one without the other.
    open();
    expect(screen.getAllByText("Same as your workspace")).toHaveLength(2);
  });

  it("NH-3: a clock nobody touched is never sent", () => {
    // THE ONE THAT MATTERS.
    const days = toFormState(WORKSPACE_WEEK);
    expect(
      patchFrom(identity.current as never, "America/Toronto", days, days),
    ).toEqual({});
  });

  it("NH-4: a changed zone is sent alone, and a changed week is sent alone", () => {
    const days = toFormState(WORKSPACE_WEEK);
    expect(
      patchFrom(identity.current as never, "America/Vancouver", days, days),
    ).toEqual({ timezone: "America/Vancouver" });

    const edited = days.map((d) =>
      d.weekday === "mon" ? { ...d, close: "15:00" } : d,
    );
    const patch = patchFrom(
      identity.current as never,
      "America/Toronto",
      edited,
      days,
    );
    expect(patch.timezone).toBeUndefined();
    expect(patch.business_hours?.mon).toEqual({
      open: "08:00",
      close: "15:00",
    });
  });

  it("NH-5: an overridden clock offers the way back, worded as the outcome", async () => {
    // "Clear" would imply no hours at all, and a line with no hours is
    // after-hours every minute of the week — the opposite of what an owner
    // undoing an override wants.
    identity.current = {
      ...identity.current,
      business_hours: { value: { mon: null }, inherited: false },
    };
    open();

    const back = screen.getAllByRole("button", {
      name: "Use the workspace's",
    });
    expect(back).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^clear$/i })).toBeNull();
  });
});
