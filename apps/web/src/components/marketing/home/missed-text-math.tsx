/**
 * Missed-text math section (Track B) — §3.7 / COPY §H8. The demoted breather
 * between the bento and the dark band (§1.4): pure arithmetic, quiet, small.
 * Copy verbatim; the calculator is the interactive island.
 */

import { Reveal } from "@/components/marketing/ui/reveal";
import { LedgerSection } from "@/components/marketing/ledger/ledger-section";
import { SectionEyebrow } from "@/components/marketing/ledger/section-number";
import { ArrowLink } from "@/components/marketing/ledger/arrow-link";
import { Texture } from "@/components/marketing/frame/texture";
import { LazyMissedTextCalculator } from "@/components/marketing/lazy/lazy-missed-text-calculator";
import { PhotoFrame } from "@/components/marketing/photo-frame";
import { MissedTextCalculatorStatic } from "@/components/marketing/interactive/missed-text-calculator-static";

export function MissedTextMath() {
  return (
    <LedgerSection n={7} defer intrinsic={560} className="relative overflow-hidden">
      {/* Faint texture so the breather has depth, not emptiness (VISUALS §1D). */}
      <Texture variant="grid" fade="radial" opacity={0.3} />

      <div className="relative grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionEyebrow n={7} label="Do the math" />
          <h2 className="display-h2 mt-3 text-foreground">
            What&apos;s a missed conversation worth?
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            This is arithmetic on your numbers, not a claim of ours — change any
            of them. We&apos;re only multiplying what you type; we don&apos;t
            quote industry stats we can&apos;t stand behind.
          </p>

          {/* Real photo (VISUALS-V2 §2): a customer texting a business — the
              lead in the inbox, not lost to voicemail. Warm and on-brand for the
              ICP (hands on a phone), framed once with a ledger caption. */}
          <Reveal className="mt-8 max-w-xs">
            <PhotoFrame
              id="texting-hands"
              aspect="5 / 4"
              sizes="(min-width: 1024px) 30vw, 80vw"
              caption={{ label: "“can someone come today?”" }}
            />
          </Reveal>

          <p className="mt-8 text-[15px] leading-relaxed text-muted-foreground">
            JobText can&apos;t answer your phone. But customers who won&apos;t
            leave a voicemail will text — and a text in a shared inbox gets
            answered by whoever&apos;s free, not whoever&apos;s phone it is.
            That&apos;s $29 a month against the number beside this.
          </p>
          <ArrowLink href="/signup" className="mt-6">
            Get your number
          </ArrowLink>
        </div>

        <Reveal>
          {/* Deferred: the interactive calculator loads on viewport approach;
              the static default state is meaningful before/without it (§3.7). */}
          <LazyMissedTextCalculator fallback={<MissedTextCalculatorStatic />} />
        </Reveal>
      </div>
    </LedgerSection>
  );
}
