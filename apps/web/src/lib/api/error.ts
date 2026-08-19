import {
  DEFAULT_LOCALE,
  ERROR_CODES,
  INTERNAL_ERROR_CODE,
  type ApiErrorCode,
} from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";

/**
 * Typed error for every non-2xx API response (SPEC §7 envelope
 * `{ error: { code, message } }`, G12). `code` is one of the stable SPEC
 * codes, or `internal_error` for a 5xx / unparseable body. `message` is the
 * server's customer-facing sentence (G10: what happened + what to do).
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /**
   * #555 — the server's own reference for this failure, when it sent one.
   *
   * Only 5xx bodies carry it. Both phones already showed it and web did not,
   * so the one client a founder is most likely to be looking at during an
   * incident was the one that could not quote the line to search for.
   */
  readonly requestId?: string;

  constructor(code: ApiErrorCode, message: string, status: number, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
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
 *
 * #228: the SERVER's `message` reaches an English reader untouched, and only
 * an English reader. See `readerFacing` below — the server composes in one
 * language, and a sentence the reader cannot use is not a message.
 *
 * `t` is resolved at CALL time rather than at module load: this file is
 * imported by modules a server component may pull in, and `makeTranslate` is a
 * client reference — calling one while rendering on the server is a build
 * failure, not a fallback.
 */
/**
 * The sentence this reader can actually use.
 *
 * The API writes one English sentence per call site — 370 of them — and they
 * are specific in a way no per-code sentence can be: "No such API key", "This
 * company already has a subscription". An English-reading crew keeps every one
 * of them, unchanged.
 *
 * A member reading in French does not, and the comparison that decides this is
 * not against that sentence as READ. It is against that sentence as MET by
 * somebody who does not read English, which carries nothing but the fact that
 * something failed — in the moment of the product with the least patience for
 * it, on a workspace we sell to Quebec on purpose. The code's own sentence in
 * their language is less specific and strictly more informative.
 *
 * So this only ever replaces a sentence the reader could not use. It is not the
 * end state: the codes whose message is an INSTRUCTION rather than a
 * description — `conflict`, `validation_failed` — want the server to emit an
 * optional message key beside its text so each site can opt in without
 * flattening. This is the floor under that, not a substitute for it.
 */
function readerFacing(
  code: ApiErrorCode,
  serverMessage: string,
  t: Translate,
  requestId?: string,
): string {
  const sentence = t.locale === DEFAULT_LOCALE ? serverMessage : t(`apiErrors.${code}`);
  // Only on a 5xx, which is the only body that carries one. Appending a
  // reference to a 422 that already names the wrong field would be noise on
  // copy that is doing its job.
  if (!requestId) return sentence;
  return t("apiErrors.withReference", { message: sentence, id: requestId });
}

export function parseErrorBody(
  status: number,
  body: unknown,
  t: Translate = makeTranslate(DEFAULT_LOCALE),
): ApiError {
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
      const rawId = (inner as { request_id?: unknown }).request_id;
      const requestId = typeof rawId === "string" && rawId.length > 0 ? rawId : undefined;
      if (KNOWN_CODES.has(code)) {
        const known = code as ApiErrorCode;
        return new ApiError(
          known,
          readerFacing(known, message, t, requestId),
          status,
          requestId,
        );
      }
      // Unknown-but-shaped code: keep the message, flag the code as internal.
      return new ApiError(
        INTERNAL_ERROR_CODE,
        readerFacing(INTERNAL_ERROR_CODE, message, t, requestId),
        status,
        requestId,
      );
    }
  }
  return new ApiError(INTERNAL_ERROR_CODE, t("misc.apiServerError"), status);
}
