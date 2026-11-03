/**
 * Next.js server instrumentation. `onRequestError` runs for every error a
 * server render, route handler, server action or middleware throws, and
 * sends it to PostHog error tracking (D146). The capture is sent before this
 * resolves, so nothing is left for the Worker to drop when the response ends.
 */
import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  const { captureServerError } = await import("@/lib/observability/server-errors");
  await captureServerError(error, request.method, context);
};
