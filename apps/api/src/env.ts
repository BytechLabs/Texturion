import { z } from "zod";

/**
 * Every binding the api Worker requires (SPEC §10). All of these are Worker
 * encrypted secrets in production (`wrangler secret put`) and `.dev.vars`
 * entries locally — see .dev.vars.example.
 */
const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  SUPABASE_JWKS_URL: z.url(),
  TELNYX_API_KEY: z.string().min(1),
  TELNYX_PUBLIC_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  SENTRY_DSN: z.url(),
  APP_ORIGIN: z.url(),
});

export type Env = z.infer<typeof envSchema>;

/** Raw bindings exactly as the Workers runtime hands them to `fetch`/`scheduled`. */
export type Bindings = Record<string, unknown>;

const validated = new WeakMap<object, Env>();

/**
 * Validate and return the Worker environment. The runtime passes the same
 * bindings object to every invocation within an isolate, so keying the cache
 * on that object makes validation once-per-isolate. Missing or invalid
 * configuration fails loudly, naming every offending key (SPEC §3).
 */
export function getEnv(bindings: Bindings): Env {
  const cached = validated.get(bindings);
  if (cached !== undefined) return cached;

  const result = envSchema.safeParse(bindings);
  if (!result.success) {
    const keys = [
      ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
    ];
    throw new Error(
      `Environment validation failed. Missing or invalid bindings: ${keys.join(", ")}`,
    );
  }

  validated.set(bindings, result.data);
  return result.data;
}
