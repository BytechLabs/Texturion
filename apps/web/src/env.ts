import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

// NEXT_PUBLIC_* variables are inlined at build time, so each one must be
// referenced explicitly — iterating over process.env would read nothing in
// the browser bundle.
const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

if (!parsed.success) {
  const keys = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))];
  throw new Error(
    `Public environment validation failed. Missing or invalid: ${keys.join(", ")}`,
  );
}

/** The only environment values the browser bundle receives (SPEC §10). */
export const publicEnv = parsed.data;
