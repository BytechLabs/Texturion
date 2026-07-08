import { cn } from "@/lib/utils";

/**
 * TRUTH STRIP (DESIGN-DIRECTION v4 §5.4): the one repeated component for
 * every honesty claim, site-wide, so candor has a learnable shape. Frost
 * ground, 3px cobalt left edge, mono text, a green tick where the news is
 * good (Answered Green appears only when something got handled; the tick
 * marks the lines that ARE good news, e.g. "day one you're not idle").
 *
 * Carries: the $58 first month, the 3 to 7 day carrier wait, USD billing,
 * "that's the whole list", the Canada day-one line. Server component.
 *
 * Usage:
 *   <TruthStrip
 *     items={[
 *       { text: "Receiving texts works day one.", good: true },
 *       { text: "Prices in USD, plus sales tax where it applies." },
 *     ]}
 *   />
 */

export interface TruthStripItem {
  text: string;
  /** True renders the green tick (the news got handled / is good). */
  good?: boolean;
}

function GreenTick({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-4 shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3 8.5 6.5 12 13 4.5"
        fill="none"
        stroke="var(--fr-green)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TruthStrip({
  items,
  className,
}: {
  items: TruthStripItem[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[6px] border-l-[3px] border-[color:var(--fr-cobalt)] bg-[color:var(--fr-frost)] px-5 py-4",
        className,
      )}
    >
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.text} className="flex items-start gap-2.5">
            {item.good ? (
              <GreenTick className="mt-0.5" />
            ) : (
              <span
                className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[color:var(--fr-ink-55)]"
                aria-hidden
              />
            )}
            <span className="font-mono-mkt text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink)]">
              {item.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
