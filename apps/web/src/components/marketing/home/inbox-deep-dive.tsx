/**
 * The inbox, up close (§H4). The deep-dive: the same water-heater conversation
 * the hero catches, slowed down step by step, so a skeptic sees exactly what the
 * crew does when a text lands (assign, note, reply, confirm, tag).
 *
 * DESIGN-DIRECTION §0: the ledger costume is gone. No `#0119 · filed · Dale`
 * ticket-meta header, no FILED stamp, no status spine. The section opens on a
 * true eyebrow label and a composed <Display> headline; the demo is the real
 * interactive product surface (kept), server-rendered complete for no-JS /
 * reduced-motion, with the steppable island hydrating after first paint.
 *
 * Ground: sits on the paper panel. The steppable island is deferred; the server
 * ships the COMPLETED annotated thread as static DOM (meaningful with JS off).
 */

import { Section } from "@/components/marketing/ui/section";
import { LazyThreadDeepDive } from "@/components/marketing/lazy/lazy-thread-deep-dive";
import { ThreadDeepDiveStatic } from "@/components/marketing/thread-demo/thread-deep-dive-static";
import { WATER_HEATER_SCRIPT } from "@/components/marketing/thread-demo/script";

export function InboxDeepDive() {
  return (
    <Section defer intrinsic={960} className="relative">
      {/* A true eyebrow (a real label, not a counter) opens the band. */}
      <p className="font-mono-mkt mb-4 flex items-center gap-2.5 text-[13px] font-medium tracking-[0.04em] text-[color:var(--graphite)]">
        <span aria-hidden className="h-px w-6 bg-[color:var(--petrol)]/50" />
        The same catch, slowed down
      </p>

      <LazyThreadDeepDive
        script={WATER_HEATER_SCRIPT}
        fallback={<ThreadDeepDiveStatic script={WATER_HEATER_SCRIPT} />}
      />
    </Section>
  );
}
