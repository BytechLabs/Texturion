/**
 * Inbox deep-dive section (Track B) — §3.4 / COPY §H4.
 *
 * The hero is the signature demo; this is the slower, annotated feature
 * walk-through reusing the SAME thread primitives (panel resolution — one
 * story, two depths). The steppable island is deferred via next/dynamic
 * (LazyThreadDeepDive): the server ships the COMPLETED annotated thread as
 * static DOM (ThreadDeepDiveStatic) so the section is meaningful with JS off and
 * never hydrates on load; the interactive layer loads only on viewport approach,
 * and reduced-motion keeps the static frame (BLUEPRINT §3.4 performance rule).
 */

import { Section } from "@/components/marketing/ui/section";
import { LazyThreadDeepDive } from "@/components/marketing/lazy/lazy-thread-deep-dive";
import { ThreadDeepDiveStatic } from "@/components/marketing/thread-demo/thread-deep-dive-static";
import { WATER_HEATER_SCRIPT } from "@/components/marketing/thread-demo/script";

export function InboxDeepDive() {
  return (
    <Section defer intrinsic={900}>
      <LazyThreadDeepDive
        script={WATER_HEATER_SCRIPT}
        fallback={<ThreadDeepDiveStatic script={WATER_HEATER_SCRIPT} />}
      />
    </Section>
  );
}
