/**
 * Product showcase (Track VISUAL) — the first scroll reveal below the hero
 * (VISUALS §3 home hero: "Below hero: a framed real inbox screenshot as the
 * first scroll reveal"). A real capture of the running app's shared inbox with
 * seeded demo data ("Mike's Plumbing"), framed in browser chrome with the one
 * petrol glow + a gentle settle-tilt for depth — the "it obviously works" proof
 * beat in the benefit→PROOF→how→price→act spine (CONVERSION §4).
 *
 * The shot is theme-correct (FramedShot renders the light + dark capture), the
 * LCP stays the hero H1 above this (the shot is lazy, below the fold, pre-sized
 * → zero CLS). A quiet caption ties it to the pitch and a single quiet nudge
 * keeps the high-intent reader one step from signup without competing with the
 * hero's primary CTA (CONVERSION §2).
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { GlowFrame } from "@/components/marketing/frame/glow-frame";
import { Texture } from "@/components/marketing/frame/texture";
import { FramedShot } from "@/components/marketing/shot";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";

export function ProductShowcase() {
  return (
    <Section className="relative overflow-hidden pt-0 sm:pt-0">
      {/* Faint dot texture so the reveal doesn't float on empty stone. */}
      <Texture variant="dots" fade="top" opacity={0.4} />

      <Reveal className="mx-auto max-w-5xl">
        <GlowFrame glow="hero" tilt={1.5}>
          <FramedShot id="inbox-list" />
        </GlowFrame>
      </Reveal>

      <Reveal className="mx-auto mt-6 flex max-w-5xl flex-col items-center gap-3 text-center sm:flex-row sm:justify-center sm:gap-4 sm:text-left">
        <p className="text-[14px] leading-relaxed text-muted-foreground">
          This is the shared inbox — every customer text in one place, with who
          owns it and what&apos;s handled, visible to the whole crew.
        </p>
        <Link
          href="/signup"
          className="inline-flex shrink-0 items-center gap-1 text-[15px] font-medium text-primary underline-offset-2 hover:underline"
        >
          See your inbox
          <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
        </Link>
      </Reveal>
    </Section>
  );
}
