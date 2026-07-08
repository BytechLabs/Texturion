/**
 * Number-cards embed (features crew), /features/business-number.
 *
 * The multi-number story as live DOM: Pro includes two separate local
 * numbers (SPEC §2: Pro = 2 phone numbers), each with its own inbox thread,
 * drawn the way the app's Settings › Numbers surface draws them (the
 * formatted number, a label + area-code hint, the active state, a per-number
 * unread count so "each with its own inbox" is visible, not asserted).
 *
 * Law 2: PRODUCT content, app tokens only; mount inside <PanelFrame>.
 * Server component, static DOM, 555-01XX safe fictional numbers.
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
    hint: "(416) · Toronto",
    unread: 3,
  },
  {
    label: "Field line",
    number: "(647) 555-0188",
    hint: "(647) · Toronto",
    unread: 1,
  },
];

export function NumberCardsVisual({ className }: { className?: string }) {
  return (
    <div className={cn("p-4 sm:p-5", className)}>
      <p className="text-[13px] font-medium text-app-muted">
        Your business numbers
      </p>
      <div className="mt-3 space-y-2.5">
        {CARDS.map((card) => (
          <div
            key={card.number}
            className="flex items-center gap-3 rounded-app-card border border-app-line bg-app-white p-3.5"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-app-ctrl bg-app-tint text-app-petrol-deep">
              <Phone className="size-4" strokeWidth={1.75} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold tabular-nums text-app-ink">
                {card.number}
              </p>
              <p className="text-[12px] text-app-muted">
                {card.label} · <span className="tabular-nums">{card.hint}</span>
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-app-petrol-deep">
                <CheckCircle2 className="size-3.5" strokeWidth={2} aria-hidden />
                Active
              </span>
              <span className="rounded-full border border-app-tint-line bg-app-tint px-2 py-[2.5px] text-[11px] font-semibold leading-none tabular-nums text-app-petrol-deep">
                {card.unread} new
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
