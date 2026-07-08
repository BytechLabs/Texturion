/**
 * <ThreadDeepDiveStatic>, the home §S4 "The fix, shown" section at rest, as
 * pure server DOM (v4 "FIRST RESPONSE").
 *
 * The LCP-neutral, no-JS / reduced-motion / pre-hydration frame for the
 * deep-dive: same two-column layout as the interactive <ThreadDeepDive>
 * (sticky captions left, the completed thread right, inside the foundation
 * <PanelFrame> so the product renders with app tokens per Law 2), no
 * demo-labeling chip (owner amendment 2026-07-08), and the quiet inline
 * "Get your number" CTA.
 *
 * No client runtime; <LazyIsland> swaps in the steppable island on viewport
 * approach and reduced-motion keeps this frame (skipWhenReducedMotion).
 */

import Link from "next/link";

import { Eyebrow, PanelFrame } from "@/components/marketing/fr";
import {
  PRIMARY_CTA_LABEL,
  SIGNUP_HREF,
} from "@/components/marketing/nav-links";

import type { ThreadScript } from "./script";
import { StaticThread } from "./static-thread";

/** Shared thread-body classes: the FULL conversation renders (no scroll
 *  clip; the finished frame is the meaningful frame), and the static frame
 *  and the mounted island stay pixel-equal so the swap never moves layout. */
export const DEEP_DIVE_BODY_CLASSES = "flex flex-col gap-3 px-3.5 py-4";

/** COPY-DECK v2 §S4 step captions, verbatim. Shared with the island. */
export const DEEP_DIVE_CAPTIONS = [
  "A text to your business number becomes a conversation everyone can see.",
  "Leave a note for the team. Customers never see notes.",
  "Assign it to whoever's closest. One owner, no double replies.",
  "Reply from any phone. Delivery is confirmed, in writing.",
  "Tag it the way you sell: quote sent, scheduled, won.",
] as const;

/** The §S4 header block (eyebrow, H2, lead), shared by both frames. */
export function DeepDiveHeader() {
  return (
    <>
      <Eyebrow>See it work</Eyebrow>
      <h2 className="fr-h2 mt-4 text-[color:var(--fr-ink)]">
        What actually happens when a text lands.
      </h2>
      <p className="fr-body mt-4 max-w-md text-[color:var(--fr-ink-70)]">
        Here&apos;s the same conversation, slowed down. A customer texts your
        business number, and step by step, this is what your crew sees and
        does: assign it, note it, reply, confirm, tag.
      </p>
    </>
  );
}

/** One numbered caption row (§5.5 Numbered Steps: mono numerals in cobalt
 *  circles). `state` drives the island's sync highlight. */
export function DeepDiveCaption({
  step,
  caption,
  state = "rest",
}: {
  step: number;
  caption: string;
  state?: "rest" | "active" | "past";
}) {
  return (
    <li
      className={
        state === "active"
          ? "flex gap-3 rounded-[10px] bg-[color:var(--fr-frost)] px-3 py-2.5 transition-colors duration-200"
          : "flex gap-3 rounded-[10px] px-3 py-2.5 transition-colors duration-200"
      }
    >
      <span
        className={
          state === "rest"
            ? "font-mono-mkt mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--fr-frost)] text-[12px] font-medium tabular-nums text-[color:var(--fr-cobalt)] transition-colors duration-200"
            : "font-mono-mkt mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--fr-cobalt)] text-[12px] font-medium tabular-nums text-white transition-colors duration-200"
        }
        aria-hidden
      >
        {step}
      </span>
      <span
        className={
          state === "active"
            ? "text-[15px] font-medium leading-snug text-[color:var(--fr-ink)] transition-colors duration-200"
            : "text-[15px] leading-snug text-[color:var(--fr-ink-70)] transition-colors duration-200"
        }
      >
        {caption}
      </span>
    </li>
  );
}

/** The quiet inline CTA under the frame (§S4: "Inline CTA (quiet)"). */
export function DeepDiveInlineCta() {
  return (
    <Link
      href={SIGNUP_HREF}
      className="font-body-mkt text-sm font-medium text-[color:var(--fr-cobalt)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
    >
      {PRIMARY_CTA_LABEL}
    </Link>
  );
}

export function ThreadDeepDiveStatic({ script }: { script: ThreadScript }) {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-12">
      {/* Left: captions (all shown, at rest). */}
      <div className="lg:sticky lg:top-28">
        <DeepDiveHeader />
        <ol className="mt-8 space-y-1">
          {DEEP_DIVE_CAPTIONS.map((caption, i) => (
            <DeepDiveCaption key={caption} step={i + 1} caption={caption} />
          ))}
        </ol>
      </div>

      {/* Right: the completed thread, framed (Law 2) and shown unlabeled
          (owner amendment 2026-07-08). */}
      <div>
        <PanelFrame
          chromeUrl="loonext.com/inbox"
          ariaLabel="A Reyes Plumbing conversation in the Loonext inbox"
        >
          <StaticThread
            script={script}
            framing="desktop"
            bodyClassName={DEEP_DIVE_BODY_CLASSES}
          />
        </PanelFrame>
        <div className="mt-3">
          <DeepDiveInlineCta />
        </div>
      </div>
    </div>
  );
}
