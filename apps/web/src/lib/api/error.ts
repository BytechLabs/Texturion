import {
  ERROR_CODES,
  INTERNAL_ERROR_CODE,
  type ApiErrorCode,
} from "@loonext/shared";

/**
 * Typed error for every non-2xx API response (SPEC §7 envelope
 * `{ error: { code, message } }`, G12). `code` is one of the stable SPEC
 * codes, or `internal_error` for a 5xx / unparseable body. `message` is the
 * server's customer-facing sentence (G10: what happened + what to do).
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }

  /**
   * Whether an automatic retry could ever succeed. Auth, validation, role,
   * and state-conflict failures are deterministic — retrying wastes requests.
   */
  get retryable(): boolean {
    return this.code === INTERNAL_ERROR_CODE || this.code === "rate_limited";
  }
}

const KNOWN_CODES = new Set<string>([...ERROR_CODES, INTERNAL_ERROR_CODE]);

/**
 * Parse a failed response body into an ApiError. Tolerates non-envelope
 * bodies (proxies, panics): anything unparseable becomes `internal_error`
 * with a calm generic sentence.
 */
export function parseErrorBody(status: number, body: unknown): ApiError {
  if (typeof body === "object" && body !== null && "error" in body) {
    const inner = (body as { error: unknown }).error;
    if (
      typeof inner === "object" &&
      inner !== null &&
      "code" in inner &&
      "message" in inner &&
      typeof (inner as { code: unknown }).code === "string" &&
      typeof (inner as { message: unknown }).message === "string"
    ) {
      const code = (inner as { code: string }).code;
      const message = (inner as { message: string }).message;
      if (KNOWN_CODES.has(code)) {
        return new ApiError(code as ApiErrorCode, message, status);
      }
      // Unknown-but-shaped code: keep the message, flag the code as internal.
      return new ApiError(INTERNAL_ERROR_CODE, message, status);
    }
  }
  return new ApiError(
    INTERNAL_ERROR_CODE,
    "Something went wrong on our end. Try again in a moment.",
    status,
  );
}
