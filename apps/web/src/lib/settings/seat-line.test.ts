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
  it("mirrors SPEC §2: Starter 3, Pro 10, NULL plan reads as Starter", () => {
    expect(seatLimit("starter")).toBe(3);
    expect(seatLimit("pro")).toBe(10);
    expect(seatLimit(null)).toBe(3);
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
    const usage = seatUsage(3, 0, "starter");
    expect(usage).toEqual({
      used: 3,
      limit: 3,
      full: true,
      line: "3 of 3 seats — upgrade for more",
    });
  });

  it("counts pending invites toward the seat total (API formula)", () => {
    const usage = seatUsage(2, 1, "starter");
    expect(usage.used).toBe(3);
    expect(usage.full).toBe(true);
    expect(usage.line).toBe("3 of 3 seats — upgrade for more");
  });

  it("stays factual below capacity", () => {
    expect(seatUsage(2, 0, "starter").line).toBe("2 of 3 seats");
    expect(seatUsage(2, 0, "starter").full).toBe(false);
  });

  it("never suggests an upgrade at Pro capacity (no bigger plan)", () => {
    const usage = seatUsage(9, 1, "pro");
    expect(usage.full).toBe(true);
    expect(usage.line).toBe("10 of 10 seats");
  });

  it("treats a NULL plan as the Starter allowance", () => {
    expect(seatUsage(3, 0, null).line).toBe("3 of 3 seats — upgrade for more");
  });
});
