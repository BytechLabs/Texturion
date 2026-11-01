import type { PublicEnv } from "@/env";

/**
 * The NEXT_PUBLIC_* values that marketing client code reads, without the zod
 * schema in `env.ts`.
 *
 * The schema and zod are about 33 KB of brotli script, and a client import of
 * `@/env` put them on every marketing page's first load (#640). The values are
 * still validated: the root layout imports `@/env`, so a missing or malformed
 * value fails `next build` and every server render. Next inlines each literal
 * `process.env.NEXT_PUBLIC_X` read at build time, so this module holds the
 * same values the schema checked. A blank value means "not configured", as
 * it does in `env.ts`.
 */
export const clientEnv: Pick<
  PublicEnv,
  | "NEXT_PUBLIC_API_URL"
  | "NEXT_PUBLIC_SENTRY_DSN"
  | "NEXT_PUBLIC_POSTHOG_KEY"
  | "NEXT_PUBLIC_GTM_ID"
> = {
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "",
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY || undefined,
  NEXT_PUBLIC_GTM_ID: process.env.NEXT_PUBLIC_GTM_ID || undefined,
};
