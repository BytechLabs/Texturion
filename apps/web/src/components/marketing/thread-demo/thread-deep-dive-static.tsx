/**
 * <ThreadDeepDiveStatic>, the §3.4 deep-dive at rest, as pure server DOM.
 *
 * The LCP-neutral, no-JS / reduced-motion / pre-hydration frame for the inbox
 * deep-dive (BLUEPRINT §3.4: "static first frame, the completed thread,
 * server-rendered so the section is meaningful with JS off"). Same two-column
 * layout as the interactive <ThreadDeepDive>: sticky captions on the left (all
 * shown, none highlighted), the completed annotated thread on the right, the ONE
 * honesty label, and the inline "Get your number →" CTA.
 *
 * No client runtime, <LazyIsland> swaps in the steppable island on viewport
 * approach; reduced-motion keeps this static frame (skipWhenReducedMotion).
 */

import type { ThreadScript } from "./script";
import { StaticThread } from "./static-thread";
import { Display } from "@/components/marketing/display";
import { Kicker } from "@/components/marketing/ui/kicker";

const CAPTIONS = [
  "A text to your business number becomes a conversation everyone can see.",
  "Leave a note for the team, customers never see notes.",
  "Assign it to whoever's closest. One owner, no double replies.",
  "Reply from any phone. Delivery is confirmed, in writing.",
  "Tag it the way you sell: quote sent, scheduled, won.",
] as const;

export function ThreadDeepDiveStatic({ script }: { script: ThreadScript }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-12">
      {/* Left: captions (all shown, at rest). */}
      <div className="lg:sticky lg:top-28">
        <Kicker>See it work</Kicker>
        <Display as="h2" size="h2" className="mt-3">
          What happens when a text{" "}
          <Display.Mark>lands</Display.Mark>.
        </Display>
        <p className="mt-4 max-w-md text-lg leading-relaxed text-[color:var(--ink-70)]">
          Here is the same conversation, slowed down. A customer texts your
          business number, and step by step, this is what your crew sees and
          does: assign it, note it, reply, confirm, tag.
        </p>

        <ol className="mt-8 space-y-1">
          {CAPTIONS.map((caption, i) => (
            <li key={caption} className="flex gap-3 rounded-lg px-3 py-2.5">
              <span
                className="font-mono-mkt mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--petrol-12)] text-[12px] font-semibold tabular-nums text-[color:var(--petrol)]"
                aria-hidden
              >
                {i + 1}
              </span>
              <span className="text-[15px] leading-snug text-[color:var(--ink-70)]">
                {caption}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Right: the completed annotated thread. */}
      <div>
        <StaticThread
          script={script}
          framing="desktop"
          bodyClassName="flex max-h-[420px] flex-col gap-3 overflow-y-auto px-3 py-4"
          footer={
            <div className="flex flex-col gap-2 border-t border-border px-3 py-2.5">
              <span className="text-[13px] text-stone-500 dark:text-stone-400">
                Demo, scripted conversation, real interface.
              </span>
              <a
                href="/signup"
                className="text-[13px] font-medium text-primary underline-offset-2 hover:underline"
              >
                Get your number →
              </a>
            </div>
          }
        />
      </div>
    </div>
  );
}
