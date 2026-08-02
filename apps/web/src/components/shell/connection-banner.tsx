"use client";

import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * #299 — one honest explanation for a mid-session drop.
 *
 * The offline ENTRY case was already handled: `sw.js` serves `/offline.html`
 * when a navigation fails, so somebody opening the app with no connection gets
 * a designed page. The case this covers is the one our users are actually in
 * and the one nothing addressed — the app is already open and the network drops
 * underneath it. A navigation fallback cannot fire then, because there is no
 * navigation: the shell is loaded and individual requests simply fail.
 *
 * What that looked like before this: every component reached its own error
 * state at once, each saying something different, none saying "you are
 * offline". The reasonable conclusion is that the product is broken, and the
 * reasonable response is a reload — which DOES hit the offline page, so the
 * same condition produced two unrelated explanations depending on whether the
 * user happened to refresh.
 *
 * ---------------------------------------------------------------------------
 * ONE LINE, AND IT DOES NOT SHOUT.
 *
 * This is a condition the user cannot fix from here and usually already knows
 * about, so it is a statement rather than an alarm: the same quiet strip the
 * workspace-status banner uses, in the warning tone rather than the destructive
 * one. Nothing is destroyed by being offline, and dressing a blip as an error
 * is what teaches people to ignore the strip that will one day matter.
 * *Applying: G10 — system states must be precise, and the Safety principle:
 * the shell does not rearrange itself around a transient condition.*
 *
 * It says what still works, because that is the actionable half. Everything
 * already loaded stays readable; it is only new reads and sends that cannot
 * complete. A banner that said "offline" and nothing else would leave the
 * reader guessing whether the thread in front of them is real.
 *
 * ---------------------------------------------------------------------------
 * `navigator.onLine` IS A FLOOR, NOT A TRUTH.
 *
 * It reports whether the machine has a network interface, not whether our API
 * is reachable — a captive portal or a dead uplink both read as online. So a
 * false NEGATIVE is impossible (offline really is offline) while a false
 * positive is routine, which is exactly the right direction for a banner: it
 * never claims a working connection is broken, and the cases it misses are the
 * ones the query layer's own error states still cover.
 *
 * Rendering nothing during SSR and until mount is deliberate for the same
 * reason `useSyncExternalStore` would be: the server has no opinion about the
 * client's connectivity, and a hydration mismatch on a banner would be a worse
 * bug than the one it reports.
 */
export function ConnectionBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    // Read at mount rather than trusting the initial state: the tab may have
    // been restored, or loaded from the bfcache, already disconnected.
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      // `polite` rather than `assertive`: a screen-reader user mid-sentence
      // should not be interrupted by a condition they cannot act on.
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center gap-2.5 border-b border-warning/30 bg-warning/10 px-4 py-2"
    >
      <WifiOff
        className="size-4 shrink-0 text-warning"
        strokeWidth={1.75}
        aria-hidden
      />
      <p className="min-w-0 flex-1 line-clamp-2 text-[13px] leading-snug text-foreground/80">
        You&rsquo;re offline. What&rsquo;s already open stays readable, and
        Loonext will catch up on its own once you&rsquo;re back.
      </p>
    </div>
  );
}
