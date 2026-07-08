import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * TRUTH STRIP (DESIGN-DIRECTION v4 §5.4): the one repeated shape for every
 * honesty claim, so candor has a learnable silhouette: Frost ground, a 3px
 * cobalt left edge, mono text, and a green tick where the news is good.
 * Carries the $58 first month, the 3 to 7 day carrier wait, USD billing,
 * "that's the whole list", and the Canada day-one line.
 *
 * `lines` renders one claim per row; a single string renders one row. Ticks
 * are per-row (`tick` on the line object) or strip-wide (`tick` prop).
 */
export interface TruthLine {
  text: string;
  /** Green tick: only when something got handled (the green whitelist). */
  tick?: boolean;
}

export function TruthStrip({
  lines,
  className,
}: {
  lines: readonly TruthLine[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-r-[10px] border-l-[3px] border-[color:var(--fr-cobalt)] bg-[color:var(--fr-frost)] px-4 py-3.5 sm:px-5",
        className,
      )}
    >
      <ul className="space-y-2.5">
        {lines.map((line) => (
          <li key={line.text} className="flex items-start gap-2.5">
            {line.tick ? (
              <Check
                className="mt-0.5 size-4 shrink-0 text-[color:var(--fr-green)]"
                strokeWidth={2.5}
                aria-hidden
              />
            ) : (
              <span
                className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[color:var(--fr-ink-55)]"
                aria-hidden
              />
            )}
            <span className="font-mono-mkt text-[0.8125rem] leading-[1.6] text-[color:var(--fr-ink)]">
              {line.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
