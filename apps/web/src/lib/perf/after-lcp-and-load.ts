/** How long telemetry waits for an idle moment once the page has settled. */
const SETTLE_IDLE_TIMEOUT_MS = 2000;

/** The latest the page counts as settled, from navigation start. */
const SETTLE_DEADLINE_MS = 10_000;

/** The browser stops recording LCP at the first of these. */
const FIRST_INPUT_EVENTS = ["pointerdown", "keydown"] as const;

let settled: Promise<void> | undefined;

/**
 * Resolves once the LCP candidate has painted, the window load event has
 * fired, and the main thread has had one idle moment (at most 2 s later).
 * It resolves sooner on the visitor's first tap, click or key press, and
 * 10 s after navigation start at the latest. Every page shares the one
 * promise.
 *
 * The telemetry SDK (PostHog) and gtm.js start downloading here. A
 * script that downloads or runs before the LCP frame is presented joins the
 * LCP that Lighthouse simulates, and on a CDN the SDKs used to arrive first
 * (#640). Waiting for load alone is not enough, because load often fires
 * before that frame.
 *
 * LCP ends at the first input, so waiting past it gains nothing, and the tap
 * that follows a link should not wait for an idle moment before analytics
 * starts. The deadline covers a page whose load event never fires.
 *
 * Outside a browser it resolves at once.
 */
export function whenPageSettles(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  settled ??= new Promise((resolve) => {
    const finish = () => {
      cancelGate();
      window.clearTimeout(deadline);
      for (const type of FIRST_INPUT_EVENTS) {
        window.removeEventListener(type, finish, true);
      }
      resolve();
    };
    for (const type of FIRST_INPUT_EVENTS) {
      window.addEventListener(type, finish, true);
    }
    const deadline = window.setTimeout(
      finish,
      Math.max(0, SETTLE_DEADLINE_MS - performance.now()),
    );
    const cancelGate = afterLcpAndLoad(() => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(finish, { timeout: SETTLE_IDLE_TIMEOUT_MS });
      } else {
        window.setTimeout(finish, 0);
      }
    });
  });
  return settled;
}

/**
 * Run `cb` once the LCP candidate has painted and the window load event has
 * fired. Returns a cancel function.
 *
 * The LCP entry alone fires while the page is still arriving, so the p5
 * download would share a phone's slow connection with the display face and
 * the hydration chunks. After `load` nothing the page requested is in flight.
 *
 * A browser that does not report LCP entries waits for load alone. Ask
 * `supportedEntryTypes`: `observe()` with an unknown entry type warns and
 * returns rather than throwing, so a `catch` never sees it and the boot would
 * wait for the 1.5 s bfcache fallback instead.
 */
export function afterLcpAndLoad(cb: () => void): () => void {
  let painted = !reportsLcp();
  let loaded = document.readyState === "complete";
  let done = false;
  let fallback: number | undefined;
  let po: PerformanceObserver | undefined;
  const fire = () => {
    if (done || !painted || !loaded) return;
    done = true;
    cb();
  };
  if (!painted) {
    try {
      po = new PerformanceObserver(() => {
        po?.disconnect();
        painted = true;
        fire();
      });
      po.observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      painted = true;
    }
  }
  const onLoad = () => {
    loaded = true;
    // No LCP entry ever lands on a page restored from the bfcache.
    fallback = window.setTimeout(() => {
      painted = true;
      fire();
    }, 1500);
    fire();
  };
  if (loaded) onLoad();
  else window.addEventListener("load", onLoad, { once: true });
  return () => {
    done = true;
    po?.disconnect();
    window.removeEventListener("load", onLoad);
    if (fallback !== undefined) window.clearTimeout(fallback);
  };
}

function reportsLcp(): boolean {
  return (
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes?.includes(
      "largest-contentful-paint",
    ) === true
  );
}
