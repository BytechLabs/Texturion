import { describe, expect, it } from "vitest";

import {
  countActiveMembers,
  countPendingInvites,
  seatLimit,
  seatUsage,
} from "./seat-line";

const NOW = new Date("2026-07-01T12:00:00Z");
const FUTURE = "2026-07-08T12:00:00Z";
const PAST = "2026-06-24T12:00:00Z";

describe("seatLimit", () => {
  it("mirrors SPEC §2: Starter 5, Pro unlimited (null), NULL plan reads as Starter", () => {
    expect(seatLimit("starter")).toBe(5);
    expect(seatLimit("pro")).toBeNull();
    expect(seatLimit(null)).toBe(5);
  });
});

describe("countActiveMembers", () => {
  it("counts only rows with deactivated_at NULL (the API's filter)", () => {
    expect(
      countActiveMembers([
        { deactivated_at: null },
        { deactivated_at: "2026-06-01T00:00:00Z" },
        { deactivated_at: null },
      ]),
    ).toBe(2);
  });
});

describe("countPendingInvites", () => {
  it("counts unaccepted, unrevoked, unexpired invites only", () => {
    expect(
      countPendingInvites(
        [
          { accepted_at: null, revoked_at: null, expires_at: FUTURE },
          { accepted_at: "2026-06-30T00:00:00Z", revoked_at: null, expires_at: FUTURE },
          { accepted_at: null, revoked_at: "2026-06-30T00:00:00Z", expires_at: FUTURE },
          { accepted_at: null, revoked_at: null, expires_at: PAST },
        ],
        NOW,
      ),
    ).toBe(1);
  });
});

describe("seatUsage", () => {
  it("produces the G8 line at Starter capacity", () => {
    const usage = seatUsage(5, 0, "starter");
    expect(usage).toEqual({
      used: 5,
      limit: 5,
      full: true,
      line: "5 of 5 seats. Upgrade for more",
    });
  });

  it("counts pending invites toward the seat total (API formula)", () => {
    const usage = seatUsage(4, 1, "starter");
    expect(usage.used).toBe(5);
    expect(usage.full).toBe(true);
    expect(usage.line).toBe("5 of 5 seats. Upgrade for more");
  });

  it("stays factual below capacity", () => {
    expect(seatUsage(2, 0, "starter").line).toBe("2 of 5 seats");
    expect(seatUsage(2, 0, "starter").full).toBe(false);
  });

  it("is never full on Pro (unlimited seats, #83) and drops the ceiling", () => {
    // A large crew: no cap, no upgrade nudge, no "of N" ceiling.
    const usage = seatUsage(40, 3, "pro");
    expect(usage.limit).toBeNull();
    expect(usage.full).toBe(false);
    expect(usage.line).toBe("43 teammates");
    // Singular teammate reads naturally too.
    expect(seatUsage(1, 0, "pro").line).toBe("1 teammate");
  });

  it("treats a NULL plan as the Starter allowance", () => {
    expect(seatUsage(5, 0, null).line).toBe("5 of 5 seats. Upgrade for more");
  });
});
