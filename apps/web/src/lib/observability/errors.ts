/**
 * Browser error tracking (D146). posthog-js captures uncaught errors and
 * unhandled rejections itself (`capture_exceptions` in lib/analytics/posthog.ts);
 * this module reports the failures the app caught and handled, and the ones
 * thrown before the SDK was up. Every one passes that client's scrubber.
 *
 * NEXT_PUBLIC_POSTHOG_KEY unset (local dev, CI, previews) makes all of it a
 * silent no-op.
 */
import { initPostHog } from "@/lib/analytics/posthog";

/** Enough to see a boot failure, not enough to flood the project. */
const MAX_EARLY_ERRORS = 10;

/**
 * A bare network fetch failure (`TypeError: Failed to fetch` / Safari's `Load
 * failed`). These are the user's connectivity, a mobile signal drop or flaky
 * wifi, or a total CORS or deploy misconfiguration (an immediate, obvious
 * outage), never a one-off app bug. Kept out so connectivity never drowns
 * real signal.
 */
export function isNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    /failed to fetch|load failed|networkerror|network request failed/i.test(
      error.message,
    )
  );
}

/**
 * Report an error the app caught: an API 5xx a toast handled, a boundary that
 * rendered. Best effort, never throws. One reported before the SDK is up
 * waits for it.
 */
export function reportClientError(
  error: unknown,
  properties?: Record<string, string>,
): void {
  if (isNetworkError(error)) return;
  void initPostHog()
    .then((posthog) => posthog?.captureException(error, properties))
    .catch(() => {
      /* observability must never break the app */
    });
}

/**
 * On a marketing page the SDK downloads only once the page has settled (#640),
 * so an error thrown during boot would find no handler. Until then they are
 * held here and reported once the SDK is up; from then on its own handlers
 * take over.
 */
export function holdEarlyErrors(): void {
  if (typeof window === "undefined") return;
  const held: unknown[] = [];
  const hold = (error: unknown) => {
    if (held.length < MAX_EARLY_ERRORS) held.push(error);
  };
  const onError = (event: WindowEventMap["error"]) => hold(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => hold(event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  void initPostHog()
    .then((posthog) => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      for (const error of held.splice(0)) {
        if (!isNetworkError(error)) {
          posthog?.captureException(error, { mechanism: "early_global_handler" });
        }
      }
    })
    .catch(() => {
      /* observability must never break the app */
    });
}
