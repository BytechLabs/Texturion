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

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
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
      throw parseErrorBody(response.status, payload);
    }
    return payload as T;
  };
}
