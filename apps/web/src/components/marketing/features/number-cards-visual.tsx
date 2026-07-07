/**
 * Number-cards visual (features track), the /features/business-number multi-
 * number story rendered as live DOM. Pro includes two separate local numbers
 * (SPEC §2: Pro = 2 phone numbers), each with its own inbox thread, two
 * locations, or an office line and a field line (COPY §H6 callout). This draws
 * both number cards the way the app's /settings/numbers surface does (G8): the
 * E.164-formatted number, an area-code/city hint, an "active" state, and a
 * per-number unread count so the "each with its own inbox" claim is visible.
 *
 * All numbers are in the 555-01XX safe fictional range (G10). Server component.
 */

import { CheckCircle2, Phone } from "lucide-react";

import { cn } from "@/lib/utils";

interface NumberCard {
  label: string;
  number: string;
  hint: string;
  unread: number;
}

const CARDS: NumberCard[] = [
  {
    label: "Office line",
    number: "(416) 555-0119",
    hint: "(416). Toronto",
    unread: 3,
  },
  {
    label: "Field line",
    number: "(647) 555-0188",
    hint: "(647). Toronto",
    unread: 1,
  },
];

export function NumberCardsVisual({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[10px] border border-[color:var(--hairline)] bg-white p-5 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]",
        className,
      )}
    >
      <p className="text-[13px] font-medium text-[color:var(--ink-55)]">
        Your business numbers
      </p>
      <div className="mt-3 space-y-3">
        {CARDS.map((card) => (
          <div
            key={card.number}
            className="flex items-center gap-3 rounded-lg border border-[color:var(--hairline)] bg-white p-3"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--petrol-12)] text-[color:var(--petrol)]">
              <Phone className="size-4" strokeWidth={1.75} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold tabular-nums text-[color:var(--day-ink)]">
                {card.number}
              </p>
              <p className="text-[12px] text-[color:var(--ink-55)]">
                {card.label} · {card.hint}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--petrol)]">
                <CheckCircle2 className="size-3.5" strokeWidth={2} aria-hidden />
                Active
              </span>
              <span className="rounded-full bg-[color:var(--petrol-12)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[color:var(--petrol)]">
                {card.unread} new
              </span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[13px] leading-relaxed text-[color:var(--ink-70)]">
        Two numbers on Pro, each with its own inbox thread. One shared crew, two
        front doors.
      </p>
    </div>
  );
}
