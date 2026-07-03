/**
 * Product showcase, the first scroll reveal below the hero: a real capture of
 * the running app's shared inbox, framed in browser chrome with a gentle
 * settle-tilt for depth. The "it obviously works" proof beat.
 *
 * The screenshot is theme-correct and stays framed in the product's own chrome
 * (honest: it IS the product). The section chrome (caption, nudge) is the Caught
 * voice on the paper ground. LCP stays the hero H1 above; the shot is lazy,
 * pre-sized → zero CLS. Server component + one tiny tilt island.
 */

import { GlowFrame } from "@/components/marketing/frame/glow-frame";
import { Texture } from "@/components/marketing/frame/texture";
import { FramedShot } from "@/components/marketing/shot";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { ArrowLink } from "@/components/marketing/ledger/arrow-link";

export function ProductShowcase() {
  return (
    <Section className="relative overflow-hidden pt-0 sm:pt-0">
      {/* Faint dot texture so the reveal doesn't float on empty paper. */}
      <Texture variant="dots" fade="top" opacity={0.4} />

      <Reveal className="mx-auto max-w-5xl">
        <GlowFrame glow="hero" tilt={1.5}>
          <FramedShot id="inbox-list" />
        </GlowFrame>
      </Reveal>

      <Reveal className="mx-auto mt-6 flex max-w-5xl flex-col items-center gap-3 text-center sm:flex-row sm:justify-center sm:gap-4 sm:text-left">
        <p className="text-[14px] leading-relaxed text-[color:var(--ink-70)]">
          This is the shared inbox: every customer text in one place, with who
          owns it and what&apos;s handled, visible to the whole crew.
        </p>
        <ArrowLink href="/signup" className="shrink-0">
          See your inbox
        </ArrowLink>
      </Reveal>
    </Section>
  );
}
