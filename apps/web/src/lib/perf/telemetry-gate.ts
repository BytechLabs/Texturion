import { isAppSurfacePath } from "@/lib/app-surface";

import { whenPageSettles } from "./after-lcp-and-load";

/** The longest the app waits for an idle moment once the page has loaded. */
const APP_IDLE_TIMEOUT_MS = 5_000;

/**
 * When the browser telemetry SDKs may start downloading.
 *
 * A marketing page waits for the page to settle, so the SDKs stay out of the
 * LCP that Lighthouse scores (#640). The signed-in app waits for the load event
 * and then one idle moment, so the SDK download does not compete with the
 * shell and its first reads. Errors raised before then are held for it
 * (holdEarlyErrors). The path is read once, when the page boots.
 */
export function whenTelemetryMayLoad(): Promise<void> {
  if (typeof window !== "undefined" && isAppSurfacePath(window.location.pathname)) {
    return afterLoadAndIdle();
  }
  return whenPageSettles();
}

function afterLoadAndIdle(): Promise<void> {
  return new Promise((resolve) => {
    const whenIdle = () => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => resolve(), {
          timeout: APP_IDLE_TIMEOUT_MS,
        });
      } else {
        window.setTimeout(resolve, 0);
      }
    };
    if (document.readyState === "complete") whenIdle();
    else window.addEventListener("load", whenIdle, { once: true });
  });
}
