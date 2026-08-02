import { recordClientError } from "@/lib/observability/recent-errors";

import { ApiError, parseErrorBody } from "./error";

/**
 * Environment-free API client factory (G12). The singleton in `client.ts`
 * wires it to the real base URL and Supabase session; tests construct their
 * own with a stubbed token getter and `fetch`.
 */
export interface ApiClientConfig {
  baseUrl: string;
  /** Resolve the current Supabase access token; null = signed out. */
  getAccessToken: () => Promise<string | null>;
  /** Injectable fetch for tests; defaults to the global. */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** X-Company-Id — required on every route except the company-exempt three (SPEC §7). */
  companyId?: string;
  /** JSON body (mutually exclusive with formData). */
  body?: unknown;
  /** Multipart body (CSV import). */
  formData?: FormData;
  /** Idempotency-Key header (sends, compose, provision — SPEC §7). */
  idempotencyKey?: string;
  /** Query string parameters; undefined values are dropped. */
  searchParams?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

export type ApiRequest = <T>(path: string, options?: RequestOptions) => Promise<T>;

export function createApiClient(config: ApiClientConfig): ApiRequest {
  const fetchImpl = config.fetch ?? fetch;
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  return async function request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const token = await config.getAccessToken();
    if (!token) {
      throw new ApiError("unauthorized", "You're signed out. Log in again.", 401);
    }

    const url = new URL(baseUrl + path);
    if (options.searchParams) {
      for (const [key, value] of Object.entries(options.searchParams)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    // Injected at build time from package.json (next.config.ts), so it cannot
    // drift from the build it describes the way a hand-maintained constant can.
    const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      // #236: which app is calling, so the signed-in-devices list can say
      // "Web browser" instead of guessing from a user agent string. Set here
      // rather than per-call — a request that skipped it would show up in
      // somebody's security screen as an unrecognised device.
      "X-Client": "web",
    };
    // #339: which build. Set here for the same reason as X-Client — a request
    // that skipped it would report as "no version", which is the bucket a
    // floor blocks. Omitted rather than sent empty when the build has no
    // version, so "we do not know" stays distinguishable from a claim.
    if (APP_VERSION) headers["X-App-Version"] = APP_VERSION;
    if (options.companyId) headers["X-Company-Id"] = options.companyId;
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    let body: BodyInit | undefined;
    if (options.formData) {
      body = options.formData; // browser sets the multipart boundary
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const response = await fetchImpl(url.toString(), {
      method: options.method ?? "GET",
      headers,
      body,
      signal: options.signal,
    });

    if (response.status === 204) {
      return undefined as T;
    }

    let payload: unknown = null;
    const text = await response.text();
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const error = parseErrorBody(response.status, payload);
      // #253: every API failure the app ever sees passes through here, which
      // makes this the one place a recent-errors ring can be filled without
      // asking three hundred call sites to remember. The method and path go in
      // with it — "500" alone cannot be looked up, and `/v1/messages/send 500`
      // can be found in the logs in one search.
      recordClientError(
        `${options.method ?? "GET"} ${path} ${response.status} ${error.code}`,
      );
      throw error;
    }
    return payload as T;
  };
}
