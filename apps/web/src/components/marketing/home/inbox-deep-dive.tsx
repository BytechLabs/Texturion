/**
 * Inbox deep-dive section (Track B) — §3.4 / COPY §H4.
 *
 * The hero is the signature demo; this is the slower, annotated feature
 * walk-through reusing the SAME thread primitives (panel resolution — one
 * story, two depths). The ThreadDeepDive component carries the sticky captions,
 * the steppable thread, the ONE honesty label, and the inline CTA.
 *
 * Server component wrapper; ThreadDeepDive is the client island.
 */

import { Section } from "@/components/marketing/ui/section";
import { ThreadDeepDive } from "@/components/marketing/thread-demo/thread-deep-dive";
import { WATER_HEATER_SCRIPT } from "@/components/marketing/thread-demo/script";

export function InboxDeepDive() {
  return (
    <Section>
      <ThreadDeepDive script={WATER_HEATER_SCRIPT} />
    </Section>
  );
}
