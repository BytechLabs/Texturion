/**
 * Missed-text math (§H8), the demoted breather between the bento and the close:
 * pure arithmetic on the visitor's own numbers, quiet and small. Nothing is
 * claimed; the calculator only multiplies what you type.
 *
 * DESIGN-DIRECTION §0: no section number. A composed <Display> headline opens it;
 * the real duotone photo grounds it; sits on the paper ground. The calculator is
 * the interactive island (kept), with a meaningful static default.
 */

import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { Display } from "@/components/marketing/display";
import { ArrowLink } from "@/components/marketing/ledger/arrow-link";
import { Texture } from "@/components/marketing/frame/texture";
import { LazyMissedTextCalculator } from "@/components/marketing/lazy/lazy-missed-text-calculator";
import { PhotoFrame } from "@/components/marketing/photo-frame";
import { MissedTextCalculatorStatic } from "@/components/marketing/interactive/missed-text-calculator-static";

export function MissedTextMath() {
  return (
    <Section defer intrinsic={560} className="relative overflow-hidden">
      <Texture variant="grid" fade="radial" opacity={0.3} />

      <div className="relative grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="font-mono-mkt flex items-center gap-2.5 text-[13px] font-medium tracking-[0.04em] text-[color:var(--graphite)]">
            <span aria-hidden className="h-px w-6 bg-[color:var(--petrol)]/50" />
            Do the math
          </p>
          <Display as="h2" size="h2" className="mt-3">
            What&apos;s a missed conversation{" "}
            <Display.Emph>worth</Display.Emph>?
          </Display>
          <p className="mt-5 text-lg leading-relaxed text-[color:var(--ink-70)]">
            This is arithmetic on your numbers, not a claim of ours. Change any
            of them. We&apos;re only multiplying what you type; we don&apos;t
            quote industry stats we can&apos;t stand behind.
          </p>

          {/* Real duotone photo: a customer texting a business, the lead in the
              inbox, not lost to voicemail. */}
          <Reveal className="mt-8 max-w-xs">
            <PhotoFrame
              id="texting-hands"
              aspect="5 / 4"
              sizes="(min-width: 1024px) 30vw, 80vw"
              caption={{ label: "“can someone come today?”" }}
            />
          </Reveal>

          <p className="mt-8 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
            JobText can&apos;t answer your phone. But customers who won&apos;t
            leave a voicemail will text, and a text in a shared inbox gets
            answered by whoever&apos;s free, not whoever&apos;s phone it is.
            That&apos;s $29 a month against the number beside this.
          </p>
          <ArrowLink href="/signup" className="mt-6">
            Get your number
          </ArrowLink>
        </div>

        <Reveal>
          <LazyMissedTextCalculator fallback={<MissedTextCalculatorStatic />} />
        </Reveal>
      </div>
    </Section>
  );
}
