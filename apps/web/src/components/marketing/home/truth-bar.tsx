import { FrSection, MonoFigure } from "@/components/marketing/fr";

/**
 * S2 · TRUTH BAR (COPY-DECK v2). Conversion job: anchor the flat price and
 * kill the "what's the catch" reflex before the scroll continues.
 *
 * One display-scale mono figure ($29, prices-as-art per §3) and three stat
 * chips (the Frost fixture). The mono law applies to the countable truth
 * (500); the two chips without an invoice-number stay in the body face.
 * Server component, zero JS.
 */

const CHIPS: readonly { figure?: string; label: string }[] = [
  { figure: "500", label: "outgoing texts included" },
  { label: "Receiving texts: free, unlimited" },
  { label: "Month to month, cancel anytime" },
];

export function TruthBar() {
  return (
    <FrSection
      ground="white"
      className="!py-10 md:!py-14"
      containerClassName="flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between"
    >
      <MonoFigure
        value="$29"
        suffix="/mo · the whole crew"
        size="display"
        tone="ink"
      />
      <ul className="flex flex-wrap items-stretch gap-3">
        {CHIPS.map((chip) => (
          <li
            key={chip.label}
            className="flex items-baseline gap-2.5 rounded-[10px] bg-[color:var(--fr-frost)] px-4 py-3"
          >
            {chip.figure ? (
              <span className="fr-mono-data text-[color:var(--fr-ink)]">
                {chip.figure}
              </span>
            ) : null}
            <span className="font-body-mkt text-sm text-[color:var(--fr-ink-70)]">
              {chip.label}
            </span>
          </li>
        ))}
      </ul>
    </FrSection>
  );
}
