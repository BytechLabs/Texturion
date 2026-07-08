import { CtaButton, Eyebrow, FrSection } from "@/components/marketing/fr";
import { MissedTextCalculatorStatic } from "@/components/marketing/interactive/missed-text-calculator-static";
import { PRIMARY_CTA_LABEL, SIGNUP_HREF } from "@/components/marketing/nav-links";

import { LazyMissedTextCalculator } from "./lazy-islands";

/**
 * S8 · DO THE MATH (COPY-DECK v2). Conversion job: convert the pain into a
 * dollar figure the owner computes himself, then anchor $29 against it.
 *
 * The calculator's output figure is the band's ONE display-scale accent (the
 * sanctioned Flare use, whitelist §3.4.3; Law 5: no cobalt display element
 * shares this band, the CTA button is standard size). The server ships the
 * resting state; the draggable island swaps in on viewport approach.
 */
export function DoTheMath() {
  return (
    <FrSection ground="white" id="math">
      <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div>
          <Eyebrow>Do the math</Eyebrow>
          <h2 className="fr-h2 mt-4">
            What&apos;s a missed conversation worth?
          </h2>
          {/* The deck's §S8 lead ("This is arithmetic on your numbers…")
              renders verbatim inside the calculator card itself, so the
              column carries only the closer; repeating the lead here would
              print the same sentence twice in one viewport. */}
          <p className="fr-body mt-6 max-w-[52ch] text-[color:var(--fr-ink-70)]">
            Loonext can&apos;t answer your phone. But customers who won&apos;t
            leave a voicemail will text, and a text in a shared inbox gets
            answered by whoever&apos;s free, not whoever&apos;s phone it is.
            That&apos;s{" "}
            <span className="fr-mono-data text-[color:var(--fr-ink)]">$29</span>{" "}
            a month against the number above.
          </p>
          <div className="mt-8">
            <CtaButton href={SIGNUP_HREF}>{PRIMARY_CTA_LABEL}</CtaButton>
          </div>
        </div>

        <LazyMissedTextCalculator fallback={<MissedTextCalculatorStatic />} />
      </div>
    </FrSection>
  );
}
