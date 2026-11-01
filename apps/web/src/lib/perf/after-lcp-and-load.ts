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
