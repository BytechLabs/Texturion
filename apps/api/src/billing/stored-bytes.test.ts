import { describe, expect, it } from "vitest";

import { storedBytes } from "./stored-bytes";

describe("storedBytes", () => {
  it("uses the measured total, which counts voicemail audio", () => {
    // Adding the two named arms misses voicemail recordings entirely, and every
    // workspace takes calls.
    expect(
      storedBytes({
        attachments_bytes: 1_000,
        mms_bytes: 2_000,
        total_bytes: 9_000,
      }),
    ).toBe(9_000);
  });

  it("accepts the numeric strings PostgREST returns for bigints", () => {
    expect(storedBytes({ total_bytes: "12345" })).toBe(12_345);
    expect(
      storedBytes({ attachments_bytes: "10", mms_bytes: "5", total_bytes: "0" }),
    ).toBe(15);
  });

  it("falls back to the sum for a row shaped before the total existed", () => {
    expect(storedBytes({ attachments_bytes: 1_000, mms_bytes: 2_000 })).toBe(
      3_000,
    );
  });

  it("reads an empty workspace as zero rather than as missing data", () => {
    expect(storedBytes(null)).toBe(0);
    expect(storedBytes(undefined)).toBe(0);
    expect(storedBytes({})).toBe(0);
    expect(storedBytes({ total_bytes: null, attachments_bytes: null })).toBe(0);
  });

  it("never returns a negative or non-finite size", () => {
    // A tier check compares against this; a NaN would silently never alert.
    expect(storedBytes({ total_bytes: "not a number" })).toBe(0);
    expect(storedBytes({ attachments_bytes: -5, mms_bytes: -5 })).toBe(0);
  });
});
