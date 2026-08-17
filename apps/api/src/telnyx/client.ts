import type { Env } from "../env";

/**
 * Typed fetch client for the Telnyx v2 REST API (SPEC §3, §4.3, §4.4).
 * Plain `fetch` — no SDK — bearer auth from TELNYX_API_KEY, JSON in/out.
 * Non-2xx responses become {@link TelnyxApiError} with the Telnyx error
 * codes surfaced, so callers can branch on carrier/vendor error codes
 * (e.g. 40300 opt-out blocks, 10DLC validation failures) without string
 * matching.
 *
 * The base URL is `api.telnyx.com` unless `env.TELNYX_API_BASE` overrides it
 * (unset in production; the E2E launch-pass harness points it at a fake — D31).
 */

export const TELNYX_API_BASE = "https://api.telnyx.com";

/**
 * Hard ceiling on a single Telnyx REST call. Without it a stalled Telnyx
 * endpoint would hang the caller up to the Worker's own wall-clock limit —
 * inside a webhook's waitUntil that silently burns the isolate; on a
 * user-facing route it hangs the request. A timeout surfaces as a normal
 * fetch abort the callers already handle (and, for provisioning, retry).
 */
export const TELNYX_TIMEOUT_MS = 20_000;

/** One entry of a Telnyx `{ errors: [...] }` body (their JSON:API-ish shape). */
export interface TelnyxErrorItem {
  code?: string;
  title?: string;
  detail?: string;
}

/**
 * #616 — is this failure a statement about the REQUEST, or about US?
 *
 * Five places in the call path treated "status < 500" as a definite refusal:
 * this leg is gone, this command will never work, stop trying. For most 4xx
 * that is right — a 404 on a call control id means the leg really has ended.
 *
 * A 429 is not one of them. It is caused by our AGGREGATE load against one
 * shared Telnyx account, which means it is caused by OTHER calls, and it says
 * nothing whatever about the leg in the request. Reading it as a refusal
 * inverted the meaning at every site: a technician's phone was marked dead
 * because the workspace next door was busy, and on an outbound call that hung
 * up on a live customer.
 *
 * A 408 joins it for the same reason — a timeout is an unanswered question, not
 * an answer.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is invent a new branch. Every one of those
 * five sites already has a correct path for "we could not find out" — it is the
 * one they take on a 5xx — and "not now" belongs on it. A 429 and a 503 mean the
 * same thing to a caller: ask again, do not conclude.
 */
export function isDefiniteRefusal(cause: unknown): cause is TelnyxApiError {
  if (!(cause instanceof TelnyxApiError)) return false;
  if (cause.status >= 500) return false;
  // Rate limited, or timed out. Both are about the attempt, not the subject.
  return cause.status !== 429 && cause.status !== 408;
}

export class TelnyxApiError extends Error {
  /** HTTP status Telnyx returned. */
  readonly status: number;
  /** Parsed `errors` array (empty when the body was not parseable). */
  readonly errors: TelnyxErrorItem[];
  /** The Telnyx error codes, e.g. ['40300'] — the stable branching surface. */
  readonly codes: string[];

  constructor(status: number, errors: TelnyxErrorItem[], requestLabel: string) {
    const codes = errors
      .map((item) => item.code)
      .filter((code): code is string => typeof code === "string");
    const summary = errors
      .map((item) => [item.title, item.detail].filter(Boolean).join(": "))
      .filter((text) => text.length > 0)
      .join("; ");
    super(
      `Telnyx ${status} on ${requestLabel}` +
        (codes.length > 0 ? ` [codes ${codes.join(", ")}]` : "") +
        (summary ? ` — ${summary}` : ""),
    );
    this.name = "TelnyxApiError";
    this.status = status;
    this.errors = errors;
    this.codes = codes;
  }

  /** True when any error entry carries the given Telnyx code. */
  hasCode(code: string): boolean {
    return this.codes.includes(code);
  }
}

export interface TelnyxRequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path under the API base, e.g. "/v2/number_orders". */
  path: string;
  /** Query string params, appended verbatim (caller writes `filter[...]` keys). */
  query?: Record<string, string>;
  /** JSON body; omitted entirely when undefined. */
  body?: unknown;
  /**
   * Telnyx `Idempotency-Key` header. On a repeated POST with the same key Telnyx
   * REPLAYS the first response instead of acting twice — the §4.3 backstop that
   * stops a crashed-then-retried number order from buying a second number.
   */
  idempotencyKey?: string;
}

