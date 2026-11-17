import { publicEnv } from "@/env";
import { getAccessToken } from "@/lib/supabase/browser";

import { createApiClient } from './core';

export { type RequestOptions } from './core';
export const apiFetch = createApiClient({
  baseUrl: publicEnv.NEXT_PUBLIC_API_URL,
  getAccessToken,
});

/**
 * The API origin, for the rare caller that needs the raw Response rather than
 * a parsed body — the #231 history CSV export downloads a file, so it cannot
 * go through the JSON client. Trailing slash stripped, exactly as the client
 * does it, so both build the same URLs.
 */
export function getApiBaseUrl(): string {
  return publicEnv.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
}


