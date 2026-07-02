import { publicEnv } from "@/env";
import { getAccessToken } from "@/lib/supabase/browser";

import { createApiClient, type RequestOptions } from "./core";

/**
 * The app-wide API client (G12): fetch wrapper injecting the Supabase session
 * token (Authorization) and the active company (X-Company-Id), parsing the
 * SPEC §7 error envelope into a typed ApiError.
 */
export const apiFetch = createApiClient({
  baseUrl: publicEnv.NEXT_PUBLIC_API_URL,
  getAccessToken,
});

export type { RequestOptions };
