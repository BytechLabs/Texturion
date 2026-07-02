import { describe, expect, it } from "vitest";

import {
  ERROR_CODES,
  ERROR_CODE_STATUS,
  INTERNAL_ERROR_CODE,
  INTERNAL_ERROR_STATUS,
} from "./error-codes";

describe("error codes (SPEC §7)", () => {
  it("contains no duplicates", () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it("maps every code to the HTTP status from the SPEC §7 table", () => {
    expect(ERROR_CODE_STATUS).toEqual({
      unauthorized: 401,
      forbidden: 403,
      subscription_inactive: 402,
      usage_cap_reached: 402,
      registration_pending: 403,
      recipient_opted_out: 403,
      validation_failed: 422,
      not_found: 404,
      conflict: 409,
      quiet_hours_confirmation_required: 409,
      rate_limited: 429,
    });
  });

  it("shares the 409 status between conflict and quiet-hours confirmation", () => {
    expect(ERROR_CODE_STATUS.quiet_hours_confirmation_required).toBe(
      ERROR_CODE_STATUS.conflict,
    );
  });

  it("has a status entry for every code and no extras", () => {
    expect(Object.keys(ERROR_CODE_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });
});

describe("internal error fallback (500)", () => {
  it("pairs internal_error with HTTP 500", () => {
    expect(INTERNAL_ERROR_CODE).toBe("internal_error");
    expect(INTERNAL_ERROR_STATUS).toBe(500);
  });

  it("stays outside the SPEC §7 table — the table defines no 500 code", () => {
    expect(ERROR_CODES).not.toContain(INTERNAL_ERROR_CODE);
    expect(Object.keys(ERROR_CODE_STATUS)).not.toContain(INTERNAL_ERROR_CODE);
  });
});
