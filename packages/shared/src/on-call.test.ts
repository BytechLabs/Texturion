import { describe, expect, it } from "vitest";

import { onCallWindow } from "./on-call";

/** Toronto in August: UTC-4, so a -240 minute offset. */
const TORONTO = -240;

/** Wednesday 2026-08-05, 14:00 local (18:00Z). */
const WEDNESDAY_AFTERNOON = new Date("2026-08-05T18:00:00Z");
/** Wednesday 2026-08-05, 21:00 local (01:00Z Thursday). */
const WEDNESDAY_LATE = new Date("2026-08-06T01:00:00Z");
/** Saturday 2026-08-08, 09:00 local. */
const SATURDAY_MORNING = new Date("2026-08-08T13:00:00Z");

/** The local wall clock a UTC instant lands on, for readable assertions. */
function local(iso: string): string {
  return new Date(new Date(iso).getTime() + TORONTO * 60_000)
    .toISOString()
    .slice(0, 16);
}

describe("onCallWindow", () => {
  it("OW-1: tonight is 6pm to 8am, in the crew's own clock", () => {
    const window = onCallWindow("tonight", WEDNESDAY_AFTERNOON, TORONTO);

    expect(local(window.starts_at)).toBe("2026-08-05T18:00");
    expect(local(window.ends_at)).toBe("2026-08-06T08:00");
  });

  it("OW-2: set after 6pm, it starts NOW rather than retroactively", () => {
    // A shift backdated to 6pm would claim responsibility for three hours
    // nobody was holding — including, potentially, a call that already came in
    // and woke the whole crew. The honest start is when somebody accepted it.
    const window = onCallWindow("tonight", WEDNESDAY_LATE, TORONTO);

    expect(local(window.starts_at)).toBe("2026-08-05T21:00");
    expect(local(window.ends_at)).toBe("2026-08-06T08:00");
  });

  it("OW-3: 'this weekend' set ON the weekend means THIS one", () => {
    // Booking eight days out would leave tonight uncovered by the very action
    // taken to cover it — the failure is silent and lands at 2am.
    const window = onCallWindow("weekend", SATURDAY_MORNING, TORONTO);

    expect(local(window.starts_at)).toBe("2026-08-07T18:00");
    expect(local(window.ends_at)).toBe("2026-08-10T08:00");
  });

  it("OW-4: midweek, 'this weekend' is the coming Friday", () => {
    const window = onCallWindow("weekend", WEDNESDAY_AFTERNOON, TORONTO);

    expect(local(window.starts_at)).toBe("2026-08-07T18:00");
    expect(local(window.ends_at)).toBe("2026-08-10T08:00");
  });

  it("OW-5: a week starts now and runs seven days", () => {
    const window = onCallWindow("week", WEDNESDAY_AFTERNOON, TORONTO);

    expect(window.starts_at).toBe(WEDNESDAY_AFTERNOON.toISOString());
    expect(new Date(window.ends_at).getTime()).toBe(
      WEDNESDAY_AFTERNOON.getTime() + 7 * 86_400_000,
    );
  });

  it("OW-6: every window ends after it starts, in every timezone we sell to", () => {
    // The API refuses a backwards window with a 422, so a preset that produced
    // one would be a button that never works — and only in one timezone, which
    // is how it would reach a customer.
    for (const offset of [-480, -420, -360, -300, -240, -210, -180]) {
      for (const preset of ["tonight", "weekend", "week"] as const) {
        for (const day of [3, 4, 5, 6, 7, 8, 9]) {
          const now = new Date(`2026-08-0${day}T13:00:00Z`);
          const window = onCallWindow(preset, now, offset);
          expect(
            new Date(window.ends_at).getTime(),
            `${preset} at offset ${offset} on the ${day}th`,
          ).toBeGreaterThan(new Date(window.starts_at).getTime());
        }
      }
    }
  });
});
