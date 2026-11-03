/**
 * Next.js client instrumentation — runs once in the browser before the app
 * hydrates, on every surface (marketing + app). Boots PostHog (D8, D12,
 * D146): product analytics and error tracking, on only when
 * NEXT_PUBLIC_POSTHOG_KEY is set.
 *
 * The SDK loads via dynamic `import()` inside its init, so this entry adds no
 * meaningful weight to the main bundle and an unconfigured environment (local
 * dev, CI, previews) ships zero telemetry code paths. On a marketing page it
 * waits for the page to settle (LCP painted, load fired, one idle moment, or
 * the first input) before that import starts (#640), and errors thrown before
 * then are held and reported once it is up; the app starts it at once. Init
 * is best-effort and never rejects: page boot cannot fail on telemetry.
 */
import { initPostHog } from "@/lib/analytics/posthog";
import { holdEarlyErrors } from "@/lib/observability/errors";

holdEarlyErrors();
void initPostHog();
