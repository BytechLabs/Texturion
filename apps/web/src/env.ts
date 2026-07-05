import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_API_URL: z.url(),
  // Optional: when set, the auth screens render Cloudflare Turnstile and pass
  // its token to Supabase Auth (SPEC §10 front door). Local dev and CI run
  // without it — Supabase only enforces captcha when enabled in the dashboard.
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  // Optional: the app portal origin (e.g. https://app.loonext.app). When set,
  // the middleware enforces the marketing/app host split — app-surface paths
  // on loonext.app redirect here, marketing paths on this host redirect to
  // the marketing site (lib/hosts.ts). Unset (dev/CI/previews) = no gating;
  // every route stays reachable on one origin.
  NEXT_PUBLIC_APP_ORIGIN: z.url().optional(),
});

// NEXT_PUBLIC_* variables are inlined at build time, so each one must be
// referenced explicitly — iterating over process.env would read nothing in
// the browser bundle.
const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  // A blank value (e.g. an empty line in .env.local) means "not configured".
  NEXT_PUBLIC_TURNSTILE_SITE_KEY:
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined,
  NEXT_PUBLIC_APP_ORIGIN: process.env.NEXT_PUBLIC_APP_ORIGIN || undefined,
});

if (!parsed.success) {
  const keys = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))];
  throw new Error(
    `Public environment validation failed. Missing or invalid: ${keys.join(", ")}`,
  );
}

/** The only environment values the browser bundle receives (SPEC §10). */
export const publicEnv = parsed.data;
