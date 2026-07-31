/**
 * Task-board embed (features crew), the /features/tasks product visual: the
 * to-do and done columns, with each card carrying the message it came from
 * (#491).
 *
 * THE SOURCE LINE IS THE POINT. A board of cards is what every to-do app looks
 * like; the thing worth showing is that each card still knows which customer
 * text or call created it, which is the claim the page is built on (D64). So
 * every card carries its source in the customer's own words, quoted.
 *
 * Law 2 (DESIGN-DIRECTION v4): PRODUCT content, so every colour is an APP
 * token and it must be mounted inside <PanelFrame>. Marketing cobalt never
 * appears here.
 *
 * Server component, pure DOM, no interactivity. Reyes Plumbing seed data.
 */

import { Check, MessageSquare, Phone } from "lucide-react";

import { cn } from "@/lib/utils";

interface Card {
  title: string;
  /** Where it came from, quoted, and by which channel. */
  source: string;
  from: "text" | "call";
  owner: string;
  due: string;
  address?: string;
  done?: boolean;
}

const TODO: Card[] = [
  {
    title: "Water heater swap, Bishop St",
    source: "leaking all over the basement floor",
    from: "text",
    owner: "DK",
    due: "Today",
    address: "114 Bishop St",
  },
  {
    title: "Quote the Hendersons",
    source: "can somebody come out Tuesday?",
    from: "call",
    owner: "PR",
    due: "Tue",
  },
];

const DONE: Card[] = [
  {
    title: "Drain clear, Marcus T",
    source: "backing up again",
    from: "text",
    owner: "MO",
    due: "Yesterday",
    done: true,
  },
];

function TaskCard({ card }: { card: Card }) {
  const SourceIcon = card.from === "call" ? Phone : MessageSquare;
  return (
    <div className="rounded-app-card border border-app-line bg-app-paper p-2.5">
      <p
        className={cn(
          "text-[12.5px] font-semibold leading-[1.35] text-app-ink",
          card.done && "line-through decoration-app-muted-2",
        )}
      >
        {card.title}
      </p>

      {/* The receipt: what the customer actually said. */}
      <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-[1.45] text-app-muted">
        <SourceIcon
          className="mt-0.5 size-2.5 shrink-0 text-app-muted-2"
          strokeWidth={2}
          aria-hidden
        />
        <span className="line-clamp-1">&ldquo;{card.source}&rdquo;</span>
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-[5px]">
        <span className="inline-flex items-center gap-1 rounded-full border border-app-line bg-app-ground px-1.5 py-[2px] text-[10px] font-semibold leading-none text-app-muted">
          {card.owner}
        </span>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-[2px] text-[10px] font-semibold leading-none",
            card.done
              ? "border border-app-line text-app-muted-2"
              : "border border-app-tint-line bg-app-tint text-app-olive-deep",
          )}
        >
          {card.due}
        </span>
        {card.address && (
          <span className="inline-flex items-center rounded-full border border-app-line px-2 py-[2px] text-[10px] font-medium leading-none text-app-muted-2">
            {card.address}
          </span>
        )}
      </div>
    </div>
  );
}

function Column({
  label,
  count,
  cards,
  done,
}: {
  label: string;
  count: number;
  cards: Card[];
  done?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5 px-0.5 pb-2">
        {done && (
          <Check
            className="size-3 text-app-olive-deep"
            strokeWidth={2.5}
            aria-hidden
          />
        )}
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-app-muted-2">
          {label}
        </span>
        <span className="text-[11px] tabular-nums text-app-muted-2">
          {count}
        </span>
      </div>
      <div className="space-y-2">
        {cards.map((card) => (
          <TaskCard key={card.title} card={card} />
        ))}
      </div>
    </div>
  );
}

export function TaskBoardVisual({ className }: { className?: string }) {
  return (
    <div className={cn("p-3 sm:p-4", className)}>
      <div className="flex gap-2.5">
        <Column label="To do" count={TODO.length} cards={TODO} />
        <Column label="Done" count={DONE.length} cards={DONE} done />
      </div>
    </div>
  );
}
