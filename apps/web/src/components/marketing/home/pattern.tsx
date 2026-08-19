import { homeCopy, type HomeCopy } from "@/i18n/marketing/home";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { FrCard, FrSection } from "@/components/marketing/fr";

/**
 * S3 · THE PATTERN (COPY-DECK v2), the pain cards on the Frost band.
 *
 * #491: the H2 named texting alone, which made the pain (and so the product)
 * sound like a texting problem. All three cards are equally true of a call.
 * Conversion job: name the reader's exact failure modes so signup feels like
 * relief, not a purchase.
 *
 * Each card opens with the mono artifact header fixture (§5 fixtures): a
 * mono ink-55 line topped with a small Flare status dot, whitelist §3.4.2
 * (the ONLY Flare on this band). id="after-dark" is the nav "Who it's for"
 * trigger's home anchor (lib/marketing/site.ts HOME_ANCHORS).
 */

const cards = (
  copy: HomeCopy,
): readonly {
  artifact: string;
  title: string;
  body: string;
}[] => [
  {
    artifact: copy.patternBuriedArtifact,
    title: copy.patternBuriedTitle,
    body: copy.patternBuriedBody,
  },
  {
    artifact: copy.patternOwnerArtifact,
    title: copy.patternOwnerTitle,
    body: copy.patternOwnerBody,
  },
  {
    artifact: copy.patternSimArtifact,
    title: copy.patternSimTitle,
    body: copy.patternSimBody,
  },
];

export function Pattern({ locale = "en" }: { locale?: MarketingLocale } = {}) {
  const copy = homeCopy(locale);
  const CARDS = cards(copy);
  return (
    <FrSection ground="frost" id="after-dark">
      <div className="max-w-2xl">
        <h2 className="fr-h2">
          {copy.patternTitle}
        </h2>
        <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
          {copy.patternSub}
        </p>
      </div>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {CARDS.map((card, i) => (
          <div key={card.title} data-reveal="" style={i > 0 ? ({ "--reveal-delay": `${i * 60}ms` } as React.CSSProperties) : undefined}>
            <FrCard className="h-full p-6">
              {/* The mono artifact header: Flare dot (§3.4.2) + mono ink-55. */}
              <p className="flex items-center gap-2">
                <span
                  className="size-2 shrink-0 rounded-full bg-[color:var(--fr-flare)]"
                  aria-hidden
                />
                <span className="fr-eyebrow text-[color:var(--fr-ink-55)]">
                  {card.artifact}
                </span>
              </p>
              <h3 className="fr-h3 mt-4 text-[color:var(--fr-ink)]">
                {card.title}
              </h3>
              <p className="font-body-mkt mt-2 text-[15px] leading-[1.65] text-[color:var(--fr-ink-70)]">
                {card.body}
              </p>
            </FrCard>
          </div>
        ))}
      </div>
    </FrSection>
  );
}
