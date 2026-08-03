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
      // #303: the AUP ladder's suspend step. 403 like the other refusals a
      // client cannot resolve by retrying or by paying.
      sending_suspended: 403,
      usage_cap_reached: 402,
      registration_pending: 403,
      recipient_opted_out: 403,
      validation_failed: 422,
      not_found: 404,
      conflict: 409,
      quiet_hours_confirmation_required: 409,
      mfa_required: 403,
      mfa_challenge_required: 403,
      rate_limited: 429,
      // #283: a subsystem switched off at the runtime kill switch. 503 rather
      // than 403 because it is temporary and nobody's fault — the client says
      // "paused, try shortly", not "you cannot do this".
      service_unavailable: 503,
    });
  });

  it("keeps the two MFA codes apart, because the remedies are opposite (#496)", () => {
    // `mfa_required` sends somebody to ENROL; `mfa_challenge_required` asks
    // somebody already enrolled for a CODE. A client that collapsed them would
    // offer a second factor to a person who cannot get past their first.
    expect(ERROR_CODES).toContain("mfa_challenge_required");
    expect(ERROR_CODE_STATUS.mfa_challenge_required).toBe(
      ERROR_CODE_STATUS.forbidden,
    );
    expect("mfa_challenge_required").not.toBe("mfa_required");
  });

  it("gives MFA its own code rather than a 403 with prose (#314)", () => {
    // All three clients ROUTE on this — to the enrolment screen, not to an
    // error toast. A message-sniffing client would break the first time the
    // copy was edited.
    expect(ERROR_CODE_STATUS.mfa_required).toBe(ERROR_CODE_STATUS.forbidden);
    expect(ERROR_CODES).toContain("mfa_required");
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
