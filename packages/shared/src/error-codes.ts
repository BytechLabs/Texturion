/**
 * Stable API error codes (SPEC §7, D10). Every error the api Worker returns
 * uses the envelope `{ error: { code, message } }` with one of these codes.
 */
export const ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "subscription_inactive",
  "usage_cap_reached",
  "registration_pending",
  "recipient_opted_out",
  "validation_failed",
  "not_found",
  "conflict",
  // Compose-only (SPEC §5, D4): a new outbound conversation lands in the
  // destination's quiet hours (8pm–8am local). Structural signal so the UI
  // shows the confirm dialog by CODE, never by sniffing the 409 message.
  // Shares the 409 status and envelope with `conflict`.
  "quiet_hours_confirmation_required",
  "rate_limited",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * HTTP status for each code, exactly as specified in the SPEC §7 table.
 */
export const ERROR_CODE_STATUS = {
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
} as const satisfies Record<ErrorCode, number>;

/**
 * Fallback code for unhandled exceptions in the api Worker's `onError` hook.
 * SPEC §7 deliberately defines no 500 code — every specified failure path maps
 * to one of the ten codes above — so this is the single code outside that
 * table, defined here so the full set of codes a client can observe has one
 * source of truth. The response keeps the SPEC §7 envelope shape.
 */
export const INTERNAL_ERROR_CODE = "internal_error" as const;

/** HTTP status paired with {@link INTERNAL_ERROR_CODE}. */
export const INTERNAL_ERROR_STATUS = 500 as const;

/** Every code a client can observe: the SPEC §7 table plus the 500 fallback. */
export type ApiErrorCode = ErrorCode | typeof INTERNAL_ERROR_CODE;

export interface ErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}
