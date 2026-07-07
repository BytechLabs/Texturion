/**
 * Next.js client instrumentation — runs once in the browser before the app
 * hydrates, on every surface (marketing + app). Boots the two OPTIONAL
 * telemetry clients:
 *
 * - Sentry browser client (D13), on only when NEXT_PUBLIC_SENTRY_DSN is set.
 * - PostHog product analytics (D8/D12), on only when NEXT_PUBLIC_POSTHOG_KEY
 *   is set.
 *
 * Both load their SDK via dynamic `import()` inside their init, so this
 * entry adds no meaningful weight to the main bundle and an unconfigured
 * environment (local dev, CI, previews) ships zero telemetry code paths.
 * Both inits are best-effort and never reject — page boot cannot fail on
 * telemetry.
 */
import { initPostHog } from "@/lib/analytics/posthog";
import { initSentryClient } from "@/lib/observability/sentry";

void initSentryClient();
void initPostHog();