/**
 * Perform one Telnyx v2 API call. Returns the parsed JSON body (Telnyx wraps
 * results in `{ data: ... }`; callers type `T` accordingly), or `undefined`
 * for empty 2xx bodies (e.g. DELETE 204). Throws {@link TelnyxApiError} on any
 * non-2xx, and a plain Error on transport failure (fetch reject).
 */
export async function telnyxRequest<T = unknown>(
  env: Env,
  options: TelnyxRequestOptions,
): Promise<T> {
  const url = new URL(options.path, env.TELNYX_API_BASE ?? TELNYX_API_BASE);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.TELNYX_API_KEY}`,
    Accept: "application/json",
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const response = await fetch(url.toString(), {
    method: options.method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    // Bound the call so a stalled Telnyx endpoint can't hang the request/isolate.
    signal: AbortSignal.timeout(TELNYX_TIMEOUT_MS),
  });

  const label = `${options.method} ${options.path}`;
  if (!response.ok) {
    let errors: TelnyxErrorItem[] = [];
    try {
      const parsed = (await response.json()) as { errors?: unknown };
      if (Array.isArray(parsed.errors)) {
        errors = parsed.errors.filter(
          (item): item is TelnyxErrorItem =>
            item !== null && typeof item === "object",
        );
      }
    } catch {
      // Non-JSON error body — status alone still identifies the failure.
    }
    throw new TelnyxApiError(response.status, errors, label);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (text.length === 0) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Telnyx returned unparseable JSON on ${label}`);
  }
}

export interface TelnyxUploadOptions {
  /** Path under the API base, e.g. "/v2/documents". */
  path: string;
  /** File bytes. */
  file: ArrayBuffer | Uint8Array | Blob;
  /** Filename part of the multipart body. */
  filename: string;
  /** MIME type of the file (e.g. "application/pdf"). */
  contentType: string;
  /** Extra text form fields (e.g. { document_type: 'loa' }). */
  fields?: Record<string, string>;
}

/**
 * Multipart sibling of {@link telnyxRequest} for `POST /v2/documents`
 * (PORTING.md §3.2) — the one Telnyx shape the JSON client doesn't cover.
 * Uses Workers-native `FormData`/`Blob`; deliberately sets NO `Content-Type`
 * header so `fetch` writes the multipart boundary itself. Same bearer auth and
 * {@link TelnyxApiError} contract as the JSON client.
 */
export async function telnyxUpload<T = unknown>(
  env: Env,
  options: TelnyxUploadOptions,
): Promise<T> {
  const url = new URL(options.path, env.TELNYX_API_BASE ?? TELNYX_API_BASE);
  const form = new FormData();
  const blob =
    options.file instanceof Blob
      ? options.file
      : new Blob([options.file as ArrayBuffer | Uint8Array], {
          type: options.contentType,
        });
  form.append("file", blob, options.filename);
  for (const [key, value] of Object.entries(options.fields ?? {})) {
    form.append(key, value);
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TELNYX_API_KEY}`,
      Accept: "application/json",
      // No Content-Type: fetch sets multipart/form-data + boundary.
    },
    body: form,
    // Bound the upload like telnyxRequest does — without a signal a hung
    // Telnyx connection would pin the Worker request until the platform kills
    // it, never surfacing an honest failure.
    signal: AbortSignal.timeout(TELNYX_TIMEOUT_MS),
  });

  const label = `POST ${options.path}`;
  if (!response.ok) {
    let errors: TelnyxErrorItem[] = [];
    try {
      const parsed = (await response.json()) as { errors?: unknown };
      if (Array.isArray(parsed.errors)) {
        errors = parsed.errors.filter(
          (item): item is TelnyxErrorItem =>
            item !== null && typeof item === "object",
        );
      }
    } catch {
      // Non-JSON error body — status alone still identifies the failure.
    }
    throw new TelnyxApiError(response.status, errors, label);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (text.length === 0) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Telnyx returned unparseable JSON on ${label}`);
  }
}
