import { isAppSurfacePath } from "@/lib/app-surface";

import { whenPageSettles } from "./after-lcp-and-load";

/**
 * When the browser telemetry SDKs may start downloading.
 *
 * A marketing page waits for the page to settle, so the SDKs stay out of the
 * LCP that Lighthouse scores (#640). The signed-in app starts them at once, as
 * it always has: no app page is scored, and an error there matters from the
 * first frame. The path is read once, when the page boots.
 */
export function whenTelemetryMayLoad(): Promise<void> {
  if (typeof window !== "undefined" && isAppSurfacePath(window.location.pathname)) {
    return Promise.resolve();
  }
  return whenPageSettles();
}
