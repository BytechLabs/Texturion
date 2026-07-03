import type { Env } from "../env";

/**
 * Typed fetch client for the Telnyx v2 REST API (SPEC §3, §4.3, §4.4).
 * Plain `fetch` — no SDK — bearer auth from TELNYX_API_KEY, JSON in/out.
 * Non-2xx responses become {@link TelnyxApiError} with the Telnyx error
 * codes surfaced, so callers can branch on carrier/vendor error codes
 * (e.g. 40300 opt-out blocks, 10DLC validation failures) without string
 * matching.
 */

export const TELNYX_API_BASE = "https://api.telnyx.com";

/** One entry of a Telnyx `{ errors: [...] }` body (their JSON:API-ish shape). */
export interface TelnyxErrorItem {
  code?: string;
  title?: string;
  detail?: string;
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
  const url = new URL(options.path, TELNYX_API_BASE);
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

  const response = await fetch(url.toString(), {
    method: options.method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
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
  const url = new URL(options.path, TELNYX_API_BASE);
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
