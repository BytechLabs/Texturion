/**
 * Missed-text math section (Track B) — §3.7 / COPY §H8. The demoted breather
 * between the bento and the dark band (§1.4): pure arithmetic, quiet, small.
 * Copy verbatim; the calculator is the interactive island.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { MissedTextCalculator } from "@/components/marketing/interactive/missed-text-calculator";

export function MissedTextMath() {
  return (
    <Section>
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="text-[13px] font-semibold text-primary">Do the math</p>
          <h2 className="display-h2 mt-2 text-foreground">
            What&apos;s a missed conversation worth?
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            This is arithmetic on your numbers, not a claim of ours — change any
            of them. We&apos;re only multiplying what you type; we don&apos;t
            quote industry stats we can&apos;t stand behind.
          </p>
          <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">
            JobText can&apos;t answer your phone. But customers who won&apos;t
            leave a voicemail will text — and a text in a shared inbox gets
            answered by whoever&apos;s free, not whoever&apos;s phone it is.
            That&apos;s $29 a month against the number beside this.
          </p>
          <Link
            href="/signup"
            className="mt-6 inline-flex items-center gap-1 text-[15px] font-medium text-primary underline-offset-2 hover:underline"
          >
            Get your number
            <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
          </Link>
        </div>

        <Reveal>
          <MissedTextCalculator />
        </Reveal>
      </div>
    </Section>
  );
}
