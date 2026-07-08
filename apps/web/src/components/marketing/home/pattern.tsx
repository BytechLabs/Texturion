import { FrCard, FrSection } from "@/components/marketing/fr";

/**
 * S3 · THE PATTERN (COPY-DECK v2), the pain cards on the Frost band.
 * Conversion job: name the reader's exact failure modes so signup feels like
 * relief, not a purchase.
 *
 * Each card opens with the mono artifact header fixture (§5 fixtures): a
 * mono ink-55 line topped with a small Flare status dot, whitelist §3.4.2
 * (the ONLY Flare on this band). id="after-dark" is the nav "Who it's for"
 * trigger's home anchor (lib/marketing/site.ts HOME_ANCHORS).
 */

const CARDS: readonly {
  artifact: string;
  title: string;
  body: string;
}[] = [
  {
    artifact: "DELIVERED 9:04 PM · NO REPLY",
    title: "Buried on one phone.",
    body: 'Quotes, bookings, and "is he coming today?" all land on the owner\'s personal cell, in between the family group chat. Whoever has the phone has the business.',
  },
  {
    artifact: "2 REPLIES · 0 OWNERS",
    title: "Nobody knows who answered.",
    body: "Did anyone get back to the Hendersons about Thursday? You can't tell without asking around. Two people reply, or nobody does.",
  },
  {
    artifact: "SIM REMOVED",
    title: "The number leaves with the phone.",
    body: "When a tech moves on, their conversations, their contacts, and sometimes their customers go with them. The business should own its own number.",
  },
];

export function Pattern() {
  return (
    <FrSection ground="frost" id="after-dark">
      <div className="max-w-2xl">
        <h2 className="fr-h2">
          Your business runs on texts. Your texts run on one phone.
        </h2>
        <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
          Customers would rather text than call, so they text whatever number
          they have. That works until it doesn&apos;t.
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
